import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadBytes, type ImageInput } from '../src/bytes';

const before = readFileSync(new URL('./fixtures/before.png', import.meta.url));
const after = readFileSync(new URL('./fixtures/after.png', import.meta.url));
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function repository(format = 'sha1') {
  const cwd = mkdtempSync(join(tmpdir(), 'hunk-images-'));
  folders.push(cwd);
  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  }
  git('init', '-q', `--object-format=${format}`);
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  function write(bytes: Uint8Array, path = 'image.png') { writeFileSync(join(cwd, path), bytes); }
  function commit() { git('add', '.'); git('commit', '-qm', 'Test image'); }
  write(before); commit();
  function input(patch: string, file = {}): ImageInput {
    return { file: { id: 'image', path: 'image.png', patch, changeType: 'change', hunks: [], stats: { additions: 0, deletions: 0 }, metadata: {}, agent: null, ...file },
      signal: new AbortController().signal, width: 80, changes: [], readDocument: async () => null } as ImageInput;
  }
  return { cwd, git, write, commit, input };
}

test('unstaged images use the index as Before, not HEAD', async () => {
  const repo = repository();
  repo.write(after); repo.git('add', '.'); repo.write(before);
  const read = createReadBytes(repo.input(repo.git('diff')), repo.cwd);
  expect(await read('old')).toEqual(after);
  expect(await read('new')).toEqual(before);
});

test('staged images ignore subsequent disk and index changes', async () => {
  const repo = repository();
  repo.write(after); repo.git('add', '.');
  const input = repo.input(repo.git('diff', '--cached'));
  repo.write(before); repo.git('add', '.');
  const read = createReadBytes(input, repo.cwd);
  expect(await read('old')).toEqual(before);
  expect(await read('new')).toEqual(after);
});

test('unstored working-tree image uses disk only while its hash matches', async () => {
  const repo = repository(); repo.write(after);
  const input = repo.input(repo.git('diff'));
  expect(await createReadBytes(input, repo.cwd)('new')).toEqual(after);
  repo.write(before);
  expect(await createReadBytes(input, repo.cwd)('new')).toBeNull();
});

test('commit comparisons use patch objects from a repository subdirectory', async () => {
  const repo = repository(); repo.write(after); repo.commit();
  const patch = repo.git('diff', 'HEAD~1', 'HEAD');
  repo.write(before);
  mkdirSync(join(repo.cwd, 'subdir'));
  const read = createReadBytes(repo.input(patch), join(repo.cwd, 'subdir'));
  expect(await read('old')).toEqual(before);
  expect(await read('new')).toEqual(after);
});

test('an added path reads its stored image after a file move', async () => {
  const repo = repository(); repo.git('mv', 'image.png', 'renamed.png');
  repo.write(after, 'renamed.png'); repo.commit();
  const read = createReadBytes(repo.input(repo.git('diff', 'HEAD~1', 'HEAD', '--', 'renamed.png'), { path: 'renamed.png', changeType: 'new' }), repo.cwd);
  expect(await read('old')).toBeNull();
  expect(await read('new')).toEqual(after);
});

test('renamed files use the reviewed objects, including the previous path', async () => {
  const repo = repository();
  const oldId = repo.git('rev-parse', 'HEAD:image.png').trim();
  repo.write(after); repo.git('add', '.');
  const newId = repo.git('rev-parse', ':image.png').trim();
  const patch = `diff --git a/old.png b/new.png\nsimilarity index 80%\nrename from old.png\nrename to new.png\nindex ${oldId}..${newId} 100644\n`;
  const read = createReadBytes(repo.input(patch, { path: 'new.png', previousPath: 'old.png', changeType: 'rename' }), repo.cwd);
  expect(await read('old')).toEqual(before);
  expect(await read('new')).toEqual(after);
});

test('deleted image comes from its object; absent new side stays empty', async () => {
  const repo = repository(); repo.git('rm', '-q', 'image.png');
  const read = createReadBytes(repo.input(repo.git('diff', '--cached'), { changeType: 'deleted' }), repo.cwd);
  expect(await read('old')).toEqual(before);
  expect(await read('new')).toBeNull();
});

test('untracked images read disk; unidentified file pairs do not', async () => {
  const repo = repository(); repo.write(after, 'new.png');
  const file = { path: 'new.png', changeType: 'new' };
  const read = createReadBytes(repo.input('', { ...file, isUntracked: true }), repo.cwd);
  expect(await read('old')).toBeNull();
  expect(await read('new')).toEqual(after);
  expect(await createReadBytes(repo.input('', file), repo.cwd)('new')).toBeNull();
});

test('rejects paths and symlinks outside the repository', async () => {
  const repo = repository();
  const other = repository();
  symlinkSync(join(other.cwd, 'image.png'), join(repo.cwd, 'link.png'));
  for (const path of [join(other.cwd, 'image.png'), '../image.png', 'link.png']) {
    const read = createReadBytes(repo.input('', { path, isUntracked: true }), repo.cwd);
    expect(await read('new')).toBeNull();
  }
});

test('SHA-256 repositories support stored and unstored versions', async () => {
  const repo = repository('sha256'); repo.write(after);
  const read = createReadBytes(repo.input(repo.git('diff', '--full-index')), repo.cwd);
  expect(await read('old')).toEqual(before);
  expect(await read('new')).toEqual(after);
});

test('missing objects, ambiguous patch headers, and aborted reads do not guess', async () => {
  const repo = repository();
  expect(await createReadBytes(repo.input('index 1111111..2222222 100644\n'), repo.cwd)('new')).toBeNull();
  const patch = 'index 1111111..2222222 100644\nindex 3333333..4444444 100644\n';
  expect(await createReadBytes(repo.input(patch), repo.cwd)('new')).toBeNull();
  const controller = new AbortController(); controller.abort();
  await expect(createReadBytes({ ...repo.input(''), signal: controller.signal }, repo.cwd)('new')).rejects.toThrow();
});

test('API 33 host reader takes priority, including a null result', async () => {
  const repo = repository();
  const input = { ...repo.input('index 1111111..2222222 100644\n'), readBytes: async () => null };
  expect(await createReadBytes(input, repo.cwd)('new')).toBeNull();
  expect(await createReadBytes({ ...input, readBytes: async () => after }, repo.cwd)('new')).toBe(after);
});
