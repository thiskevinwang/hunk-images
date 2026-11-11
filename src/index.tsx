import type { HunkExtensionAPI, ExtensionFileViewInput, ExtensionFileViewLayout, ExtensionFileViewRow, ExtensionFileViewRowComponentProps } from 'hunkdiff/extension';
import { imageHeight, matchesImage, readSide, type ImageSide } from './preview';
import { createReadBytes } from './bytes';
import { Image } from './image';
import { ImagePane, selectedImage } from './pane';

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

export async function layout(input: ExtensionFileViewInput, cwd = process.cwd()): Promise<ExtensionFileViewLayout | null> {
  if (input.width < 1 || input.file.hunks?.length) return null;
  const readBytes = createReadBytes(input, cwd);
  const sides = await Promise.all([readSide(input, 'old', readBytes), readSide(input, 'new', readBytes)]);
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
  if (hunk.apiVersion < 32) throw new Error('hunk-images requires Hunk 0.24.1 (extension API 32) or later.');
  let cwd = process.cwd();
  hunk.on('startup', event => { cwd = event.cwd; });
  hunk.on('changeset_loaded', (_event, ctx) => { cwd = ctx.cwd; });
  hunk.registerPane({
    id: 'preview', title: 'Image', placement: 'bottom', defaultOpen: true,
    height: { preferred: 20, min: 6, max: 40, fraction: 0.5 },
    available: context => Boolean(selectedImage(context)),
    component: props => <ImagePane {...props} cwd={cwd} />,
  });
  hunk.registerFileView({ id: 'images', title: 'Images', matches: file => matchesImage(file.path), layout: input => layout(input, cwd) });
  hunk.registerCommand({ id: 'toggle', title: 'Toggle image pane', key: 'f8' }, ctx => { ctx.panes.toggle('preview'); });
}
