import { HistorySnapshot } from '../types';

let latest: HistorySnapshot | null = null;

/** In-memory last document. Used only for ErrorBoundary remount recovery. */
export function rememberDocument(snapshot: HistorySnapshot): void {
  latest = {
    elements: snapshot.elements,
    layers: snapshot.layers,
    activeLayerId: snapshot.activeLayerId,
    canvasConfig: snapshot.canvasConfig,
  };
}

export function recallDocument(): HistorySnapshot | null {
  return latest;
}
