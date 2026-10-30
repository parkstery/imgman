import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Point } from '../types';
import { shouldBlockDocumentShortcut } from '../utils/documentShortcuts';
import { LassoAction, polygonArea, simplifyPolygon } from '../utils/lassoSelection';

/** Screen pixels within which a click on the first vertex closes a polygon lasso */
const CLOSE_RADIUS_PX = 8;
/** A press that moves less than this (screen px) starts polygon mode */
const CLICK_SLOP_PX = 3;

export type LassoMode = 'freehand' | 'polygon';

interface LassoState {
  /** Outline being drawn (canvas coords) */
  draft: Point[] | null;
  mode: LassoMode | null;
  cursor: Point | null;
  /** Finished, closed selection */
  selection: Point[] | null;
}

interface UseLassoToolOptions {
  active: boolean;
  inputEnabled: boolean;
  zoom: number;
  onAction: (polygon: Point[], action: LassoAction) => Promise<boolean | void> | boolean | void;
}

const EMPTY: LassoState = { draft: null, mode: null, cursor: null, selection: null };

/**
 * Lasso selection: drag = freehand outline, click-click-… = polygon outline
 * (double-click, Enter or clicking the first vertex closes it).
 * With a selection: Ctrl+C copy, Ctrl+X cut, Ctrl+J new image, Delete erase, Esc clear.
 */
export function useLassoTool({ active, inputEnabled, zoom, onAction }: UseLassoToolOptions) {
  const [state, setStateRaw] = useState<LassoState>(EMPTY);
  const stateRef = useRef(state);
  const pressRef = useRef<{ start: Point; moved: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const setState = useCallback((next: LassoState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const clear = useCallback(() => {
    pressRef.current = null;
    setState(EMPTY);
  }, [setState]);

  useEffect(() => {
    if (!active) clear();
  }, [active, clear]);

  const close = useCallback(
    (points: Point[]) => {
      const poly = simplifyPolygon(points, 1 / Math.max(zoom, 0.01));
      if (poly.length < 3 || polygonArea(poly) < 4) {
        setState(EMPTY);
        return;
      }
      setState({ draft: null, mode: null, cursor: null, selection: poly });
    },
    [setState, zoom]
  );

  const handleMouseDown = useCallback(
    (pt: Point, e: React.MouseEvent) => {
      const s = stateRef.current;
      if (s.mode === 'polygon' && s.draft) {
        const first = s.draft[0];
        const nearFirst = Math.hypot(pt.x - first.x, pt.y - first.y) <= CLOSE_RADIUS_PX / zoom;
        if ((nearFirst || e.detail >= 2) && s.draft.length >= 3) {
          close(s.draft);
          return;
        }
        if (e.detail >= 2) return;
        setState({ ...s, draft: [...s.draft, pt], cursor: pt });
        return;
      }
      pressRef.current = { start: pt, moved: false };
      setState({ draft: [pt], mode: 'freehand', cursor: pt, selection: null });
    },
    [close, setState, zoom]
  );

  const handleMouseMove = useCallback(
    (pt: Point): boolean => {
      if (!active) return false;
      const s = stateRef.current;
      if (s.mode === 'polygon') {
        setState({ ...s, cursor: pt });
        return true;
      }
      const press = pressRef.current;
      if (s.mode === 'freehand' && press && s.draft) {
        if (!press.moved && Math.hypot(pt.x - press.start.x, pt.y - press.start.y) * zoom >= CLICK_SLOP_PX) {
          press.moved = true;
        }
        const last = s.draft[s.draft.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) * zoom >= 1.5) {
          setState({ ...s, draft: [...s.draft, pt], cursor: pt });
        }
      }
      return true;
    },
    [active, setState, zoom]
  );

  const handleMouseUp = useCallback(() => {
    const s = stateRef.current;
    const press = pressRef.current;
    pressRef.current = null;
    if (s.mode !== 'freehand' || !press || !s.draft) return;
    if (!press.moved) {
      // A click: switch to polygon lasso anchored at this point
      setState({ draft: [press.start], mode: 'polygon', cursor: press.start, selection: null });
      return;
    }
    close(s.draft);
  }, [close, setState]);

  const runAction = useCallback(
    async (action: LassoAction) => {
      const poly = stateRef.current.selection;
      if (!poly || busy) return;
      setBusy(true);
      try {
        const keep = await onAction(poly, action);
        // Copy keeps the outline so the user can copy/cut again; others consume it
        if (action !== 'copy' && keep !== true) clear();
      } finally {
        setBusy(false);
      }
    },
    [busy, clear, onAction]
  );

  useEffect(() => {
    if (!active || (!state.selection && !state.draft)) return;
    const onKey = (e: KeyboardEvent) => {
      if (shouldBlockDocumentShortcut({ modalOpen: !inputEnabled, target: e.target })) return;
      const s = stateRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (s.draft && s.mode === 'polygon') {
        if (e.key === 'Enter') {
          consume();
          close(s.draft);
        } else if (e.key === 'Escape') {
          consume();
          clear();
        } else if (e.key === 'Backspace') {
          consume();
          if (s.draft.length <= 1) clear();
          else setState({ ...s, draft: s.draft.slice(0, -1) });
        }
        return;
      }
      if (!s.selection) return;
      const key = e.key.toLowerCase();
      if (mod && key === 'c') {
        consume();
        void runAction('copy');
      } else if (mod && key === 'x') {
        consume();
        void runAction('cut');
      } else if (mod && key === 'j') {
        consume();
        void runAction('duplicate');
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        consume();
        void runAction('erase');
      } else if (e.key === 'Escape') {
        consume();
        clear();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, state.selection, state.draft, inputEnabled, close, clear, runAction, setState]);

  return {
    draft: state.draft,
    mode: state.mode,
    cursor: state.cursor,
    selection: state.selection,
    busy,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    runAction,
    clear,
  };
}
