import { useCallback, useRef, useState } from 'react';
import { HistorySnapshot } from '../types';
import { rememberDocument } from '../utils/documentSession';

export const HISTORY_LIMIT = 30;

export interface HistoryState {
  snapshots: HistorySnapshot[];
  index: number;
}

function cloneSnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return {
    elements: snapshot.elements.map((el) => ({ ...el })),
    layers: snapshot.layers.map((layer) => ({ ...layer })),
    activeLayerId: snapshot.activeLayerId,
    canvasConfig: { ...snapshot.canvasConfig },
  };
}

export function createHistory(initial: HistorySnapshot): HistoryState {
  return { snapshots: [cloneSnapshot(initial)], index: 0 };
}

export function commitHistory(state: HistoryState, snapshot: HistorySnapshot): HistoryState {
  const sliced = state.snapshots.slice(0, state.index + 1);
  const next = [...sliced, cloneSnapshot(snapshot)];
  if (next.length > HISTORY_LIMIT) {
    next.shift();
    return { snapshots: next, index: next.length - 1 };
  }
  return { snapshots: next, index: next.length - 1 };
}

export function undoHistory(
  state: HistoryState
): { state: HistoryState; snapshot: HistorySnapshot } | null {
  if (state.index <= 0) return null;
  const index = state.index - 1;
  return {
    state: { snapshots: state.snapshots, index },
    snapshot: cloneSnapshot(state.snapshots[index]),
  };
}

export function redoHistory(
  state: HistoryState
): { state: HistoryState; snapshot: HistorySnapshot } | null {
  if (state.index >= state.snapshots.length - 1) return null;
  const index = state.index + 1;
  return {
    state: { snapshots: state.snapshots, index },
    snapshot: cloneSnapshot(state.snapshots[index]),
  };
}

export function resetHistory(snapshot: HistorySnapshot): HistoryState {
  return { snapshots: [cloneSnapshot(snapshot)], index: 0 };
}

export function useDocumentHistory(initial: HistorySnapshot) {
  const [history, setHistory] = useState<HistoryState>(() => createHistory(initial));
  const historyRef = useRef(history);
  historyRef.current = history;

  const commit = useCallback((snapshot: HistorySnapshot) => {
    const next = commitHistory(historyRef.current, snapshot);
    historyRef.current = next;
    setHistory(next);
    rememberDocument(snapshot);
  }, []);

  const undo = useCallback((): HistorySnapshot | null => {
    const result = undoHistory(historyRef.current);
    if (!result) return null;
    historyRef.current = result.state;
    setHistory(result.state);
    rememberDocument(result.snapshot);
    return result.snapshot;
  }, []);

  const redo = useCallback((): HistorySnapshot | null => {
    const result = redoHistory(historyRef.current);
    if (!result) return null;
    historyRef.current = result.state;
    setHistory(result.state);
    rememberDocument(result.snapshot);
    return result.snapshot;
  }, []);

  const reset = useCallback((snapshot: HistorySnapshot) => {
    const next = resetHistory(snapshot);
    historyRef.current = next;
    setHistory(next);
    rememberDocument(snapshot);
  }, []);

  return {
    history,
    canUndo: history.index > 0,
    canRedo: history.index < history.snapshots.length - 1,
    commit,
    undo,
    redo,
    reset,
  };
}
