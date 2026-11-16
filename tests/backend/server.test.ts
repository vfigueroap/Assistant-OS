import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../../apps/api/dev.js';

const server = createApiServer(8787, true);
let base: string;
beforeAll(async () => {
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) vi.stubEnv(name, '');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); vi.unstubAllEnvs(); });

it('serves JSON through the actual HTTP adapter and refuses traversal outside the gym bundle', async () => {
  expect(await (await fetch(base + '/api/health')).json()).toEqual({ application: 'personal-os', status: 'ok', cloudConfigured: false });
  for (const route of ['/', '/login', '/settings']) {
    const page = await fetch(base + route);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<html lang="es">');
  }
  expect((await fetch(base + '/assets/definitely-absent.js')).status).toBe(404);
  expect((await fetch(base + '/%2f..%2fpackage.json')).status).toBe(403);
  const config = await fetch(base + '/api/config');
  expect(config.status).toBe(200);
  expect(await config.json()).toEqual({ configured: false, supabaseUrl: '', supabasePublishableKey: '' });
  expect((await fetch(base + '/gym', { redirect: 'manual' })).headers.get('location')).toBe('/gym/');
  expect((await fetch(base + '/gym/%2f..%2f..%2fpackage.json')).status).toBe(403);
  expect((await fetch(base + '/gym/definitely-absent-file.js')).status).toBe(404);
});
