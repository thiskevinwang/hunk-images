import { imageSize } from 'image-size';
import { createReadBytes, MAX_BYTES, type ImageInput, type ReadBytes } from './bytes';

export { MAX_BYTES } from './bytes';
export const MAX_PIXELS = 40_000_000;
const FORMATS = new Set(['png', 'jpg', 'gif', 'webp']);

export interface ImageSide {
  label: 'Before' | 'After';
  caption: string;
  bytes?: Uint8Array;
  width?: number;
  height?: number;
}

export function matchesImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}

export async function readSide(input: ImageInput, side: 'old' | 'new', readBytes: ReadBytes = createReadBytes(input, process.cwd())): Promise<ImageSide> {
  const label = side === 'old' ? 'Before' : 'After';
  if (input.file.changeType === (side === 'old' ? 'new' : 'deleted')) {
    return { label, caption: `${label} · not present` };
  }
  const bytes = await readBytes(side);
  input.signal.throwIfAborted();
  if (!bytes) return { label, caption: `${label} · unavailable` };
  if (bytes.length > MAX_BYTES) return { label, caption: `${label} · exceeds 20 MiB` };
  try {
    const { width, height, type } = imageSize(bytes);
    if (!type || !FORMATS.has(type) || width < 1 || height < 1) throw new Error('Unsupported image');
    if (width * height > MAX_PIXELS) return { label, caption: `${label} · exceeds 40 million pixels` };
    return { label, bytes, width, height, caption: `${label} · ${width} × ${height}` };
  } catch {
    return { label, caption: `${label} · invalid or unsupported image` };
  }
}

export function imageHeight(side: ImageSide, columns: number): number {
  // Reserve deterministic geometry; OpenTUI fits to the actual terminal cell dimensions.
  return Math.max(1, Math.min(24, Math.ceil(columns * side.height! / side.width! / 2)));
}
