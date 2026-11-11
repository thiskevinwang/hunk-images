import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ExtensionFileViewInput } from 'hunkdiff/extension';

export const MAX_BYTES = 20 * 1024 * 1024;
export type ReadBytes = (side: 'old' | 'new') => Promise<Uint8Array | null>;
// API 33 is optional. Do not add a required method to the API 32 declarations.
export type ImageInput = ExtensionFileViewInput & { readBytes?: ReadBytes };
const execute = promisify(execFile);

async function git(cwd: string, args: string[], signal: AbortSignal, limit = MAX_BYTES): Promise<Buffer | null> {
  signal.throwIfAborted();
  try {
    const { stdout } = await execute('git', ['--no-replace-objects', '--no-optional-locks', ...args], {
      cwd, signal, encoding: 'buffer', maxBuffer: limit, timeout: 1000,
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    signal.throwIfAborted();
    return stdout;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

/** Compare raw bytes with the Git blob identity in the reviewed patch. */
export function matchesObject(bytes: Uint8Array, id: string): boolean {
  const header = `blob ${bytes.length}\0`;
  return ['sha1', 'sha256'].some(algorithm =>
    createHash(algorithm).update(header).update(bytes).digest('hex').startsWith(id));
}

function isWithin(root: string, path: string): boolean {
  const value = relative(root, path);
  return value !== '' && !isAbsolute(value) && value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}

/** Read only a bounded regular file within the repository. */
async function readDisk(root: string, path: string, signal: AbortSignal): Promise<Buffer | null> {
  signal.throwIfAborted();
  if (isAbsolute(path) || !isWithin(root, resolve(root, path))) return null;
  try {
    const target = await realpath(resolve(root, path));
    if (!isWithin(root, target)) return null;
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) return null;
      // A concurrent writer can grow the file after stat; cap the actual read too.
      const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1));
      let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      signal.throwIfAborted();
      if (offset !== stat.size) return null;
      return bytes.subarray(0, offset);
    } finally { await file.close(); }
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

/** Prefer the host reader; otherwise resolve identities from this file's patch. */
export function createReadBytes(input: ImageInput, cwd: string): ReadBytes {
  if (typeof input.readBytes === 'function') return side => input.readBytes!(side);
  const indexes = [...input.file.patch.matchAll(/^index ([a-f0-9]{4,64})\.\.([a-f0-9]{4,64})(?: [0-7]{6})?\r?$/gm)];
  const index = indexes.length === 1 ? indexes[0] : undefined;
  let root: Promise<string | null> | undefined;
  function repoRoot(): Promise<string | null> {
    return root ??= git(cwd, ['rev-parse', '--show-toplevel'], input.signal, 8192)
      .then(value => value ? realpath(value.toString().replace(/\r?\n$/, '')).catch(() => null) : null);
  }
  return async side => {
    input.signal.throwIfAborted();
    const id = index?.[side === 'old' ? 1 : 2];
    if (id && /^0+$/.test(id)) return null;
    // Hunk marks untracked files explicitly. They have no stored old version or patch hash.
    const untracked = input.file.isUntracked === true && side === 'new';
    if (!id && !untracked) return null;
    const directory = await repoRoot();
    if (!directory) return null;
    if (id) {
      const resolved = await git(directory, ['rev-parse', `--disambiguate=${id}`], input.signal, 8192);
      if (!resolved) return null;
      const objects = resolved.toString().trim().split('\n').filter(Boolean);
      if (objects.length > 1) return null;
      const object = objects[0];
      if (object) {
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object) || !object.startsWith(id)) return null;
        const size = await git(directory, ['cat-file', '-s', object], input.signal, 128);
        if (!size) return null;
        const length = Number(size.toString().trim());
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BYTES) return null;
        const bytes = await git(directory, ['cat-file', 'blob', object], input.signal);
        return bytes && bytes.length === length && matchesObject(bytes, object) ? bytes : null;
      }
    }
    const path = side === 'old' ? input.file.previousPath ?? input.file.path : input.file.path;
    const bytes = await readDisk(directory, path, input.signal);
    if (!bytes) return null;
    return id ? (matchesObject(bytes, id) ? bytes : null) : bytes;
  };
}
