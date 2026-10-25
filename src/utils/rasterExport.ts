import { CanvasConfig, CanvasElement, Layer } from '../types';
import { generateSVGString } from './svgExport';

export async function exportToRaster(
  layers: Layer[],
  elements: CanvasElement[],
  config: CanvasConfig,
  format: 'png' | 'jpeg' | 'webp' = 'png',
  scale = 1,
  transparentBackground = false,
  quality = 0.92
): Promise<string> {
  const svgString = generateSVGString(layers, elements, config, { transparentBackground });
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.crossOrigin = 'anonymous';

  return new Promise((resolve, reject) => {
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = config.width * scale;
      canvas.height = config.height * scale;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not get 2d context'));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (!transparentBackground && format !== 'png') {
        ctx.fillStyle = config.backgroundColor || '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const dataUrl = canvas.toDataURL(mimeType, quality);
      resolve(dataUrl);
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

/**
 * Captures and exports an arbitrary rectangular region of the canvas as an image.
 * Supports transparent or canvas background color, returns both dataURL and Blob for clipboard write.
 */
export async function exportRegionToRaster(
  layers: Layer[],
  elements: CanvasElement[],
  config: CanvasConfig,
  region: { x: number; y: number; w: number; h: number },
  scale = 1,
  transparentBackground = false
): Promise<{ dataUrl: string; blob: Blob | null }> {
  const regW = Math.max(1, Math.round(region.w));
  const regH = Math.max(1, Math.round(region.h));
  const regX = Math.round(region.x);
  const regY = Math.round(region.y);

  const svgString = generateSVGString(layers, elements, config, { transparentBackground });
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.crossOrigin = 'anonymous';

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('Image capture timed out'));
    }, 4000);

    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement('canvas');
      canvas.width = regW * scale;
      canvas.height = regH * scale;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not get 2d context'));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Background
      if (!transparentBackground && config.backgroundColor) {
        ctx.fillStyle = config.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Draw sub-region
      ctx.drawImage(
        img,
        regX,
        regY,
        regW,
        regH,
        0,
        0,
        regW * scale,
        regH * scale
      );
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL('image/png');
      canvas.toBlob(
        (b) => {
          resolve({ dataUrl, blob: b });
        },
        'image/png',
        1.0
      );
    };

    img.onerror = (err) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function sampleColorFromCanvas(
  layers: Layer[],
  elements: CanvasElement[],
  config: CanvasConfig,
  x: number,
  y: number
): Promise<string> {
  const svgString = generateSVGString(layers, elements, config, { transparentBackground: false });
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  return new Promise((resolve) => {
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = config.width;
      canvas.height = config.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve('#000000');
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
      resolve(hex.toUpperCase());
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('#000000');
    };
    img.src = url;
  });
}
