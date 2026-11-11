import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testRender } from '@opentui/react/test-utils';
import type { ExtensionDiffFile, ExtensionPane, HunkExtensionAPI } from 'hunkdiff/extension';
import register from '../src/index';
import { ImagePane, selectedImage, type ImagePaneProps } from '../src/pane';

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function file(path: string): ExtensionDiffFile {
  return { id: path, path, patch: '', stats: { additions: 0, deletions: 0 }, metadata: {}, agent: null,
    changeType: 'new', hunks: [], isUntracked: true };
}

test('opens the pane by default only for selected images', () => {
  let pane: ExtensionPane | undefined;
  const api: Partial<HunkExtensionAPI> = { apiVersion: 32, on: () => {}, registerFileView: () => {}, registerCommand: () => {},
    registerPane: value => { pane = value; } };
  register(api as HunkExtensionAPI);
  expect(pane?.defaultOpen).toBe(true);
  expect(pane?.placement).toBe('bottom');
  const image = file('photo.png');
  const text = file('notes.md');
  expect(selectedImage({ files: [image, text], selectedFileId: image.id })).toBe(image);
  expect(selectedImage({ files: [image, text], selectedFileId: text.id })).toBeUndefined();
  expect(selectedImage({ files: [image], selectedFileId: null })).toBeUndefined();
  expect(selectedImage({ files: [{ ...image, hunks: [{ index: 0, header: '@@ -1 +1 @@' }] }], selectedFileId: image.id })).toBeUndefined();
});

test('renders a selected image without input; changes selection and clears the pane', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hunk-images-pane-')); folders.push(cwd);
  execFileSync('git', ['init', '-q'], { cwd });
  writeFileSync(join(cwd, 'image.png'), readFileSync(new URL('./fixtures/after.png', import.meta.url)));
  writeFileSync(join(cwd, 'broken.png'), 'not an image');
  const image = file('image.png');
  const broken = file('broken.png');
  const text = file('notes.md');
  const props = {
    cwd, width: 80, height: 20, files: [image, broken, text], selectedFileId: image.id,
    reviewGeneration: 'test', theme: { text: '#ffffff', muted: '#888888' },
  } satisfies ImagePaneProps;
  let select: (id: string) => void = () => {};
  function Harness() {
    const [selectedFileId, setSelectedFileId] = useState(image.id);
    select = setSelectedFileId;
    return <ImagePane {...props} selectedFileId={selectedFileId} />;
  }
  const setup = await testRender(<Harness />, { width: 80, height: 20 });
  async function waitForFrame(predicate: (frame: string) => boolean) {
    // Git and file reads finish outside React. Flush each polling step through act.
    for (let attempt = 0; attempt < 100; attempt++) {
      await act(async () => { await Bun.sleep(5); });
      await setup.renderOnce();
      if (predicate(setup.captureCharFrame())) return;
    }
    throw new Error(`Pane did not update: ${setup.captureCharFrame()}`);
  }
  try {
    await waitForFrame(frame => frame.includes('After · 16 × 16') && /[▀▄█]/.test(frame));
    await act(async () => select(broken.id));
    await waitForFrame(frame => frame.includes('invalid or unsupported image'));
    expect(setup.captureCharFrame()).not.toContain('16 × 16');
    await act(async () => select(image.id));
    await waitForFrame(frame => frame.includes('After · 16 × 16'));
    await act(async () => select(text.id));
    await setup.waitForFrame(frame => !frame.includes('After') && !/[▀▄█]/.test(frame));
  } finally { await act(async () => setup.renderer.destroy()); }
});
