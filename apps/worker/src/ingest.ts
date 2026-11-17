import { createHash } from 'node:crypto';
import path from 'node:path';
import { jobResultSchemas, type AreaId } from '@personal-ai-os/domain';
import type { WorkerClient } from './client.js';
import { rpc } from './client.js';
import type { WorkerConfig } from './config.js';
import { createPrivateFile, readRegularFile } from './local-files.js';
import { extractFinance } from './handlers.js';
import { jsonRequest, ProviderError } from './http.js';

export interface Capture {
  source: 'telegram' | 'gmail'; externalId: string; ownerId: string;
  bytes: Uint8Array; mime: string; title: string;
  classification: 'document' | 'financial_evidence'; area?: AreaId; metadata?: Record<string, unknown>;
}
export async function ingestCapture(client: WorkerClient, capture: Capture, config: WorkerConfig, signal?: AbortSignal) {
  if (capture.bytes.byteLength > config.maxFileBytes) throw new ProviderError('capture_too_large', false);
  // Deterministic path makes a retry after upload/RPC interruption safe; never overwrite.
  const digest = createHash('sha256').update(capture.bytes).digest('hex');
  const externalHash = createHash('sha256').update(`${capture.source}:${capture.externalId}`).digest('hex');
  if (config.captureStorage === 'local') {
    await createPrivateFile(config.captureDirectory, `${digest}.bin`, capture.bytes, 0o640);
    const manifestName = `${externalHash}-${digest}.capture.json`;
    const manifest = { source: capture.source, external_id: capture.externalId, sha256: digest, mime: capture.mime, title: capture.title.slice(0, 240), classification: capture.classification, area: capture.area ?? (capture.classification === 'financial_evidence' ? 'work' : 'education'), metadata: capture.metadata ?? {} };
    try {
      const existing = JSON.parse((await readRegularFile(path.join(config.captureDirectory, manifestName), 256 * 1024)).bytes.toString('utf8'));
      if (existing.sha256 !== digest || existing.external_id !== capture.externalId || existing.source !== capture.source) throw new Error('capture_manifest_identity_conflict');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await createPrivateFile(config.captureDirectory, manifestName, new TextEncoder().encode(JSON.stringify(manifest)), 0o640);
    }
    let extracted;
    const extractedName = `${externalHash}-${digest}.extracted.json`;
    try { extracted = jobResultSchemas['document.extract'].parse(JSON.parse((await readRegularFile(path.join(config.captureDirectory, extractedName), 3 * 1024 * 1024)).bytes.toString('utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (capture.mime === 'text/plain') {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(capture.bytes);
        // Bound even JSON-escaped control characters within the 3 MiB extraction cache.
        const excerpt = text.slice(0, 450000);
        extracted = jobResultSchemas['document.extract'].parse({ text: excerpt, fragments: excerpt ? [{ locator: { line: 1 }, text: excerpt.slice(0, 30000) }] : [], warnings: excerpt.length < text.length ? ['local_text_truncated'] : [] });
      } else {
        const endpoint = new URL(config.extractorUrl);
        if (!['127.0.0.1', 'localhost', 'extractor', '[::1]'].includes(endpoint.hostname)) throw new ProviderError('local_capture_requires_homelab_extractor', false);
        const form = new FormData();
        form.append('file', new Blob([Buffer.from(capture.bytes)], { type: capture.mime }), capture.title.replace(/[/\\]/g, '_'));
        extracted = jobResultSchemas['document.extract'].parse(await jsonRequest(new URL('/extract', endpoint), { method: 'POST', body: form, signal }, 55000));
      }
      const bytes = new TextEncoder().encode(JSON.stringify(extracted));
      if (bytes.byteLength > 3 * 1024 * 1024) throw new ProviderError('local_extraction_too_large', false);
      await createPrivateFile(config.captureDirectory, extractedName, bytes, 0o640);
    }
    const { description: _rawExcerpt, ...financial } = extractFinance(extracted.text ?? extracted.fragments.map(part => part.text).join('\n'));
    return rpc<{ capture_id: string; transaction_id?: string; duplicate: boolean }>(client, 'worker_ingest_local', {
      p_source: capture.source, p_external_id: capture.externalId,
      p_payload: { title: manifest.title, sha256: digest, mime: capture.mime, size_bytes: capture.bytes.byteLength, local_ref: `sha256:${digest}`, classification: capture.classification, area: manifest.area,
        ...(capture.classification === 'financial_evidence' ? { extraction: { ...financial, warnings: [...(financial.warnings ?? []), ...(extracted.warnings ?? [])] } } : {}),
      },
    });
  }
  const storagePath = `${capture.ownerId}/captures/${externalHash}-${digest}`;
  const upload = await client.storage.from('personal-files').upload(storagePath, capture.bytes, { contentType: capture.mime, upsert: false });
  if (upload.error && !['409', 'Duplicate'].includes(String((upload.error as { statusCode?: string }).statusCode)) && !upload.error.message.toLowerCase().includes('already exists')) throw new Error('capture_upload_failed');
  return rpc<{ capture_id: string; job_id: string; duplicate: boolean }>(client, 'worker_ingest', {
    p_source: capture.source, p_external_id: capture.externalId,
    p_payload: { title: capture.title.slice(0, 240), file_name: capture.title.slice(0, 240), storage_path: storagePath, mime: capture.mime, sha256: digest, size_bytes: capture.bytes.byteLength, classification: capture.classification, metadata: capture.metadata ?? {} },
  });
}
