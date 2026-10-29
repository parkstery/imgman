export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** Fit may go below the manual +/-/wheel floor so a 4000px canvas can sit in a 240px stage. */
export const FIT_MIN_ZOOM = 0.01;
/** Tailwind `w-6` / `h-6` ruler strip in CanvasArea. */
export const RULER_SIZE = 24;
export const FIT_PADDING = 24;

export interface ViewportFitInput {
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  showRulers?: boolean;
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface ViewportFitResult {
  zoom: number;
  pan: { x: number; y: number };
}

export function clampZoom(
  zoom: number,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM
): number {
  if (!Number.isFinite(zoom)) return minZoom;
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

/**
 * Manual +/- and wheel: keep the 0.25–4 band, but do not snap upward to 0.25
 * when the current zoom is a below-floor fit value.
 */
export function clampManualZoom(next: number, current: number): number {
  if (!Number.isFinite(next)) {
    return Number.isFinite(current) ? current : MIN_ZOOM;
  }
  const upper = Math.min(MAX_ZOOM, next);
  if (current < MIN_ZOOM) {
    return Math.max(FIT_MIN_ZOOM, upper);
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

export function shouldApplyFitNonce(nonce: number, lastApplied: number): boolean {
  return nonce > 0 && nonce !== lastApplied;
}

function canvasFitsInViewport(
  pan: { x: number; y: number },
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  inset: number
): boolean {
  const scaledW = canvasWidth * zoom;
  const scaledH = canvasHeight * zoom;
  const eps = 0.5;
  return (
    pan.x + eps >= inset &&
    pan.y + eps >= inset &&
    pan.x + scaledW <= viewportWidth + eps &&
    pan.y + scaledH <= viewportHeight + eps
  );
}

/**
 * Zoom + pan so the whole canvas sits in the available viewport, inset for
 * rulers and padding. Fit zoom is allowed below the manual 25% floor.
 */
export function computeViewportFit(input: ViewportFitInput): ViewportFitResult {
  const minZoom = input.minZoom ?? FIT_MIN_ZOOM;
  const maxZoom = input.maxZoom ?? MAX_ZOOM;
  const padding = Math.max(0, input.padding ?? FIT_PADDING);
  const inset = input.showRulers ? RULER_SIZE : 0;
  const viewportWidth = Math.max(0, input.viewportWidth);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const canvasWidth = Math.max(1, input.canvasWidth);
  const canvasHeight = Math.max(1, input.canvasHeight);

  const paddedAvailW = Math.max(1, viewportWidth - inset - padding * 2);
  const paddedAvailH = Math.max(1, viewportHeight - inset - padding * 2);
  let zoom = clampZoom(
    Math.min(paddedAvailW / canvasWidth, paddedAvailH / canvasHeight),
    minZoom,
    maxZoom
  );

  const panFor = (z: number) => ({
    x: inset + (viewportWidth - inset - canvasWidth * z) / 2,
    y: inset + (viewportHeight - inset - canvasHeight * z) / 2,
  });

  let pan = panFor(zoom);
  if (
    !canvasFitsInViewport(
      pan,
      zoom,
      canvasWidth,
      canvasHeight,
      viewportWidth,
      viewportHeight,
      inset
    )
  ) {
    const tightW = Math.max(1, viewportWidth - inset);
    const tightH = Math.max(1, viewportHeight - inset);
    zoom = clampZoom(
      Math.min(tightW / canvasWidth, tightH / canvasHeight),
      minZoom,
      maxZoom
    );
    pan = panFor(zoom);
  }

  return { zoom, pan };
}
