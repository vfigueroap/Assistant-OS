import { access } from 'node:fs/promises';
import { createApiServer } from '../dist/api/dev.js';

await access(new URL('../dist/web/index.html', import.meta.url));
await access(new URL('../dist/gym/index.html', import.meta.url));
process.env.APP_ORIGIN ||= 'http://127.0.0.1:5173';
const server = createApiServer(5173, true);
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
server.listen(5173, '127.0.0.1', () => console.log('Personal OS listo: http://127.0.0.1:5173'));
