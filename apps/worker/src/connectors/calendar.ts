import { createHash } from 'node:crypto';
import { GoogleToken } from './google.js';
import { jsonRequest, ProviderError } from '../http.js';
import type { WorkerClient } from '../client.js';
import { rpc } from '../client.js';

interface GoogleEvent { id: string; summary?: string; status?: 'confirmed' | 'tentative' | 'cancelled'; etag?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: Record<string, string> } }
export interface CalendarConnection { id: string; calendarId: string; systemOwned: boolean }
export function configuredCalendars(): CalendarConnection[] {
  const value = JSON.parse(process.env.GOOGLE_CALENDAR_CONNECTIONS ?? '[]') as CalendarConnection[];
  if (!Array.isArray(value) || value.length > 10 || value.some(c => !c.id || !c.calendarId || typeof c.systemOwned !== 'boolean')) throw new ProviderError('calendar_configuration_invalid', false);
  return value;
}
export async function syncCalendar(connectionId: string, syncCursor?: string, signal?: AbortSignal, fullSyncAt?: string) {
  const connection = configuredCalendars().find(c => c.id === connectionId);
  if (!connection) throw new ProviderError('calendar_not_allowlisted', false);
  const token = await new GoogleToken('CALENDAR').get();
  const read = async (cursor?: string) => {
    const startedAt = new Date();
    let page: string | undefined; const events: GoogleEvent[] = []; let nextSyncToken: string | undefined; let pages = 0;
    do {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`);
      url.searchParams.set('maxResults', '250'); url.searchParams.set('showDeleted', 'true'); url.searchParams.set('singleEvents', 'true');
      if (cursor) url.searchParams.set('syncToken', cursor);
      else {
        url.searchParams.set('timeMin', new Date(startedAt.getTime() - 30 * 86400000).toISOString());
        url.searchParams.set('timeMax', new Date(startedAt.getTime() + 180 * 86400000).toISOString());
      }
      if (page) url.searchParams.set('pageToken', page);
      const result: { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string } = await jsonRequest(url, { headers: { Authorization: `Bearer ${token}` }, signal });
      events.push(...result.items ?? []); page = result.nextPageToken; nextSyncToken = result.nextSyncToken;
      if (++pages > 20 || events.length > 2000) throw new ProviderError('calendar_sync_limit_no_events_truncated', false);
    } while (page);
    return { events: events.map(e => ({ external_id: e.id, title: e.summary ?? '(Sin título)', ...(e.status === 'cancelled' && (!e.start || !e.end) ? {} : { start_at: e.start?.dateTime ?? e.start?.date ?? '', end_at: e.end?.dateTime ?? e.end?.date ?? '' }), status: e.status ?? 'confirmed', data: { etag: e.etag, all_day: !!e.start?.date, system_owned: e.extendedProperties?.private?.personal_ai_os === 'true' } })), full_sync_at: cursor ? fullSyncAt ?? startedAt.toISOString() : startedAt.toISOString(), ...(nextSyncToken ? { sync_cursor: nextSyncToken } : {}) };
  };
  try { return await read(syncCursor); }
  catch (error) { if (error instanceof ProviderError && error.status === 410) return read(); throw error; }
}
interface AuthorizedAction { action_id: string; operation: string; resource?: Record<string, unknown>; payload: Record<string, unknown>; payload_hash: string }
export async function applyCalendar(client: WorkerClient, jobId: string, lease: string, actionId: string, signal?: AbortSignal) {
  if (process.env.CALENDAR_WRITES_ENABLED !== 'true') throw new ProviderError('calendar_writes_disabled', false);
  const action = await rpc<AuthorizedAction>(client, 'authorize_action', { p_job_id: jobId, p_lease_token: lease, p_action_id: actionId });
  const connection = configuredCalendars().find(c => c.id === action.payload.connection_id);
  if (!connection?.systemOwned || action.resource?.calendar_id !== connection.calendarId) throw new ProviderError('calendar_write_requires_system_owned_calendar', false);
  const token = await new GoogleToken('CALENDAR').get();
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`;
  const stableId = createHash('sha256').update(actionId).digest('hex');
  const operation = action.operation === 'calendar.cancel' ? 'calendar.delete' : action.operation;
  if (!['calendar.create', 'calendar.update', 'calendar.delete'].includes(operation)) throw new ProviderError('calendar_operation_not_allowed', false);
  const requestedId = operation === 'calendar.create' ? stableId : String(action.payload.external_id ?? '');
  if (!requestedId || !/^[a-zA-Z0-9_-]+$/.test(requestedId)) throw new ProviderError('calendar_external_id_invalid', false);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (operation !== 'calendar.create') {
    const existing = await jsonRequest<GoogleEvent>(`${base}/${encodeURIComponent(requestedId)}`, { headers, signal });
    if (existing.extendedProperties?.private?.personal_ai_os !== 'true') throw new ProviderError('calendar_foreign_event_cannot_be_modified', false);
    if (!action.payload.etag || action.payload.etag !== existing.etag) throw new ProviderError('calendar_event_changed_reapprove', false);
    headers['If-Match'] = String(action.payload.etag);
  }
  const body = operation === 'calendar.delete' ? undefined : JSON.stringify({ ...(operation === 'calendar.create' ? { id: stableId } : {}), summary: String(action.payload.title ?? '').slice(0, 500), start: { dateTime: action.payload.start_at }, end: { dateTime: action.payload.end_at }, extendedProperties: { private: { personal_ai_os: 'true', action_id: actionId } } });
  // No attendees or invitations accepted. sendUpdates=none even when caller tries to add fields.
  const url = `${base}${operation === 'calendar.create' ? '' : `/${encodeURIComponent(requestedId)}`}?sendUpdates=none`;
  try {
    const response = await fetch(url, { method: operation === 'calendar.create' ? 'POST' : operation === 'calendar.update' ? 'PATCH' : 'DELETE', headers, body, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (response.status === 409 && operation === 'calendar.create') {
      const existing = await jsonRequest<GoogleEvent>(`${base}/${stableId}`, { headers, signal });
      if (existing.extendedProperties?.private?.action_id === actionId) return { outcome: 'succeeded' as const, external_id: stableId, etag: existing.etag };
    }
    if (!response.ok) throw new ProviderError(`calendar_write_${response.status}`, false, response.status);
    const event = response.status === 204 ? undefined : await response.json() as GoogleEvent;
    return { outcome: 'succeeded' as const, external_id: requestedId, ...(event?.etag ? { etag: event.etag } : {}) };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    // A write may have succeeded. Never automatically replay an ambiguous mutation.
    return { outcome: 'unknown' as const, external_id: requestedId, details: { reason: 'provider_delivery_unknown_reconcile_before_retry' } };
  }
}
