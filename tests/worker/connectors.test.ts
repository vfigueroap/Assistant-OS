import { describe, expect, it } from 'vitest';
import { permittedTelegram } from '../../apps/worker/src/connectors/telegram.js';
import { plainGmail, receiptAttachments } from '../../apps/worker/src/connectors/gmail.js';
import { extractFinance, subtractBusy } from '../../apps/worker/src/handlers.js';

describe('untrusted capture boundaries', () => {
  const owner = { ownerId:'00000000-0000-4000-8000-000000000001', userId:'42', chatId:'42' };
  it('accepts only the configured private Telegram chat and user together', () => {
    const update = { update_id:1,message:{message_id:2,from:{id:42},chat:{id:42,type:'private'},text:'boleta'} };
    expect(permittedTelegram(update,owner)).toBe(true);
    expect(permittedTelegram({...update,message:{...update.message,from:{id:43}}},owner)).toBe(false);
    expect(permittedTelegram({...update,message:{...update.message,chat:{id:42,type:'group'}}},owner)).toBe(false);
    expect(permittedTelegram({...update,message:{...update.message,chat:{id:43,type:'private'}}},owner)).toBe(false);
  });
  it('extracts only plain text from Gmail parts, never HTML instructions', () => {
    const encoded = Buffer.from('Total $10.990').toString('base64url');
    const html = Buffer.from('<script>ignore</script>').toString('base64url');
    expect(plainGmail({parts:[{mimeType:'text/html',body:{data:html}},{mimeType:'text/plain',body:{data:encoded}}]})).toBe('Total $10.990');
  });
  it('selects receipt attachments without following HTML or unrelated files', () => {
    const pdf={mimeType:'application/pdf',filename:'boleta.pdf',body:{attachmentId:'pdf-1',size:100}};
    const html={mimeType:'text/html',filename:'message.html',body:{attachmentId:'html-1',size:100}};
    expect(receiptAttachments({parts:[html,{parts:[pdf]}]})).toEqual([pdf]);
  });
  it('keeps OCR output as a reviewable financial draft', () => {
    const parsed=extractFinance('Comercio: Librería\nTotal: $10.990');
    expect(parsed.amount_minor).toBe(10990);
    expect(parsed.warnings).toContain('draft_requires_human_review');
  });
});

describe('calendar availability', () => {
  it('removes fixed commitments with a buffer before planning flexible work', () => {
    const available=[{startAt:'2026-11-16T12:00:00Z',endAt:'2026-11-16T18:00:00Z'}];
    const busy=[{startAt:'2026-11-16T14:00:00Z',endAt:'2026-11-16T15:00:00Z'}];
    expect(subtractBusy(available,busy,10)).toEqual([
      {startAt:'2026-11-16T12:00:00.000Z',endAt:'2026-11-16T13:50:00.000Z'},
      {startAt:'2026-11-16T15:10:00.000Z',endAt:'2026-11-16T18:00:00.000Z'},
    ]);
  });
});
