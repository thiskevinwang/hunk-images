import { useState } from 'react';
import type { HunkExtensionAPI, ExtensionFileViewInput, ExtensionFileViewLayout, ExtensionFileViewRow, ExtensionFileViewRowComponentProps } from 'hunkdiff/extension';
import { imageHeight, matchesImage, readSide, type ImageSide } from './preview';

function Image({ side, width, height }: { side: ImageSide; width: number; height: number }) {
  const [failed, setFailed] = useState(false);
  return failed ? <text content="Cannot decode image" width={width} height={height} /> :
    <image source={side.bytes} fit="fit" protocol="auto" width={width} height={height} onError={() => setFailed(true)} />;
}

function imageRow(sides: ImageSide[], columns: number): ExtensionFileViewRow {
  const height = Math.max(...sides.map(side => imageHeight(side, columns)));
  return {
    id: sides.map(side => side.label).join('-'),
    spans: [{ text: sides.map(side => side.caption).join(' / '), tone: 'muted' }],
    component: {
      height,
      render: ({ width, height }: ExtensionFileViewRowComponentProps) => (
        <box width={width} height={height} flexDirection="row" gap={2}>
          {sides.map(side => <Image key={side.label} side={side} width={columns} height={height} />)}
        </box>
      ),
    },
  };
}

export async function layout(input: ExtensionFileViewInput): Promise<ExtensionFileViewLayout | null> {
  if (input.width < 1 || input.file.hunks?.length) return null;
  const sides = await Promise.all([readSide(input, 'old'), readSide(input, 'new')]);
  input.signal.throwIfAborted();
  const rows: ExtensionFileViewRow[] = [];
  if (input.width >= 60 && sides.every(side => side.bytes)) {
    const columns = Math.floor((input.width - 2) / 2);
    rows.push({ id: 'captions', spans: [{ text: sides[0]!.caption.padEnd(columns) + '  ' + sides[1]!.caption }] });
    rows.push(imageRow(sides, columns));
  } else {
    for (const side of sides) {
      rows.push({ id: `${side.label}-caption`, spans: [{ text: side.caption }] });
      if (side.bytes) rows.push(imageRow([side], input.width));
    }
  }
  return { rows, hunkRows: [] };
}

export default function register(hunk: HunkExtensionAPI): void {
  if (hunk.apiVersion < 33) throw new Error('hunk-images requires Hunk extension API 33 or later.');
  hunk.registerFileView({ id: 'images', title: 'Images', matches: file => matchesImage(file.path), layout });
  hunk.registerCommand({ id: 'toggle', title: 'Toggle images', key: 'f8' }, ctx => { ctx.fileViews.toggle('images'); });
}
