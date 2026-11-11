import { useState } from 'react';
import type { ImageSide } from './preview';

export function Image({ side, width, height }: { side: ImageSide; width: number; height: number }) {
  const [failed, setFailed] = useState(false);
  return failed ? <text content="Cannot decode image" width={width} height={height} /> :
    <image source={side.bytes} fit="fit" protocol="auto" width={width} height={height} onError={() => setFailed(true)} />;
}
