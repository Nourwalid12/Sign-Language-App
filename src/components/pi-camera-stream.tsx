import { createElement } from 'react';
import type { CSSProperties } from 'react';

type Props = {
  url: string;
  onLoad: () => void;
  onError: () => void;
};

const imageStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transform: 'scaleX(-1)',
};

export function PiCameraStream({ url, onLoad, onError }: Props) {
  if (!url) return null;
  return createElement('img', {
    src: url,
    crossOrigin: 'anonymous',
    onLoad,
    onError,
    alt: 'Raspberry Pi camera stream',
    style: imageStyle,
  });
}
