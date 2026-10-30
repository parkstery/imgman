import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Scissors, ImagePlus, Eraser, X } from 'lucide-react';
import { PathNode, Point, ShapeElement } from '../types';
import { getRotationOriginAttr, canvasToLocal } from '../utils/elementGeometry';
import {
  deleteNode,
  getPathNodesD,
  moveHandle,
  moveNode,
  nearestOnPath,
  refitPathElement,
  splitSegment,
  toggleNodeSmooth,
} from '../utils/pathNodes';
import { shouldBlockDocumentShortcut } from '../utils/documentShortcuts';
import type { PenDraft } from '../hooks/usePenTool';
import type { LassoMode } from '../hooks/useLassoTool';
import type { LassoAction } from '../utils/lassoSelection';

const ACCENT = '#F59E0B';

const polyD = (pts: Point[], closed: boolean) =>
  pts.length === 0
    ? ''
    : pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (closed ? ' Z' : '');

/* ------------------------------------------------------------------------ */
/* Pen draft preview (inside the stage SVG, canvas coordinates)             */
/* ------------------------------------------------------------------------ */

export const PenDraftOverlay: React.FC<{
  draft: PenDraft;
  zoom: number;
  stroke: string;
  strokeWidth: number;
}> = ({ draft, zoom, stroke, strokeWidth }) => {
  const { nodes, cursor, draggingIndex } = draft;
  if (nodes.length === 0) return null;
  const u = 1 / Math.max(zoom, 0.01);
  const last = nodes[nodes.length - 1];
  let rubber = '';
  if (cursor && draggingIndex == null) {
    rubber = last.handleOut
      ? `M ${last.x} ${last.y} C ${last.handleOut.x} ${last.handleOut.y} ${cursor.x} ${cursor.y} ${cursor.x} ${cursor.y}`
      : `M ${last.x} ${last.y} L ${cursor.x} ${cursor.y}`;
  }
  const nearFirst =
    nodes.length >= 2 &&
    cursor != null &&
    draggingIndex == null &&
    Math.hypot(cursor.x - nodes[0].x, cursor.y - nodes[0].y) <= 8 * u;
  const showHandlesFor = draggingIndex ?? nodes.length - 1;
  const hn = nodes[showHandlesFor];

  return (
    <g className="pointer-events-none">
      <path
        d={getPathNodesD(nodes, false)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      {rubber && (
        <path d={rubber} fill="none" stroke={ACCENT} strokeWidth={1.25 * u} strokeDasharray={`${5 * u} ${4 * u}`} />
      )}
      {hn &&
        (['handleIn', 'handleOut'] as const).map((k) =>
          hn[k] ? (
            <g key={k}>
              <line x1={hn.x} y1={hn.y} x2={hn[k]!.x} y2={hn[k]!.y} stroke={ACCENT} strokeWidth={u} />
              <circle cx={hn[k]!.x} cy={hn[k]!.y} r={3.5 * u} fill="#fff" stroke={ACCENT} strokeWidth={1.25 * u} />
            </g>
          ) : null
        )}
      {nodes.map((n, i) => (
        <rect
          key={i}
          x={n.x - 3.5 * u}
          y={n.y - 3.5 * u}
          width={7 * u}
          height={7 * u}
          fill={i === 0 && nearFirst ? ACCENT : '#fff'}
          stroke={ACCENT}
          strokeWidth={1.25 * u}
        />
      ))}
      {nearFirst && (
        <circle cx={nodes[0].x} cy={nodes[0].y} r={8 * u} fill="none" stroke={ACCENT} strokeWidth={1.25 * u} />
      )}
    </g>
  );
};

/* ------------------------------------------------------------------------ */
/* Lasso outline / selection (inside the stage SVG)                         */
/* ------------------------------------------------------------------------ */

export const LassoOverlay: React.FC<{
  draft: Point[] | null;
  mode: LassoMode | null;
  cursor: Point | null;
  selection: Point[] | null;
  zoom: number;
}> = ({ draft, mode, cursor, selection, zoom }) => {
  const u = 1 / Math.max(zoom, 0.01);
  const dash = `${5 * u} ${5 * u}`;
  if (selection) {
    const d = polyD(selection, true);
    return (
      <g className="pointer-events-none">
        <path d={d} fill="rgba(245, 158, 11, 0.10)" stroke="#000" strokeWidth={1.25 * u} />
        <path d={d} fill="none" stroke="#fff" strokeWidth={1.25 * u} strokeDasharray={dash}>
          <animate attributeName="stroke-dashoffset" values={`0;${10 * u}`} dur="0.7s" repeatCount="indefinite" />
        </path>
      </g>
    );
  }
  if (!draft || draft.length === 0) return null;
  const pts = mode === 'polygon' && cursor ? [...draft, cursor] : draft;
  return (
    <g className="pointer-events-none">
      <path d={polyD(pts, mode === 'freehand')} fill="rgba(245, 158, 11, 0.08)" stroke="#000" strokeWidth={1.25 * u} />
      <path d={polyD(pts, mode === 'freehand')} fill="none" stroke="#fff" strokeWidth={1.25 * u} strokeDasharray={dash} />
      {mode === 'polygon' &&
        draft.map((p, i) => (
          <rect
            key={i}
            x={p.x - 3 * u}
            y={p.y - 3 * u}
            width={6 * u}
            height={6 * u}
            fill={i === 0 ? ACCENT : '#fff'}
            stroke="#000"
            strokeWidth={u}
          />
        ))}
    </g>
  );
};

/* ------------------------------------------------------------------------ */
/* Lasso action bar (HTML, above the stage)                                 */
/* ------------------------------------------------------------------------ */

const LASSO_BUTTONS: { action: LassoAction; label: string; key: string; icon: React.ReactNode; title: string }[] = [
  { action: 'copy', label: '복사', key: 'Ctrl+C', icon: <Copy className="w-3 h-3" />, title: '선택 영역을 클립보드로 복사' },
  { action: 'cut', label: '잘라내기', key: 'Ctrl+X', icon: <Scissors className="w-3 h-3" />, title: '복사한 뒤 이미지에서 선택 영역을 지웁니다' },
  { action: 'duplicate', label: '새 이미지로', key: 'Ctrl+J', icon: <ImagePlus className="w-3 h-3" />, title: '선택 영역을 같은 자리에 새 이미지 객체로 만듭니다' },
  { action: 'erase', label: '지우기', key: 'Del', icon: <Eraser className="w-3 h-3" />, title: '선택 영역의 이미지 픽셀을 투명하게 지웁니다' },
];

export const LassoActionBar: React.FC<{
  hasSelection: boolean;
  drawingPolygon: boolean;
  busy: boolean;
  onAction: (action: LassoAction) => void;
  onClear: () => void;
}> = ({ hasSelection, drawingPolygon, busy, onAction, onClear }) => (
  <div className="absolute top-9 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
    <div className="pointer-events-auto bg-stone-900/95 backdrop-blur border border-amber-500/50 rounded-lg px-3 py-1.5 text-[11px] text-stone-200 flex items-center gap-2 shadow-xl whitespace-nowrap">
      <span className="font-semibold text-amber-300">올가미 선택</span>
      {!hasSelection ? (
        <span className="text-stone-400">
          {drawingPolygon
            ? '클릭으로 꼭짓점 추가 · 첫 점 클릭/더블클릭/Enter로 닫기 · Backspace 되돌리기 · Esc 취소'
            : '드래그: 자유 곡선 · 클릭: 다각형 올가미'}
        </span>
      ) : (
        <>
          <span className="text-stone-700">|</span>
          {LASSO_BUTTONS.map((b) => (
            <button
              key={b.action}
              type="button"
              disabled={busy}
              onClick={() => onAction(b.action)}
              title={`${b.title} (${b.key})`}
              className="px-2 py-1 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-wait text-stone-200 rounded flex items-center gap-1 transition-colors"
            >
              {b.icon}
              {b.label}
              <span className="font-mono text-[9px] text-stone-500">{b.key}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            title="선택 해제 (Esc)"
            className="p-1 text-stone-400 hover:text-stone-100 hover:bg-stone-700 rounded transition-colors"
            aria-label="선택 해제"
          >
            <X className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  </div>
);

/* ------------------------------------------------------------------------ */
/* Node editor for pen paths (overlay inside the zoomed viewport)            */
/* ------------------------------------------------------------------------ */

type DragKind = 'anchor' | 'in' | 'out';

export const PathNodeEditor: React.FC<{
  element: ShapeElement;
  zoom: number;
  inputEnabled: boolean;
  clientToCanvas: (clientX: number, clientY: number) => Point;
  onChange: (el: ShapeElement, options?: { skipHistory?: boolean }) => void;
  onExit: () => void;
}> = ({ element, zoom, inputEnabled, clientToCanvas, onChange, onExit }) => {
  const [selected, setSelected] = useState<number | null>(null);
  const elementRef = useRef(element);
  elementRef.current = element;
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const nodes = element.pathNodes ?? [];
  const closed = !!element.pathClosed;
  const u = 1 / Math.max(zoom, 0.01);

  useEffect(() => {
    if (selected != null && selected >= nodes.length) setSelected(nodes.length ? nodes.length - 1 : null);
  }, [nodes.length, selected]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const commit = useCallback(
    (nextNodes: PathNode[]) => {
      onChange(refitPathElement({ ...elementRef.current, pathNodes: nextNodes }));
    },
    [onChange]
  );

  const startDrag = (kind: DragKind, index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (kind === 'anchor') setSelected(index);
    const start = elementRef.current;
    const startNodes = start.pathNodes ?? [];
    let latest: PathNode[] | null = null;

    const onMove = (ev: MouseEvent) => {
      const local = canvasToLocal(start, clientToCanvas(ev.clientX, ev.clientY));
      latest =
        kind === 'anchor'
          ? moveNode(startNodes, index, local)
          : moveHandle(startNodes, index, kind, local, ev.altKey);
      onChange({ ...start, pathNodes: latest }, { skipHistory: true });
    };
    const onUp = () => {
      cleanup();
      if (latest) onChange(refitPathElement({ ...start, pathNodes: latest }));
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleAnchorMouseDown = (index: number, e: React.MouseEvent) => {
    if (e.altKey) {
      e.stopPropagation();
      e.preventDefault();
      setSelected(index);
      commit(toggleNodeSmooth(nodes, closed, index));
      return;
    }
    startDrag('anchor', index, e);
  };

  const handleOutlineDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const local = canvasToLocal(element, clientToCanvas(e.clientX, e.clientY));
    const hit = nearestOnPath(nodes, closed, local);
    if (!hit || hit.dist > 12 * u) return;
    const t = Math.min(0.98, Math.max(0.02, hit.t));
    commit(splitSegment(nodes, hit.segment, t));
    setSelected(hit.segment + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldBlockDocumentShortcut({ modalOpen: !inputEnabled, target: e.target })) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onExit();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) {
        e.preventDefault();
        e.stopPropagation();
        const next = deleteNode(elementRef.current.pathNodes ?? [], selected);
        if (next) {
          commit(next);
          setSelected(Math.max(0, selected - 1));
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, inputEnabled, onExit, commit]);

  if (nodes.length < 2) return null;

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const flipT =
    element.flipH || element.flipV
      ? `translate(${cx} ${cy}) scale(${element.flipH ? -1 : 1} ${element.flipV ? -1 : 1}) translate(${-cx} ${-cy})`
      : undefined;
  const d = getPathNodesD(nodes, closed);

  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-20">
      <g transform={flipT}>
        <g transform={`translate(${element.x}, ${element.y}) rotate(${element.rotation || 0} ${getRotationOriginAttr(element)})`}>
          <path d={d} fill="none" stroke={ACCENT} strokeWidth={1.25 * u} />
          <path
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={12 * u}
            style={{ pointerEvents: 'stroke', cursor: 'copy' }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={handleOutlineDoubleClick}
          >
            <title>더블클릭: 점 추가</title>
          </path>
          {nodes.map((n, i) =>
            (['handleIn', 'handleOut'] as const).map((k) => {
              const h = n[k];
              if (!h) return null;
              return (
                <g key={`${i}-${k}`}>
                  <line x1={n.x} y1={n.y} x2={h.x} y2={h.y} stroke={ACCENT} strokeWidth={u} />
                  <circle
                    cx={h.x}
                    cy={h.y}
                    r={4 * u}
                    fill="#fff"
                    stroke={ACCENT}
                    strokeWidth={1.25 * u}
                    style={{ pointerEvents: 'all', cursor: 'pointer' }}
                    onMouseDown={(e) => startDrag(k === 'handleIn' ? 'in' : 'out', i, e)}
                  />
                </g>
              );
            })
          )}
          {nodes.map((n, i) => (
            <rect
              key={i}
              x={n.x - 4.5 * u}
              y={n.y - 4.5 * u}
              width={9 * u}
              height={9 * u}
              fill={selected === i ? ACCENT : '#fff'}
              stroke={selected === i ? '#000' : ACCENT}
              strokeWidth={1.25 * u}
              style={{ pointerEvents: 'all', cursor: 'move' }}
              onMouseDown={(e) => handleAnchorMouseDown(i, e)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                commit(toggleNodeSmooth(elementRef.current.pathNodes ?? [], closed, i));
              }}
            >
              <title>드래그: 이동 · 더블클릭/Alt+클릭: 곡선↔직선 · Delete: 삭제</title>
            </rect>
          ))}
        </g>
      </g>
    </svg>
  );
};

export const PathEditHint: React.FC<{ onDone: () => void }> = ({ onDone }) => (
  <div className="absolute top-9 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
    <div className="pointer-events-auto bg-stone-900/95 backdrop-blur border border-amber-500/50 rounded-lg px-3 py-1.5 text-[11px] text-stone-300 flex items-center gap-2.5 shadow-xl whitespace-nowrap">
      <span className="font-semibold text-amber-300">점 편집</span>
      <span>점·핸들 드래그 · 선 더블클릭: 점 추가 · 점 더블클릭: 곡선↔직선 · Delete: 점 삭제 · Alt+핸들: 비대칭</span>
      <button
        type="button"
        onClick={onDone}
        className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded transition-colors"
        title="점 편집 끝내기 (Esc / Enter)"
      >
        완료
      </button>
    </div>
  </div>
);
