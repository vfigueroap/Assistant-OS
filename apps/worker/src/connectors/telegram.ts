import { secret } from '../config.js';
import { boundedBody, jsonRequest, ProviderError } from '../http.js';
import { StateStore } from '../state.js';
import type { Capture } from '../ingest.js';

interface TelegramFile { file_id: string; file_size?: number; mime_type?: string; file_name?: string }
interface TelegramUpdate { update_id: number; message?: { message_id: number; from?: { id: number }; chat: { id: number; type: string }; text?: string; caption?: string; photo?: TelegramFile[]; document?: TelegramFile } }
interface TelegramResponse<T> { ok: boolean; result: T; parameters?: { retry_after?: number } }
export interface TelegramOptions { ownerId: string; userId: string; chatId: string; maxBytes?: number }
export function permittedTelegram(update: TelegramUpdate, options: TelegramOptions): boolean {
  const message = update.message;
  return !!message && message.chat.type === 'private' && String(message.from?.id) === options.userId && String(message.chat.id) === options.chatId;
}
export async function pollTelegram(state: StateStore, options: TelegramOptions, ingest: (capture: Capture) => Promise<unknown>, signal?: AbortSignal) {
  const token = await secret('TELEGRAM_BOT_TOKEN'); if (!token) throw new ProviderError('telegram_not_configured', false);
  const saved = await state.read('telegram', { offset: 0 });
  // getUpdates and webhooks are mutually exclusive. Do not silently delete an owner's webhook.
  const hook = await jsonRequest<TelegramResponse<{ url: string }>>(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal });
  if (hook.result.url) throw new ProviderError('telegram_existing_webhook_disable_manually', false);
  const updates = await jsonRequest<TelegramResponse<TelegramUpdate[]>>(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset: saved.offset, timeout: 25, allowed_updates: ['message'] }), signal,
  }, 35000);
  if (!updates.ok) throw new ProviderError('telegram_poll_failed', true);
  for (const update of updates.result) {
    if (update.update_id < saved.offset) continue;
    try {
      if (permittedTelegram(update, options)) {
        const message = update.message!; const file = message.document ?? message.photo?.at(-1);
        let bytes: Uint8Array; let mime: string;
        if (file) {
          if ((file.file_size ?? 0) > (options.maxBytes ?? 20 * 1024 * 1024)) throw new ProviderError('telegram_file_too_large_use_pwa', false);
          mime = file.mime_type ?? (message.photo ? 'image/jpeg' : 'application/octet-stream');
          if (!['application/pdf', 'image/jpeg', 'image/png', 'text/plain'].includes(mime)) throw new ProviderError('telegram_unsupported_file', false);
          const info = await jsonRequest<TelegramResponse<{ file_path: string }>>(`https://api.telegram.org/bot${token}/getFile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: file.file_id }), signal });
          const filePath = info.result.file_path;
          if (!/^[a-zA-Z0-9_./-]+$/.test(filePath) || filePath.includes('..')) throw new ProviderError('telegram_invalid_file_path', false);
          const download = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
          bytes = await boundedBody(download, options.maxBytes ?? 20 * 1024 * 1024);
        } else if (message.text && !message.text.startsWith('/start')) {
          bytes = new TextEncoder().encode(message.text.slice(0, 16000)); mime = 'text/plain';
        } else { saved.offset = update.update_id + 1; await state.write('telegram', saved); continue; }
        await ingest({ source: 'telegram', externalId: `${message.chat.id}:${message.message_id}`, ownerId: options.ownerId, bytes, mime,
          title: file?.file_name ?? 'Captura Telegram', classification: (message.caption ?? message.text ?? '').startsWith('/documento') ? 'document' : 'financial_evidence',
          metadata: { message_id: message.message_id, received_at: new Date().toISOString() },
        });
      }
    } catch (error) {
      if (!(error instanceof ProviderError) || error.retryable) throw error;
      const rejected = await state.read<Array<{ id: number; reason: string }>>('telegram-rejected', []);
      await state.write('telegram-rejected', [...rejected, { id: update.update_id, reason: error.code }].slice(-100));
    }
    // Durable ingestion (or durable rejection record) comes before acknowledging Telegram.
    saved.offset = update.update_id + 1; await state.write('telegram', saved);
  }
}
