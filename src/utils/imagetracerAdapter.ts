/**
 * imagetracerjs (CJS singleton) loader — all interop isolated here.
 * Package main: imagetracer_v1.2.6.js (UMD/CJS, not native ESM).
 */

export type ImagetracerInstance = {
  imagedataToSVG: (imgd: ImageData, options?: Record<string, unknown> | string) => string;
  optionpresets?: Record<string, Record<string, unknown>>;
};

let cached: ImagetracerInstance | null = null;

/** Lazy load for browser bundle (Vite pre-bundles CJS default export). */
export async function loadImagetracer(): Promise<ImagetracerInstance> {
  if (cached) return cached;
  const mod = (await import('imagetracerjs')) as { default?: ImagetracerInstance };
  const instance = mod.default ?? (mod as unknown as ImagetracerInstance);
  if (!instance?.imagedataToSVG) {
    throw new Error('imagetracerjs: imagedataToSVG not found on module export');
  }
  cached = instance;
  return instance;
}
