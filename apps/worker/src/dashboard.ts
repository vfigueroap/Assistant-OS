import { lstat, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { maxDashboardBytes, parseDashboardDelivery, type DashboardDelivery } from '@personal-ai-os/domain';
import { z } from 'zod';
import { createPrivateFile, privateDirectory, readRegularFile, replacePrivateFile } from './local-files.js';
import type { WorkerClient } from './client.js';
import { ProviderError } from './http.js';

type Publication = { accepted: boolean; duplicate?: boolean; stale?: boolean };

export async function publishDashboard(client: WorkerClient, delivery: DashboardDelivery): Promise<Publication> {
  const result = await client.rpc('publish_dashboard', { p_delivery: delivery });
  if (result.error) throw new ProviderError('dashboard_publication_rejected', !['P0001', '42501', '22023', '23514'].includes(result.error.code));
  return result.data as Publication;
}

export async function updateRuntimePolicy(client: WorkerClient, inboxDirectory: string) {
  const result = await client.rpc('worker_runtime_policy');
  if (result.error) throw new Error('runtime_policy_unavailable');
  const policy = z.object({ paused: z.boolean(), observed_at: z.iso.datetime({ offset: true }), autonomy: z.literal('read_and_propose') }).strict().parse(result.data);
  const age = Date.now() - Date.parse(policy.observed_at);
  if (age < -30000 || age > 90000) throw new Error('runtime_policy_not_fresh');
  await replacePrivateFile(path.join(path.dirname(path.resolve(inboxDirectory)), 'control'), 'runtime-policy.json', new TextEncoder().encode(JSON.stringify(policy)), 0o640);
}

export async function publishInbox(directory: string, publish: (delivery: DashboardDelivery) => Promise<Publication>, signal?: AbortSignal) {
  const inbox = await privateDirectory(directory);
  const processed = await privateDirectory(path.join(inbox, 'processed'), 0o750);
  const quarantine = await privateDirectory(path.join(inbox, 'quarantine'));
  const result = { published: 0, quarantined: 0 };
  const names = (await readdir(inbox, { withFileTypes: true })).filter(item => !item.isDirectory() && item.name.endsWith('.json')).map(item => item.name).sort().slice(0, 32);
  for (const name of names) {
    if (signal?.aborted) break;
    const filePath = path.join(inbox, name);
    let delivery: DashboardDelivery;
    let original;
    try {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) throw new Error('invalid_delivery_filename');
      original = await readRegularFile(filePath, maxDashboardBytes);
      delivery = parseDashboardDelivery(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original.bytes)));
      if (name.toLowerCase() !== `${delivery.id.toLowerCase()}.json`) throw new Error('delivery_id_mismatch');
    } catch {
      const stat = await lstat(filePath);
      if (stat.isDirectory()) continue;
      const rejectedName = `${crypto.randomUUID()}.json`;
      await rename(filePath, path.join(quarantine, rejectedName));
      await createPrivateFile(quarantine, `${rejectedName}.error`, new TextEncoder().encode('invalid_dashboard_delivery'));
      result.quarantined++;
      continue;
    }
    // A provider failure leaves the original delivery in place for the next poll.
    let publication;
    try { publication = await publish(delivery); }
    catch (error) {
      if (!(error instanceof ProviderError) || error.retryable) throw error;
      const rejectedName = `${delivery.id}.${crypto.randomUUID()}.json`;
      await rename(filePath, path.join(quarantine, rejectedName));
      await createPrivateFile(quarantine, `${rejectedName}.error`, new TextEncoder().encode('dashboard_publication_rejected'));
      result.quarantined++;
      continue;
    }
    if (!publication || (!publication.accepted && !publication.duplicate && !publication.stale)) throw new Error('dashboard_publication_not_acknowledged');
    const current = await lstat(filePath);
    if (current.isSymbolicLink() || current.ino !== original.stat.ino || current.dev !== original.stat.dev || current.size !== original.stat.size || current.mtimeMs !== original.stat.mtimeMs) throw new Error('delivery_changed_during_publication');
    await rename(filePath, path.join(processed, `${delivery.id}.${crypto.randomUUID()}.json`));
    result.published++;
  }
  return result;
}
