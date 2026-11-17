import { afterEach, expect, it, vi } from 'vitest';
import { applyCalendar, syncCalendar } from '../../apps/worker/src/connectors/calendar.js';
import { GoogleToken } from '../../apps/worker/src/connectors/google.js';
import type { WorkerClient } from '../../apps/worker/src/client.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup() {
  vi.stubEnv('GOOGLE_CALENDAR_CONNECTIONS', '[{"id":"personal","calendarId":"primary","systemOwned":false}]');
  vi.spyOn(GoogleToken.prototype, 'get').mockResolvedValue('test-only-token');
}

it('expands recurring events in a bounded full sync and retains cancellation tombstones', async () => {
  setup();
  const fetched = vi.fn().mockResolvedValue(Response.json({ items: [{ id: 'deleted', status: 'cancelled' }, { id: 'event', summary: 'Cita', start: { dateTime: '2026-11-17T15:00:00Z' }, end: { dateTime: '2026-11-17T16:00:00Z' } }], nextSyncToken: 'next' }));
  vi.stubGlobal('fetch', fetched);
  const before = Date.now();
  const result = await syncCalendar('personal');
  const url = new URL(fetched.mock.calls[0]![0]);
  expect(url.searchParams.get('singleEvents')).toBe('true');
  expect(url.searchParams.get('syncToken')).toBeNull();
  expect(Date.parse(url.searchParams.get('timeMin')!)).toBeGreaterThanOrEqual(before - 30 * 86400000);
  expect(Date.parse(url.searchParams.get('timeMax')!)).toBeGreaterThanOrEqual(before + 180 * 86400000);
  expect(result.events[0]).toMatchObject({ external_id: 'deleted', status: 'cancelled' });
  expect(result.events[0]).not.toHaveProperty('start_at');
  expect(result.sync_cursor).toBe('next');
  expect(Number.isFinite(Date.parse(result.full_sync_at))).toBe(true);
});

it('keeps incremental queries free of forbidden date filters and recovers an expired cursor', async () => {
  setup();
  const fetched = vi.fn().mockResolvedValueOnce(new Response('', { status: 410 })).mockResolvedValueOnce(Response.json({ items: [], nextSyncToken: 'refreshed' }));
  vi.stubGlobal('fetch', fetched);
  await syncCalendar('personal', 'expired', undefined, '2026-11-16T00:00:00Z');
  const incremental = new URL(fetched.mock.calls[0]![0]);
  const full = new URL(fetched.mock.calls[1]![0]);
  expect(incremental.searchParams.get('syncToken')).toBe('expired');
  expect(incremental.searchParams.has('timeMin')).toBe(false);
  expect(incremental.searchParams.has('timeMax')).toBe(false);
  expect(full.searchParams.has('syncToken')).toBe(false);
  expect(full.searchParams.has('timeMin')).toBe(true);
});

it('blocks writes before authorizing or contacting Google unless explicitly enabled', async () => {
  vi.stubEnv('CALENDAR_WRITES_ENABLED', 'false');
  const rpc = vi.fn(); const fetched = vi.fn(); vi.stubGlobal('fetch', fetched);
  await expect(applyCalendar({ rpc } as unknown as WorkerClient, 'job', 'lease', 'action')).rejects.toThrow('calendar_writes_disabled');
  expect(rpc).not.toHaveBeenCalled(); expect(fetched).not.toHaveBeenCalled();
});
