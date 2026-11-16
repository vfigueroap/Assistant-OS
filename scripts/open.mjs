import { spawn } from 'node:child_process';
import { open, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'http://127.0.0.1:5173';
async function running() {
  try {
    const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) });
    const health = response.ok ? await response.json().catch(() => null) : null;
    if (health?.application !== 'personal-os') throw new Error('El puerto 5173 está ocupado por otra aplicación.');
    return true;
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'TimeoutError') return false;
    throw error;
  }
}
try {
  if (!await running()) {
    await access(new URL('../dist/api/dev.js', import.meta.url));
    await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
    const log = await open(new URL('../.local/server.log', import.meta.url), 'a');
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'scripts/serve.mjs'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    child.on('error', error => console.error(error.message));
    child.unref(); await log.close();
    for (let attempt = 0; attempt < 60 && !await running(); attempt++) await delay(250);
    if (!await running()) throw new Error('No se pudo iniciar Personal OS. Revisa .local/server.log.');
  }
  console.log('Personal OS listo: ' + url);
  if (!process.argv.includes('--no-browser')) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('Abre ' + url + ' en tu navegador.'));
    browser.unref();
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'No se pudo abrir Personal OS.'); process.exitCode = 1; }
