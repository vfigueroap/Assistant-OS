import { GoogleToken } from './google.js';
import { jsonRequest, ProviderError } from '../http.js';
import { StateStore } from '../state.js';
import type { Capture } from '../ingest.js';

interface GmailPart { mimeType?: string; filename?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] }
interface GmailMessage { id: string; internalDate?: string; labelIds?: string[]; payload?: GmailPart }
export function plainGmail(part?: GmailPart): string {
  if (!part) return '';
  const own = part.mimeType === 'text/plain' && part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '';
  return [own, ...(part.parts ?? []).map(plainGmail)].filter(Boolean).join('\n').slice(0, 100000);
}
export function receiptAttachments(part?: GmailPart): GmailPart[] {
  if (!part) return [];
  const mime = part.mimeType ?? '';
  const own = part.filename && ['application/pdf', 'image/jpeg', 'image/png'].includes(mime) && part.body?.attachmentId ? [part] : [];
  return [...own, ...(part.parts ?? []).flatMap(receiptAttachments)];
}
export interface GmailOptions { ownerId: string; labelIds: string[]; senders: string[]; initialDays?: number }
export async function pollGmail(state: StateStore, options: GmailOptions, ingest: (capture: Capture) => Promise<unknown>, signal?: AbortSignal) {
  if (!options.labelIds.length || !options.senders.length) throw new ProviderError('gmail_label_and_sender_allowlists_required', false);
  const token = await new GoogleToken('GMAIL').get();
  const request = <T>(resource: string, params: Record<string, string> = {}) => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${resource}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return jsonRequest<T>(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  };
  const saved = await state.read<{ historyId?: string }>('gmail', {}); let ids: string[] = []; let finalCursor: string | undefined;
  const fullSync = async () => {
    const profile = await request<{ historyId: string }>('profile'); finalCursor = profile.historyId;
    let pages = 0;
    for (const labelId of options.labelIds) {
      let page: string | undefined;
      do {
        const result: { messages?: Array<{ id: string }>; nextPageToken?: string } = await request('messages', { q: `newer_than:${options.initialDays ?? 30}d`, labelIds: labelId, maxResults: '100', ...(page ? { pageToken: page } : {}) });
        ids.push(...(result.messages ?? []).map(m => m.id)); page = result.nextPageToken;
        if (++pages > 100) throw new ProviderError('gmail_initial_sync_limit', false);
      } while (page);
    }
  };
  if (!saved.historyId) await fullSync();
  else {
    try {
      let page: string | undefined; let pages = 0;
      do {
        const result: { history?: Array<{ messagesAdded?: Array<{ message: { id: string } }>; labelsAdded?: Array<{ message: { id: string } }> }>; historyId: string; nextPageToken?: string } = await request('history', { startHistoryId: saved.historyId, ...(page ? { pageToken: page } : {}) });
        for (const history of result.history ?? []) ids.push(...[...(history.messagesAdded ?? []), ...(history.labelsAdded ?? [])].map(e => e.message.id));
        page = result.nextPageToken; finalCursor = result.historyId;
        if (++pages > 100) throw new ProviderError('gmail_history_limit', false);
      } while (page);
    } catch (error) { if (error instanceof ProviderError && error.status === 404) await fullSync(); else throw error; }
  }
  for (const id of new Set(ids)) {
    let message: GmailMessage;
    try { message = await request<GmailMessage>(`messages/${encodeURIComponent(id)}`, { format: 'full' }); }
    catch (error) { if (error instanceof ProviderError && error.status === 404) continue; throw error; }
    if (!options.labelIds.some(label => message.labelIds?.includes(label))) continue;
    const headers = message.payload?.headers ?? [];
    const header = (name: string) => headers.find(h => h.name.toLowerCase() === name)?.value ?? '';
    const from = header('from').match(/<([^>]+)>/)?.[1] ?? header('from').trim();
    if (!options.senders.map(s => s.toLowerCase()).includes(from.toLowerCase())) continue;
    // Never fetch email links or render HTML, and never obey instructions in a receipt.
    const body = plainGmail(message.payload);
    const receivedAt = new Date(Number(message.internalDate ?? Date.now())).toISOString();
    if (body) await ingest({ source: 'gmail', externalId: id, ownerId: options.ownerId, bytes: new TextEncoder().encode(body), mime: 'text/plain', title: header('subject').slice(0, 240) || 'Notificación financiera', classification: 'financial_evidence', metadata: { message_id: id, sender: from, received_at: receivedAt } });
    for (const part of receiptAttachments(message.payload)) {
      if (!part.body?.attachmentId || (part.body.size ?? 0) > 20 * 1024 * 1024) continue;
      const attachment = await request<{data:string;size:number}>(`messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`);
      if (typeof attachment.data !== 'string' || attachment.size > 20 * 1024 * 1024) continue;
      const bytes = Buffer.from(attachment.data,'base64url');
      if (bytes.byteLength > 20 * 1024 * 1024 || bytes.byteLength !== attachment.size) continue;
      await ingest({source:'gmail',externalId:`${id}:attachment:${part.body.attachmentId}`,ownerId:options.ownerId,bytes,mime:part.mimeType!,title:(part.filename||'Adjunto').slice(0,240),classification:'financial_evidence',metadata:{message_id:id,sender:from,received_at:receivedAt}});
    }
  }
  if (finalCursor) await state.write('gmail', { historyId: finalCursor, synced_at: new Date().toISOString() });
}
