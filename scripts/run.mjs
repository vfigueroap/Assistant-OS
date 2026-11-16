import { createServer, preview, runnerImport } from 'vite';

const mode = process.argv[2] ?? 'dev';
if (!['dev', 'preview', 'api', 'worker', 'setup'].includes(mode)) throw new Error('Usa dev, preview, api, worker o setup.');

if (mode === 'worker' || mode === 'setup') {
  try {
    const { module } = await runnerImport(mode === 'worker' ? './apps/worker/src/index.ts' : './scripts/setup.ts');
    await (mode === 'worker' ? module.main() : module.setup());
  } catch (error) {
    console.error(mode === 'worker' ? 'No se pudo iniciar el worker. Revisa la configuración y las credenciales.' : error instanceof Error ? error.message : 'No se pudo completar setup.');
    process.exitCode = 1;
  }
} else {
  const { module: { createApiServer } } = await runnerImport('./apps/api/dev.ts');
  process.env.APP_ORIGIN ||= 'http://127.0.0.1:5173';
  const apiPort = Number(process.env.API_PORT ?? 8787);
  const api = createApiServer(apiPort);
  let web;
  async function stop() {
    if (web && 'close' in web) await web.close();
    else if (web) await new Promise(resolve => web.httpServer.close(resolve));
    api.close();
  }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  api.on('error', error => { console.error(error.message); void stop(); process.exitCode = 1; });
  try {
    await new Promise((resolve, reject) => { api.once('error', reject); api.listen(apiPort, '127.0.0.1', resolve); });
    if (mode !== 'api') {
      const options = { configFile: 'apps/web/vite.config.ts', server: { host: '127.0.0.1', strictPort: true }, preview: { host: '127.0.0.1', port: 5173, strictPort: true } };
      web = mode === 'preview' ? await preview(options) : await createServer(options);
      if ('listen' in web) await web.listen();
      web.printUrls();
    } else console.log(`Personal OS API: http://127.0.0.1:${apiPort}`);
  } catch (error) { await stop(); throw error; }
}
