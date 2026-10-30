import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PathNode, Point } from '../types';
import { shouldBlockDocumentShortcut } from '../utils/documentShortcuts';

/** Screen pixels within which a click on the first anchor closes the path */
const CLOSE_RADIUS_PX = 8;
/** Drag shorter than this (screen px) keeps the new anchor a sharp corner */
const HANDLE_MIN_PX = 3;

export interface PenDraft {
  nodes: PathNode[];
  cursor: Point | null;
  /** Anchor whose handles are being pulled out right now */
  draggingIndex: number | null;
}

interface UsePenToolOptions {
  active: boolean;
  inputEnabled: boolean;
  zoom: number;
  snap: (p: Point) => Point;
  onCreatePath: (absNodes: PathNode[], closed: boolean) => void;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** 45° constraint relative to the previous anchor (Shift) */
function constrain45(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

/**
 * Pen (Bezier) drawing: click = corner anchor, click-drag = smooth anchor,
 * click the first anchor = close, double-click / Enter = finish open path,
 * Backspace = remove last anchor, Esc = cancel.
 */
export function usePenTool({ active, inputEnabled, zoom, snap, onCreatePath }: UsePenToolOptions) {
  const [draft, setDraftState] = useState<PenDraft | null>(null);
  const draftRef = useRef<PenDraft | null>(null);

  const setDraft = useCallback((next: PenDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const cancel = useCallback(() => setDraft(null), [setDraft]);

  const finish = useCallback(
    (closed: boolean) => {
      const d = draftRef.current;
      setDraft(null);
      if (!d || d.nodes.length < 2) return;
      onCreatePath(d.nodes, closed);
    },
    [onCreatePath, setDraft]
  );

  useEffect(() => {
    if (!active) setDraft(null);
  }, [active, setDraft]);

  const handleMouseDown = useCallback(
    (raw: Point, e: React.MouseEvent) => {
      const d = draftRef.current;
      const nodes = d?.nodes ?? [];
      let p = snap(raw);
      if (e.shiftKey && nodes.length > 0) p = constrain45(nodes[nodes.length - 1], p);

      if (nodes.length >= 2 && dist(raw, nodes[0]) <= CLOSE_RADIUS_PX / zoom) {
        finish(true);
        return;
      }
      // Second press of a double-click finishes instead of adding a duplicate anchor
      if (e.detail >= 2 && nodes.length >= 2) {
        finish(false);
        return;
      }
      const nextNodes = [...nodes, { x: p.x, y: p.y }];
      setDraft({ nodes: nextNodes, cursor: p, draggingIndex: nextNodes.length - 1 });
    },
    [finish, setDraft, snap, zoom]
  );

  /** Returns true when the pen consumed the move. */
  const handleMouseMove = useCallback(
    (raw: Point, e: React.MouseEvent): boolean => {
      const d = draftRef.current;
      if (!active) return false;
      if (!d) return true;
      if (d.draggingIndex != null) {
        const nodes = d.nodes.slice();
        const n = { ...nodes[d.draggingIndex] };
        if (dist(raw, n) < HANDLE_MIN_PX / zoom) {
          delete n.handleIn;
          delete n.handleOut;
        } else {
          n.handleOut = { x: raw.x, y: raw.y };
          // Alt: one-sided handle (cusp); otherwise mirror for a smooth anchor
          if (e.altKey) delete n.handleIn;
          else n.handleIn = { x: 2 * n.x - raw.x, y: 2 * n.y - raw.y };
        }
        nodes[d.draggingIndex] = n;
        setDraft({ ...d, nodes, cursor: raw });
        return true;
      }
      let p = snap(raw);
      if (e.shiftKey && d.nodes.length > 0) p = constrain45(d.nodes[d.nodes.length - 1], p);
      setDraft({ ...d, cursor: p });
      return true;
    },
    [active, setDraft, snap, zoom]
  );

  const handleMouseUp = useCallback(() => {
    const d = draftRef.current;
    if (d && d.draggingIndex != null) setDraft({ ...d, draggingIndex: null });
  }, [setDraft]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (shouldBlockDocumentShortcut({ modalOpen: !inputEnabled, target: e.target })) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        const d = draftRef.current;
        if (!d || d.nodes.length <= 1) {
          cancel();
          return;
        }
        setDraft({ ...d, nodes: d.nodes.slice(0, -1), draggingIndex: null });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft, finish, cancel, setDraft, inputEnabled]);

  return {
    draft,
    isDrawing: !!draft,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    finish,
    cancel,
  };
}
