import { useEffect, useState } from 'react';
import type { ExtensionDiffFile, ExtensionPaneAvailabilityContext, ExtensionPaneProps } from 'hunkdiff/extension';
import { createReadBytes, type ImageInput } from './bytes';
import { Image } from './image';
import { matchesImage, readSide, type ImageSide } from './preview';

export function selectedImage(context: Pick<ExtensionPaneAvailabilityContext, 'files' | 'selectedFileId'>): ExtensionDiffFile | undefined {
  return context.files.find(file => file.id === context.selectedFileId && matchesImage(file.path) && !file.hunks?.length);
}

interface PreviewState {
  file: ExtensionDiffFile;
  generation: string | null;
  cwd: string;
  sides: ImageSide[];
}

export type ImagePaneProps = Pick<ExtensionPaneProps, 'files' | 'selectedFileId' | 'reviewGeneration' | 'width' | 'height'> & {
  cwd: string;
  theme: Pick<ExtensionPaneProps['theme'], 'text' | 'muted'>;
};

export function ImagePane(props: ImagePaneProps) {
  const file = selectedImage(props);
  const { cwd, reviewGeneration, width, height, theme } = props;
  const [preview, setPreview] = useState<PreviewState>();
  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    const input: ImageInput = {
      file, width, signal: controller.signal, changes: [], readDocument: async () => null,
    };
    const readBytes = createReadBytes(input, cwd);
    void Promise.all([readSide(input, 'old', readBytes), readSide(input, 'new', readBytes)])
      .then(sides => {
        if (!controller.signal.aborted) setPreview({ file, generation: reviewGeneration, cwd, sides });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview({ file, generation: reviewGeneration, cwd, sides: [
          { label: 'Before', caption: 'Before · unavailable' },
          { label: 'After', caption: 'After · unavailable' },
        ] });
      });
    return () => controller.abort();
    // Width only controls painting. Resizing must not start another source read.
  }, [file, cwd, reviewGeneration]);

  if (!file) return null;
  if (preview?.file !== file || preview.generation !== reviewGeneration || preview.cwd !== cwd) {
    return <text content="Loading image…" fg={theme.muted} />;
  }
  const sides = file.changeType === 'new' ? preview.sides.slice(1) :
    file.changeType === 'deleted' ? preview.sides.slice(0, 1) : preview.sides;
  const horizontal = sides.length < 2 || width >= 60;
  const columns = horizontal ? Math.max(1, Math.floor((width - (sides.length - 1) * 2) / sides.length)) : width;
  const rows = horizontal ? height : Math.max(1, Math.floor((height - (sides.length - 1)) / sides.length));
  return (
    <box width={width} height={height} flexDirection={horizontal ? 'row' : 'column'} gap={horizontal ? 2 : 1}>
      {sides.map(side => (
        <box key={`${file.id}:${reviewGeneration}:${side.label}`} width={columns} height={rows} flexDirection="column">
          <text content={side.caption} fg={theme.text} height={1} wrapMode="none" />
          {side.bytes && rows > 1 ? <Image side={side} width={columns} height={rows - 1} /> : null}
        </box>
      ))}
    </box>
  );
}
