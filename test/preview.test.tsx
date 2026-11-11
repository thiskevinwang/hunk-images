import { expect, test } from 'bun:test';
import { act, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { testRender } from '@opentui/react/test-utils';
import { NativeImage, resolveImageRenderProtocol } from '@opentui/core';
import type { HunkExtensionAPI } from 'hunkdiff/extension';
import register, { layout } from '../src/index';
import { matchesImage, MAX_BYTES, readSide } from '../src/preview';
import type { ImageInput } from '../src/bytes';

const before = readFileSync(new URL('./fixtures/before.png', import.meta.url));
const after = readFileSync(new URL('./fixtures/after.png', import.meta.url));
function input(overrides: Partial<ImageInput> = {}): ImageInput {
  return { file: { path: 'image.png', changeType: 'modified', hunks: [] }, width: 80,
    signal: new AbortController().signal, changes: [], readDocument: async () => null,
    readBytes: async side => side === 'old' ? before : after, ...overrides } as ImageInput;
}

test('accepts supported suffixes, including uppercase', () => {
  for (const path of ['a.PNG', 'a.jpeg', 'a.jpg', 'a.gif', 'a.webp']) expect(matchesImage(path)).toBe(true);
  for (const path of ['a.svg', 'a.png.txt', 'a.txt']) expect(matchesImage(path)).toBe(false);
});

test('reads exact old/new data and uses native decoder', async () => {
  for (const side of ['old', 'new'] as const) {
    const value = await readSide(input(), side);
    expect(value.bytes).toBe(side === 'old' ? before : after);
    const decoded = NativeImage.decode(value.bytes!);
    try { expect([...decoded.raw().data.slice(0, 3)]).toEqual(side === 'old' ? [255, 0, 0] : [0, 0, 255]); }
    finally { decoded.dispose(); }
  }
});

test('wide comparisons use one image row; narrow comparisons stack', async () => {
  const wide = await layout(input());
  const narrow = await layout(input({ width: 30 }));
  expect(wide!.rows.filter(row => row.component)).toHaveLength(1);
  expect(narrow!.rows.filter(row => row.component)).toHaveLength(2);
  expect(wide!.hunkRows).toEqual([]);
  for (const row of narrow!.rows) if (row.component) expect(row.component.height).toBeLessThanOrEqual(24);
});

test('added/deleted images do not read the absent side', async () => {
  for (const [changeType, present] of [['new', 'new'], ['deleted', 'old']] as const) {
    const calls: string[] = [];
    const value = input();
    const result = await layout(input({ file: { ...value.file, changeType }, readBytes: async side => { calls.push(side); return after; } }));
    expect(calls).toEqual([present]);
    expect(result!.rows.filter(row => row.component)).toHaveLength(1);
    expect(result!.rows.some(row => row.spans[0]?.text.includes('not present'))).toBe(true);
  }
});

test('missing, invalid, oversized and excessive pixel counts show captions', async () => {
  const large = Buffer.from(before);
  large.writeUInt32BE(100_000, 16);
  for (const [bytes, message] of [[null, 'unavailable'], [new Uint8Array(), 'invalid'], [new Uint8Array(MAX_BYTES + 1), '20 MiB'], [large, '40 million']] as const) {
    // Increase both dimensions for the pixel-limit case.
    if (bytes === large) large.writeUInt32BE(100_000, 20);
    const side = await readSide(input({ readBytes: async () => bytes }), 'old');
    expect(side.bytes).toBeUndefined();
    expect(side.caption).toContain(message);
  }
});

test('cancelled reads reject; files with source hunks use raw diff', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(layout(input({ signal: controller.signal }))).rejects.toThrow();
  const value = input();
  expect(await layout(input({ file: { ...value.file, hunks: [{ index: 0, header: '@@ -1 +1 @@' }] } }))).toBeNull();
});

test('accepts API 32 and registers F8 toggle', () => {
  expect(() => register({ apiVersion: 31 } as unknown as HunkExtensionAPI)).toThrow('API 32');
  let command: unknown; let selected = '';
  register({ apiVersion: 32, on: () => {}, registerPane: () => {}, registerFileView: () => {}, registerCommand: (meta: unknown, handler: (ctx: unknown) => void) => {
    command = meta; handler({ panes: { toggle: (id: string) => { selected = id; } } });
  } } as unknown as HunkExtensionAPI);
  expect(command).toMatchObject({ key: 'f8' }); expect(selected).toBe('preview');
});

test('image component renders through OpenTUI and releases on unmount', async () => {
  const result = await layout(input());
  const component = result!.rows.find(row => row.component)!.component!;
  const View = component.render as (props: { width: number; height: number }) => ReactElement;
  const setup = await testRender(<View width={80} height={component.height} />, { width: 80, height: 30 });
  try {
    await setup.waitForFrame(frame => frame.includes('▀') || frame.includes('▄') || frame.includes('█'));
  } finally { await act(async () => setup.renderer.destroy()); }
});

test('auto protocol has a text-block fallback without terminal capabilities', () => {
  expect(resolveImageRenderProtocol('auto', null, false)).toBe('blocks');
});
