/**
 * OS clipboard image helpers.
 *
 * Chromium re-encodes PNGs it writes to the OS clipboard (and converts Windows
 * CF_DIB captures to PNG on read), so byte size can never tell "our own copy"
 * apart from a new screenshot. We compare decoded pixels instead: exact pixel
 * dimensions plus a small premultiplied thumbnail.
 */

export interface ImageFingerprint {
  width: number;
  height: number;
  /** SAMPLE×SAMPLE premultiplied RGBA thumbnail. */
  sample: Uint8ClampedArray;
}

const SAMPLE = 16;
/** Mean absolute difference per channel (0–255) still treated as "same image". */
const MATCH_TOLERANCE = 4;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i;

async function decode(source: Blob | string): Promise<{ img: CanvasImageSource; w: number; h: number; dispose: () => void }> {
  if (typeof source !== 'string' && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(source);
      return { img: bmp, w: bmp.width, h: bmp.height, dispose: () => bmp.close() };
    } catch {
      // Fall through to <img> decoding (e.g. SVG blobs).
    }
  }
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode clipboard image'));
      el.src = url;
    });
    return {
      img,
      w: img.naturalWidth,
      h: img.naturalHeight,
      dispose: () => {
        if (typeof source !== 'string') URL.revokeObjectURL(url);
      },
    };
  } catch (err) {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
    throw err;
  }
}

export async function computeImageFingerprint(source: Blob | string): Promise<ImageFingerprint | null> {
  try {
    const { img, w, h, dispose } = await decode(source);
    try {
      if (!w || !h) return null;
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE;
      canvas.height = SAMPLE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
      const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
      // Premultiply so fully transparent pixels compare equal regardless of RGB.
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        data[i] = Math.round(data[i] * a);
        data[i + 1] = Math.round(data[i + 1] * a);
        data[i + 2] = Math.round(data[i + 2] * a);
      }
      return { width: w, height: h, sample: data };
    } finally {
      dispose();
    }
  } catch {
    return null;
  }
}

export function fingerprintsMatch(a: ImageFingerprint | null, b: ImageFingerprint | null): boolean {
  if (!a || !b) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.sample.length !== b.sample.length) return false;
  let diff = 0;
  for (let i = 0; i < a.sample.length; i++) diff += Math.abs(a.sample[i] - b.sample[i]);
  return diff / a.sample.length <= MATCH_TOLERANCE;
}

export function isLikelyImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name);
}

/** First image file in a paste/drop DataTransfer (Win+Shift+S, Snipping Tool, Explorer copy…). */
export function extractImageFileFromDataTransfer(data: DataTransfer): File | null {
  if (data.files && data.files.length > 0) {
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      if (isLikelyImageFile(file)) return file;
    }
  }
  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && (isLikelyImageFile(file) || (item.type.startsWith('image/') && file.size > 0))) {
        return file;
      }
    }
  }
  return null;
}

/** First image blob from the async Clipboard API, or null (no image / permission denied). */
export async function readImageBlobFromClipboard(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return await item.getType(type);
    }
  } catch (err) {
    console.warn('Clipboard read() failed:', err);
  }
  return null;
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export class ClipboardSourceError extends Error {}

/**
 * Write a PNG to the OS clipboard so other apps can paste it.
 *
 * `png` may be a promise: the write is started immediately (while the page
 * still has focus / user activation) and Chromium waits for the bytes, so a
 * slow raster export no longer loses the clipboard if focus moves meanwhile.
 */
export async function writePngToSystemClipboard(
  png: Blob | null | undefined | Promise<Blob | null | undefined>
): Promise<Blob> {
  const blobPromise = Promise.resolve(png).then(
    (b) => {
      if (!b) throw new ClipboardSourceError('No image data to copy');
      return b.type === 'image/png' ? b : new Blob([b], { type: 'image/png' });
    },
    (err) => {
      // The caller's export failed; it reports that error itself.
      throw err instanceof ClipboardSourceError ? err : new ClipboardSourceError(String(err));
    }
  );
  // Avoid an unhandled rejection when the write itself fails first.
  blobPromise.catch(() => {});

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
  } catch (err) {
    if (err instanceof ClipboardSourceError) throw err;
    // Older engines only accept a resolved Blob in ClipboardItem.
    if (err instanceof TypeError) {
      const blob = await blobPromise;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } else {
      // Surface a source failure (export error) rather than a generic write error.
      await blobPromise;
      throw err;
    }
  }
  return blobPromise;
}

export function canWriteImagesToSystemClipboard(): boolean {
  return !!(navigator.clipboard?.write && typeof ClipboardItem !== 'undefined');
}
