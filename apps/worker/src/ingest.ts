import { createHash, randomUUID } from 'node:crypto';
import type { WorkerClient } from './client.js';
import { rpc } from './client.js';

export interface Capture {
  source: 'telegram' | 'gmail'; externalId: string; ownerId: string;
  bytes: Uint8Array; mime: string; title: string;
  classification: 'document' | 'financial_evidence'; metadata?: Record<string, unknown>;
}
export async function ingestCapture(client: WorkerClient, capture: Capture) {
  // Deterministic path makes a retry after upload/RPC interruption safe; never overwrite.
  const digest = createHash('sha256').update(capture.bytes).digest('hex');
  const externalHash = createHash('sha256').update(`${capture.source}:${capture.externalId}`).digest('hex');
  const storagePath = `${capture.ownerId}/captures/${externalHash}-${digest}`;
  const upload = await client.storage.from('personal-files').upload(storagePath, capture.bytes, { contentType: capture.mime, upsert: false });
  if (upload.error && !['409', 'Duplicate'].includes(String((upload.error as { statusCode?: string }).statusCode)) && !upload.error.message.toLowerCase().includes('already exists')) throw new Error('capture_upload_failed');
  return rpc<{ capture_id: string; job_id: string; duplicate: boolean }>(client, 'worker_ingest', {
    p_source: capture.source, p_external_id: capture.externalId,
    p_payload: { title: capture.title.slice(0, 240), file_name: capture.title.slice(0, 240), storage_path: storagePath, mime: capture.mime, sha256: digest, size_bytes: capture.bytes.byteLength, classification: capture.classification, metadata: capture.metadata ?? {} },
  });
}
