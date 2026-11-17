import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function secret(name: string): Promise<string | undefined> {
  const file = process.env[`${name}_FILE`];
  return file ? (await readFile(file, 'utf8')).trim() : process.env[name];
}
export function integer(value: string | undefined, fallback: number, min = 1, max = 1_000_000): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('Invalid integer configuration');
  return number;
}
export function httpsUrl(value: string, allowLocal = false): URL {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1', 'extractor'].includes(url.hostname)))) throw new Error('HTTPS required');
  return url;
}
export async function loadConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY; no account is connected by default');
  httpsUrl(supabaseUrl, process.env.ALLOW_LOCAL_SUPABASE === 'true');
  if (publishableKey.startsWith('sb_secret_')) throw new Error('Worker must never use a Supabase secret key');
  if (publishableKey.includes('.')) {
    try { if (JSON.parse(Buffer.from(publishableKey.split('.')[1]!, 'base64url').toString()).role !== 'anon') throw new Error(); }
    catch { throw new Error('Only publishable or legacy anon keys allowed'); }
  }
  const captureStorage = process.env.CAPTURE_STORAGE ?? 'local';
  if (!['local', 'cloud'].includes(captureStorage)) throw new Error('CAPTURE_STORAGE must be local or cloud');
  return {
    supabaseUrl, publishableKey,
    email: process.env.WORKER_EMAIL ?? process.env.SUPABASE_WORKER_EMAIL,
    password: await secret('WORKER_PASSWORD') ?? await secret('SUPABASE_WORKER_PASSWORD'),
    stateDirectory: path.resolve(process.env.WORKER_STATE_DIR ?? '.local/worker'),
    extractorUrl: httpsUrl(process.env.EXTRACTOR_URL ?? 'http://127.0.0.1:8080', true).toString(),
    pollMs: integer(process.env.WORKER_POLL_MS, 5000, 1000, 60000),
    maxFileBytes: 20 * 1024 * 1024,
    bucket: 'personal-files',
    captureStorage: captureStorage as 'local' | 'cloud',
    captureDirectory: path.resolve(process.env.CAPTURE_LOCAL_DIR ?? '.local/homelab/captures'),
    dashboardInbox: process.env.DASHBOARD_INBOX_DIR ? path.resolve(process.env.DASHBOARD_INBOX_DIR) : undefined,
  };
}
export type WorkerConfig = Awaited<ReturnType<typeof loadConfig>>;
