import { ImageElement } from '../types';
import {
  applyAlphaThreshold,
  imageElementToImageData,
  rgbaToImageData,
} from './imagePixels';
import { ImagetracerInstance, loadImagetracer } from './imagetracerAdapter';
import {
  buildVectorizedImageMarkup,
  imageElementToMarkupInput,
} from './vectorizedImageMarkup';

export class VectorizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VectorizeError';
  }
}

export interface VectorizeOptions {
  preset: 'logo' | 'illustration';
  maxColors: number;
  alphaThreshold: number;
  despeckle: number;
  simplifyTolerance: number;
  maxDimension: number;
  maxPaths: number;
  maxOutputChars: number;
}

export const DEFAULT_VECTORIZE_LOGO: VectorizeOptions = {
  preset: 'logo',
  maxColors: 4,
  alphaThreshold: 8,
  despeckle: 4,
  simplifyTolerance: 1.2,
  maxDimension: 1024,
  maxPaths: 8000,
  maxOutputChars: 4_000_000,
};

export const DEFAULT_VECTORIZE_ILLUSTRATION: VectorizeOptions = {
  preset: 'illustration',
  maxColors: 16,
  alphaThreshold: 8,
  despeckle: 2,
  simplifyTolerance: 0.8,
  maxDimension: 1536,
  maxPaths: 20000,
  maxOutputChars: 6_000_000,
};

export function resolveVectorizeOptions(partial?: Partial<VectorizeOptions>): VectorizeOptions {
  const base =
    partial?.preset === 'illustration' ? { ...DEFAULT_VECTORIZE_ILLUSTRATION } : { ...DEFAULT_VECTORIZE_LOGO };
  return { ...base, ...partial };
}

export interface RasterTracer {
  traceToSvgString(imageData: ImageData, traceOpts: Record<string, unknown>): string;
}

export function createImagetracerRasterTracer(tracer: ImagetracerInstance): RasterTracer {
  return {
    traceToSvgString(imageData, traceOpts) {
      return tracer.imagedataToSVG(imageData, traceOpts);
    },
  };
}

export function buildImagetracerOptions(opts: VectorizeOptions): Record<string, unknown> {
  const lt = opts.simplifyTolerance;
  const qt = opts.simplifyTolerance;
  return {
    colorsampling: 2,
    numberofcolors: opts.maxColors,
    pathomit: opts.despeckle,
    ltres: lt,
    qtres: qt,
    strokewidth: 0,
    linefilter: false,
    scale: 1,
    viewbox: true,
    layering: 0,
    roundcoords: 1,
  };
}

export function extractSvgInnerFragment(svgString: string): string {
  const inner = svgString.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  if (!inner.trim()) throw new VectorizeError('Tracer produced empty SVG fragment');
  if (/<image\b/i.test(inner) || /data:image/i.test(inner)) {
    throw new VectorizeError('Tracer output unexpectedly contains raster image markup');
  }
  return inner.trim();
}

export function countPathsInMarkup(markup: string): number {
  const m = markup.match(/<path\b/gi);
  return m ? m.length : 0;
}

function enforceLimits(fragment: string, opts: VectorizeOptions): number {
  if (fragment.length > opts.maxOutputChars) {
    throw new VectorizeError(
      `Vectorized output exceeds size limit (${fragment.length} > ${opts.maxOutputChars} chars)`
    );
  }
  const pathCount = countPathsInMarkup(fragment);
  if (pathCount === 0) {
    throw new VectorizeError('Vectorize produced no paths');
  }
  if (pathCount > opts.maxPaths) {
    throw new VectorizeError(`Too many paths (${pathCount} > ${opts.maxPaths})`);
  }
  return pathCount;
}

export interface TraceFragmentResult {
  fragment: string;
  pathCount: number;
  traceWidth: number;
  traceHeight: number;
}

export function traceImageDataToFragment(
  imageData: ImageData,
  opts: VectorizeOptions,
  tracer: RasterTracer
): TraceFragmentResult {
  const copy = rgbaToImageData(imageData.width, imageData.height, imageData.data);
  applyAlphaThreshold(copy, opts.alphaThreshold);
  const traceOpts = buildImagetracerOptions(opts);
  const svg = tracer.traceToSvgString(copy, traceOpts);
  const fragment = extractSvgInnerFragment(svg);
  const pathCount = enforceLimits(fragment, opts);
  return {
    fragment,
    pathCount,
    traceWidth: imageData.width,
    traceHeight: imageData.height,
  };
}

export async function vectorizeImageElement(
  el: ImageElement,
  opts: VectorizeOptions,
  fmt: (n: number) => string,
  tracer?: RasterTracer
): Promise<{ markup: string; pathCount: number }> {
  const { data } = await imageElementToImageData(el, opts.maxDimension);
  const rasterTracer = tracer ?? createImagetracerRasterTracer(await loadImagetracer());
  const { fragment, pathCount, traceWidth, traceHeight } = traceImageDataToFragment(data, opts, rasterTracer);

  const markup = buildVectorizedImageMarkup(
    imageElementToMarkupInput(el, fragment, traceWidth, traceHeight, fmt)
  );

  return { markup, pathCount };
}
