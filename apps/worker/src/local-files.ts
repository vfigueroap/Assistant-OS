import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export async function privateDirectory(directory: string, mode = 0o700): Promise<string> {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  let current = root;
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    try { await mkdir(current, { mode: index === parts.length - 1 ? mode : 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('local_directory_not_regular');
  }
  if (path.relative(resolved, await realpath(resolved)) !== '') throw new Error('local_directory_redirected');
  return resolved;
}

export async function readRegularFile(filePath: string, maximum: number) {
  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('local_file_not_regular');
  if (before.size > maximum) throw new Error('local_file_too_large');
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('local_file_changed');
    const bytes = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < bytes.length) {
      const next = await handle.read(bytes, count, bytes.length - count, null);
      if (!next.bytesRead) break;
      count += next.bytesRead;
    }
    if (count > maximum) throw new Error('local_file_too_large');
    return { bytes: bytes.subarray(0, count), stat };
  } finally { await handle.close(); }
}

export async function createPrivateFile(directory: string, name: string, bytes: Uint8Array, mode = 0o600): Promise<boolean> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('invalid_local_file_name');
  const root = await privateDirectory(directory);
  const destination = path.join(root, name);
  const temporary = path.join(root, `.${name}.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', mode);
  try { await handle.writeFile(bytes); await handle.chmod(mode); await handle.sync(); }
  finally { await handle.close(); }
  try {
    await link(temporary, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readRegularFile(destination, bytes.byteLength);
    if (!existing.bytes.equals(Buffer.from(bytes))) throw new Error('local_file_identity_conflict');
    return false;
  } finally { await rm(temporary, { force: true }); }
}

export async function replacePrivateFile(directory: string, name: string, bytes: Uint8Array, mode = 0o600) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('invalid_local_file_name');
  const root = await privateDirectory(directory);
  const destination = path.join(root, name);
  try {
    const stat = await lstat(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('local_file_not_regular');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = path.join(root, `.${name}.${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', mode);
  try { await handle.writeFile(bytes); await handle.chmod(mode); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
}
