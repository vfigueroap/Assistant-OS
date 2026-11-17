import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishDashboard, publishInbox, updateRuntimePolicy } from '../../apps/worker/src/dashboard.js';
import { ProviderError } from '../../apps/worker/src/http.js';
import type { WorkerClient } from '../../apps/worker/src/client.js';

const directories: string[] = [];
const delivery = { version: 1, id: '00000000-0000-4000-8000-000000000001', area: 'system', source: 'homelab.telemetry', observed_at: '2026-11-16T12:00:00Z', summary: 'Estado observado', metrics: [], items: [], references: [] };
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'personal-os-inbox-')); directories.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('dashboard publication boundary', () => {
  it('retains a delivery on provider failure and archives only after acknowledgement', async () => {
    const root = await directory();
    const file = path.join(root, `${delivery.id}.json`);
    await writeFile(file, JSON.stringify(delivery));
    await expect(publishInbox(root, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(delivery);
    const publish = vi.fn().mockResolvedValue({ accepted: false, duplicate: true });
    await expect(publishInbox(root, publish)).resolves.toEqual({ published: 1, quarantined: 0 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect((await readdir(root)).filter(name => name.endsWith('.json'))).toEqual([]);
    expect(await readdir(path.join(root, 'processed'))).toHaveLength(1);
    if (process.platform === 'linux') expect((await stat(path.join(root, 'processed'))).mode & 0o050).toBe(0o050);
    await publishInbox(root, publish);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('quarantines malformed, oversized and mismatched deliveries without publishing their content', async () => {
    const root = await directory();
    await writeFile(path.join(root, 'broken.json'), '{secret-not-json');
    await writeFile(path.join(root, '00000000-0000-4000-8000-000000000002.json'), JSON.stringify(delivery));
    await writeFile(path.join(root, '00000000-0000-4000-8000-000000000003.json'), 'x'.repeat(256 * 1024 + 1));
    const publish = vi.fn();
    await expect(publishInbox(root, publish)).resolves.toEqual({ published: 0, quarantined: 3 });
    expect(publish).not.toHaveBeenCalled();
    const errors = (await readdir(path.join(root, 'quarantine'))).filter(name => name.endsWith('.error'));
    for (const name of errors) expect(await readFile(path.join(root, 'quarantine', name), 'utf8')).toBe('invalid_dashboard_delivery');
  });

  it('rejects a redirected inbox before reading or publishing anything', async () => {
    const root = await directory(); const outside = await directory();
    await symlink(outside, path.join(root, 'inbox'), process.platform === 'win32' ? 'junction' : 'dir');
    const publish = vi.fn();
    await expect(publishInbox(path.join(root, 'inbox'), publish)).rejects.toThrow('local_directory_not_regular');
    expect(publish).not.toHaveBeenCalled();
  });

  it('quarantines a permanent scope rejection and preserves transient failures for retry', async () => {
    const root = await directory(); await writeFile(path.join(root, `${delivery.id}.json`), JSON.stringify(delivery));
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'never log me' } }) } as unknown as WorkerClient;
    await expect(publishInbox(root, value => publishDashboard(client, value))).resolves.toEqual({ published: 0, quarantined: 1 });
    expect(client.rpc).toHaveBeenCalledWith('publish_dashboard', { p_delivery: delivery });
    await writeFile(path.join(root, `${delivery.id}.json`), JSON.stringify(delivery));
    await expect(publishInbox(root, async () => { throw new ProviderError('retry', true); })).rejects.toThrow('retry');
    expect(JSON.parse(await readFile(path.join(root, `${delivery.id}.json`), 'utf8'))).toEqual(delivery);
  });

  it('publishes a fresh pause policy atomically without replacing it on invalid or unavailable responses', async () => {
    const root = await directory();
    const policy = { paused: true, observed_at: new Date().toISOString(), autonomy: 'read_and_propose' };
    const rpc = vi.fn().mockResolvedValue({ data: policy, error: null });
    const client = { rpc } as unknown as WorkerClient;
    await updateRuntimePolicy(client, path.join(root, 'inbox'));
    const file = path.join(root, 'control', 'runtime-policy.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(policy);
    rpc.mockResolvedValue({ data: { ...policy, observed_at: '2020-01-01T00:00:00Z' }, error: null });
    await expect(updateRuntimePolicy(client, path.join(root, 'inbox'))).rejects.toThrow('runtime_policy_not_fresh');
    rpc.mockResolvedValue({ data: null, error: { code: 'network' } });
    await expect(updateRuntimePolicy(client, path.join(root, 'inbox'))).rejects.toThrow('runtime_policy_unavailable');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(policy);
  });
});
