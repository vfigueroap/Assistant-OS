import { readFile } from 'node:fs/promises';
import { beforeEach, expect, it, vi } from 'vitest';
import { handleRequest } from '../../apps/api/handler.js';
import deployment from '../../api/index.js';

vi.mock('../../apps/api/handler.js', () => ({ handleRequest: vi.fn(async () => Response.json({ ok: true })) }));
beforeEach(() => { vi.clearAllMocks(); });

it('delegates public URLs unchanged and restores rewritten API paths', async () => {
  const direct = new Request('https://portal.invalid/api/config');
  await deployment.fetch(direct);
  expect(handleRequest).toHaveBeenLastCalledWith(direct);
  await deployment.fetch(new Request('https://portal.invalid/api/index?__route=/gym/api/snapshots/upload/chunks/0&check=kept'));
  const forwarded = vi.mocked(handleRequest).mock.calls.at(-1)![0];
  expect(forwarded.url).toBe('https://portal.invalid/gym/api/snapshots/upload/chunks/0?check=kept');
});

it('preserves streamed mutation bodies, methods, auth headers and cancellation', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ state: { note: 'á'.repeat(1000) }, baseRev: 7 }));
  for (const method of ['POST', 'PUT']) {
    const controller = new AbortController();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 50)); controller.enqueue(bytes.subarray(50)); controller.close(); } });
    const request = new Request('https://portal.invalid/api/index?__route=/gym/api/data', { method, headers: { authorization: 'Bearer owner-session', 'content-type': 'application/json', origin: 'https://portal.invalid' }, body: stream, signal: controller.signal, duplex: 'half' } as RequestInit);
    await deployment.fetch(request);
    const forwarded = vi.mocked(handleRequest).mock.calls.at(-1)![0];
    expect(forwarded.method).toBe(method);
    expect(forwarded.headers.get('authorization')).toBe('Bearer owner-session');
    expect(forwarded.headers.get('origin')).toBe('https://portal.invalid');
    expect(await forwarded.text()).toBe(new TextDecoder().decode(bytes));
    controller.abort();
    expect(forwarded.signal.aborted).toBe(true);
  }
});

it('rejects a rewrite destination outside the application API', async () => {
  const response = await deployment.fetch(new Request('https://portal.invalid/api/index?__route=https://foreign.invalid/api/config'));
  expect(response.status).toBe(400);
  expect(handleRequest).not.toHaveBeenCalled();
});

it('keeps one API entry, shared static output and the SPA fallback after API routes', async () => {
  const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  expect(config.outputDirectory).toBe('dist');
  expect(config.buildCommand).toBe('npm run build:web && npm run build:gym');
  expect(config.redirects).toContainEqual({ source: '/gym', destination: '/gym/', permanent: true });
  expect(config.rewrites.slice(0, 2)).toEqual([
    { source: '/api/:path*', destination: '/api/index?__route=/api/:path*' },
    { source: '/gym/api/:path*', destination: '/api/index?__route=/gym/api/:path*' },
  ]);
  const fallback = config.rewrites.at(-1);
  expect(fallback.destination).toBe('/web/index.html');
  const portalRoute = new RegExp('^' + fallback.source + '$');
  for (const pathname of ['/', '/login', '/settings']) expect(portalRoute.test(pathname)).toBe(true);
  for (const pathname of ['/api/absent', '/gym/assets/absent.js', '/web/assets/absent.js']) expect(portalRoute.test(pathname)).toBe(false);
  const manifest = JSON.parse(await readFile(new URL('../../apps/web/public/manifest.webmanifest', import.meta.url), 'utf8'));
  expect(new URL(manifest.icons[0].src, 'https://portal.invalid/web/manifest.webmanifest').pathname).toBe('/web/icon.svg');
  expect(new URL(manifest.icons[0].src, 'https://portal.invalid/manifest.webmanifest').pathname).toBe('/icon.svg');
});
