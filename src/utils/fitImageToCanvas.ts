import type { CanvasConfig, ImageElement } from '../types';

/** Uniformly fit the displayed image inside the canvas, keeping its rotation. */
export function fitImageToCanvas(
  image: Pick<ImageElement, 'width' | 'height' | 'rotation'>,
  canvas: Pick<CanvasConfig, 'width' | 'height'>
): Pick<ImageElement, 'x' | 'y' | 'width' | 'height'> | null {
  if (![image.width, image.height, canvas.width, canvas.height].every(
    (value) => Number.isFinite(value) && value > 0
  ) || !Number.isFinite(image.rotation)) return null;

  const angle = (image.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const boundsWidth = image.width * cos + image.height * sin;
  const boundsHeight = image.width * sin + image.height * cos;
  const scale = Math.min(canvas.width / boundsWidth, canvas.height / boundsHeight);
  const width = image.width * scale;
  const height = image.height * scale;

  return {
    width,
    height,
    x: (canvas.width - width) / 2,
    y: (canvas.height - height) / 2,
  };
}
