import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** One local writer per state directory. Atomic replacement, never append partial JSON. */
export class StateStore {
  constructor(readonly directory: string) {}
  private file(key: string) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(key)) throw new Error('Invalid state key');
    return path.join(this.directory, `${key}.json`);
  }
  async read<T>(key: string, fallback: T): Promise<T> {
    try { return JSON.parse(await readFile(this.file(key), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
  }
  async write(key: string, value: unknown) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = this.file(key);
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, destination);
  }
  async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.directory, `${key}.lock`);
    const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error(`State ${key} is locked; run only one worker per directory. Inspect stale locks after recovery.`); });
    try { await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); return await operation(); }
    finally { await lock.close(); await rm(lockPath, { force: true }); }
  }
  authStorage() {
    return {
      getItem: async (key: string) => (await this.read<Record<string, string>>('auth', {}))[key] ?? null,
      setItem: async (key: string, value: string) => { const data = await this.read<Record<string, string>>('auth', {}); data[key] = value; await this.write('auth', data); },
      removeItem: async (key: string) => { const data = await this.read<Record<string, string>>('auth', {}); delete data[key]; await this.write('auth', data); },
    };
  }
}
