import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { handleRequest } from './handler.js';

if (existsSync('.env')) process.loadEnvFile('.env');
export function createApiServer(port = Number(process.env.API_PORT || 8787), servePortal = false) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be an integer between 1 and 65535.');
  const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/gym' && ['GET', 'HEAD'].includes(incoming.method || 'GET')) {
      outgoing.writeHead(308, { location: '/gym/' }); outgoing.end(); return;
    }
    const gym = url.pathname.startsWith('/gym/') && !url.pathname.startsWith('/gym/api/');
    const portal = servePortal && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/gym/');
    if ((gym || portal) && ['GET', 'HEAD'].includes(incoming.method || 'GET')) {
      const staticRoot = fileURLToPath(new URL(gym ? '../../dist/gym/' : '../../dist/web/', import.meta.url));
      const relative = decodeURIComponent(gym ? url.pathname.slice(4) : url.pathname);
      const requested = path.resolve(staticRoot, '.' + relative, relative.endsWith('/') ? 'index.html' : '');
      if (!requested.startsWith(staticRoot)) { outgoing.writeHead(403); outgoing.end(); return; }
      let filename: string;
      try {
        const resolvedRoot = await realpath(staticRoot);
        try { filename = await realpath(requested); }
        catch (error) { if (gym || path.extname(relative)) throw error; filename = await realpath(path.join(staticRoot, 'index.html')); }
        if (!filename.startsWith(resolvedRoot + path.sep)) { outgoing.writeHead(403); outgoing.end(); return; }
      } catch { outgoing.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); outgoing.end(gym ? 'Compila el gimnasio con npm run build:gym.' : 'Compila el portal con npm run build:web.'); return; }
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
      const bytes = await readFile(filename);
      outgoing.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'service-worker-allowed': gym ? '/gym/' : '/' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : bytes); return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const init: RequestInit & { duplex?: string } = { method: incoming.method, headers };
    if (!['GET', 'HEAD'].includes(incoming.method || 'GET')) { init.body = Readable.toWeb(incoming) as ReadableStream; init.duplex = 'half'; }
    const response = await handleRequest(new Request(`http://127.0.0.1:${port}${incoming.url}`, init));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    outgoing.end(JSON.stringify({ error: 'No se pudo completar la solicitud.' }));
  }
  });
  server.requestTimeout = 60000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.API_PORT || 8787);
  const server = createApiServer(port);
  server.listen(port, '127.0.0.1', () => console.log(`Personal OS API: http://127.0.0.1:${port}`));
  server.on('error', () => { console.error('No se pudo iniciar la API. Revisa API_PORT y si ya está en uso.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
}
