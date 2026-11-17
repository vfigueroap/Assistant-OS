import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ingestCapture } from '../../apps/worker/src/ingest.js';
import type { WorkerClient } from '../../apps/worker/src/client.js';
import type { WorkerConfig } from '../../apps/worker/src/config.js';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function configuration(): Promise<WorkerConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'personal-os-captures-')); directories.push(root);
  return { supabaseUrl: 'https://test.supabase.co', publishableKey: 'sb_publishable_test', email: undefined, password: undefined, stateDirectory: root, extractorUrl: 'http://127.0.0.1:8080/', pollMs: 5000, maxFileBytes: 20 * 1024 * 1024, bucket: 'personal-files', captureStorage: 'local', captureDirectory: root, dashboardInbox: undefined };
}
const capture = { source: 'gmail' as const, externalId: 'mail-1', ownerId: '00000000-0000-4000-8000-000000000001', bytes: new TextEncoder().encode('Private message.\nComercio: Librería\nTotal: $10.990'), mime: 'text/plain', title: 'Comprobante', classification: 'financial_evidence' as const };

it('keeps raw capture and extraction on the homelab while publishing a structured draft only', async () => {
  const config = await configuration();
  const call = vi.fn().mockResolvedValue({ data: { capture_id: 'capture', duplicate: false }, error: null });
  const client = { rpc: call, get storage() { throw new Error('Raw originals must not enter cloud storage'); } } as unknown as WorkerClient;
  await ingestCapture(client, capture, config);
  expect(call).toHaveBeenCalledTimes(1);
  const [name, args] = call.mock.calls[0]!;
  expect(name).toBe('worker_ingest_local');
  expect(args.p_payload.extraction.amount_minor).toBe(10990);
  expect(args.p_payload.extraction.warnings).toContain('draft_requires_human_review');
  expect(args.p_payload.local_ref).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(JSON.stringify(args)).not.toContain('Private message');
  expect(args.p_payload.extraction).not.toHaveProperty('description');
  const files = await readdir(config.captureDirectory);
  expect(files).toHaveLength(3);
  expect(await readFile(path.join(config.captureDirectory, files.find(file => file.endsWith('.bin'))!), 'utf8')).toContain('Private message');
});

it('retries a failed cloud publication without changing or duplicating the retained original', async () => {
  const config = await configuration();
  const call = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'network' } }).mockResolvedValueOnce({ data: { duplicate: true }, error: null });
  const client = { rpc: call } as unknown as WorkerClient;
  await expect(ingestCapture(client, { ...capture, metadata: { received_at: 'first' } }, config)).rejects.toThrow('rpc_worker_ingest_local_failed');
  await expect(ingestCapture(client, { ...capture, metadata: { received_at: 'retry' } }, config)).resolves.toEqual({ duplicate: true });
  expect(await readdir(config.captureDirectory)).toHaveLength(3);
  expect(call.mock.calls[0]![1]).toEqual(call.mock.calls[1]![1]);
});

it('publishes document metadata without inventing a summary or uploading extracted text', async () => {
  const config = await configuration();
  const call = vi.fn().mockResolvedValue({ data: { duplicate: false }, error: null });
  await ingestCapture({ rpc: call } as unknown as WorkerClient, { ...capture, classification: 'document', area: 'education' }, config);
  expect(call.mock.calls[0]![1].p_payload).toMatchObject({ classification: 'document', area: 'education' });
  expect(call.mock.calls[0]![1].p_payload).not.toHaveProperty('summary');
  expect(call.mock.calls[0]![1].p_payload).not.toHaveProperty('extraction');
});

it('preserves explicitly selected legacy cloud ingestion for existing installations', async () => {
  const config = { ...await configuration(), captureStorage: 'cloud' as const };
  const upload = vi.fn().mockResolvedValue({ error: null });
  const call = vi.fn().mockResolvedValue({ data: { duplicate: false }, error: null });
  const client = { storage: { from: vi.fn().mockReturnValue({ upload }) }, rpc: call } as unknown as WorkerClient;
  await ingestCapture(client, capture, config);
  expect(upload).toHaveBeenCalledOnce();
  expect(call.mock.calls[0]![0]).toBe('worker_ingest');
  expect(await readdir(config.captureDirectory)).toEqual([]);
});

it('retains long plain text in full while bounding its extraction cache', async () => {
  const config = await configuration();
  const bytes = new TextEncoder().encode('x'.repeat(2_000_001));
  const call = vi.fn().mockResolvedValue({ data: { duplicate: false }, error: null });
  await ingestCapture({ rpc: call } as unknown as WorkerClient, { ...capture, bytes }, config);
  const files = await readdir(config.captureDirectory);
  expect((await readFile(path.join(config.captureDirectory, files.find(file => file.endsWith('.bin'))!))).byteLength).toBe(bytes.byteLength);
  expect(call.mock.calls[0]![1].p_payload.extraction.warnings).toContain('local_text_truncated');
});
