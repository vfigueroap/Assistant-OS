import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { jobKinds } from '@personal-ai-os/domain';
import { loadConfig } from './config.js';
import { StateStore } from './state.js';
import { workerClient, rpc } from './client.js';
import { executeJob, type LeasedJob } from './handlers.js';
import { ProviderError } from './http.js';
import { ingestCapture } from './ingest.js';
import { pollTelegram } from './connectors/telegram.js';
import { pollGmail } from './connectors/gmail.js';

const jobSchema = z.object({ id: z.uuid(), owner_id: z.uuid(), kind: z.enum(jobKinds), payload: z.record(z.string(), z.unknown()), lease_token: z.uuid(), attempt: z.number().optional() }).passthrough();
function log(event: string, data: Record<string, unknown> = {}) { console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data })); }
export async function main() {
  const config = await loadConfig(); const state = new StateStore(config.stateDirectory); const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
  await state.exclusive('worker-process', async () => {
    const client = await workerClient(config, state);
    const ownerId = process.env.WORKER_OWNER_ID;
    const capture = (value: Parameters<typeof ingestCapture>[1]) => ingestCapture(client, value);
    const background: Promise<void>[] = [];
    if (process.env.TELEGRAM_ENABLED === 'true') {
      if (!ownerId || !process.env.TELEGRAM_OWNER_USER_ID || !process.env.TELEGRAM_OWNER_CHAT_ID) throw new Error('Telegram owner IDs required');
      background.push((async () => { while (!stop.signal.aborted) { try { await pollTelegram(state, { ownerId, userId: process.env.TELEGRAM_OWNER_USER_ID!, chatId: process.env.TELEGRAM_OWNER_CHAT_ID!, maxBytes: config.maxFileBytes }, capture, stop.signal); } catch { if (!stop.signal.aborted) { log('telegram_unavailable'); await delay(30000, undefined, { signal: stop.signal }).catch(() => {}); } } } })());
    }
    if (process.env.GMAIL_ENABLED === 'true') {
      if (!ownerId) throw new Error('Gmail owner ID required');
      background.push((async () => { while (!stop.signal.aborted) { try { await pollGmail(state, { ownerId, labelIds: (process.env.GMAIL_LABEL_IDS ?? '').split(',').filter(Boolean), senders: (process.env.GMAIL_ALLOWED_SENDERS ?? '').split(',').filter(Boolean) }, capture, stop.signal); } catch { if (!stop.signal.aborted) log('gmail_unavailable'); } await delay(300000, undefined, { signal: stop.signal }).catch(() => {}); } })());
    }
    log('worker_started', { inference: process.env.EXTERNAL_AI_ENABLED === 'true' ? 'configured_api' : 'disabled', integrations: { telegram: process.env.TELEGRAM_ENABLED === 'true', gmail: process.env.GMAIL_ENABLED === 'true' } });
    while (!stop.signal.aborted) {
      try {
        const jobs = z.array(jobSchema).parse(await rpc(client, 'claim_jobs', { p_limit: 1 })) as LeasedJob[];
        for (const job of jobs) {
          const jobAbort = new AbortController(); const signal = AbortSignal.any([stop.signal, jobAbort.signal]);
          let heartbeating = false;
          const heartbeat = setInterval(() => { if (heartbeating) return; heartbeating = true; void rpc(client, 'heartbeat_job', { p_job_id: job.id, p_lease_token: job.lease_token }).catch(() => jobAbort.abort()).finally(() => { heartbeating = false; }); }, 20000);
          try {
            const result = await executeJob(client, job, config, state, signal);
            if (signal.aborted) throw new ProviderError('job_cancelled_or_lease_lost', false);
            await rpc(client, 'complete_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_result: result });
            if (job.kind === 'calendar.sync' && 'sync_cursor' in result) await state.write(`calendar-${Buffer.from(String(job.payload.connection_id)).toString('hex')}`, { sync_cursor: result.sync_cursor });
            log('job_completed', { job_id: job.id, kind: job.kind });
          } catch (error) {
            const code = error instanceof ProviderError ? error.code : 'job_execution_failed';
            await rpc(client, 'fail_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_error: code, p_retryable: error instanceof ProviderError ? error.retryable : true }).catch(() => log('lease_no_longer_owned', { job_id: job.id }));
            log('job_failed', { job_id: job.id, code });
          } finally { clearInterval(heartbeat); }
        }
      } catch { if (!stop.signal.aborted) log('queue_unavailable'); }
      await delay(config.pollMs, undefined, { signal: stop.signal }).catch(() => {});
    }
    await Promise.allSettled(background); client.auth.stopAutoRefresh(); log('worker_stopped');
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(() => { log('worker_start_failed_check_configuration'); process.exitCode = 1; });
