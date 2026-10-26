import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  CanvasConfig,
  CanvasElement,
  Layer,
  ToolType,
  ShapeType,
  Point,
  ShapeElement,
  BrushStrokeElement,
  TextElement,
  ImageElement,
  HandleType,
  ShapeStylePreset,
  RadialToolState,
  RadialStep,
} from '../types';
import { getShapePath, getPolylinePath, finalizePolylineGeometry, getArcPath, computeArcFromChordAndBend, finalizeArcGeometry } from '../utils/shapeGenerators';
import { getRotationOriginAttr } from '../utils/elementGeometry';
import { brushPath } from '../utils/svgExport';
import {
  getArrowHeadPath,
  getShortenedLineEndpoints,
  isArrowHeadFilled,
  getConstrainedPoint,
} from '../utils/arrowUtils';
import type { ArrowConfig, ArrowType, ArrowSize } from '../types';
import { ArrowLineRenderer } from './ArrowLineRenderer';
import { sampleColorFromCanvas } from '../utils/rasterExport';
import { getToolCursor } from '../utils/cursorUtils';
import {
  autoCropCanvas,
  autoCropImageElement,
  padRect,
  trimFailureMessage,
  CropRect,
} from '../utils/autoCrop';
import { Crop, Scissors, Copy, Wand2, Minus, Plus } from 'lucide-react';

/** Default text tool: compact 12px label box */
const DEFAULT_TEXT_FONT_SIZE = 12;
const DEFAULT_TEXT_BOX_WIDTH = 96;
const DEFAULT_TEXT_BOX_HEIGHT = 22;

interface CanvasAreaProps {
  config: CanvasConfig;
  onUpdateConfig: (partial: Partial<CanvasConfig>) => void;
  onCropCanvas?: (crop: { x: number; y: number; w: number; h: number }) => void;
  onCutCanvasRegion?: (crop: { x: number; y: number; w: number; h: number }) => Promise<void> | void;
  onCopyCanvasRegion?: (crop: { x: number; y: number; w: number; h: number }) => Promise<void> | void;
  onTriggerPaste?: () => void;
  onMouseMoveCanvas?: (pt: Point) => void;
  onCopyImagePart?: (imgElem: ImageElement, crop: { x: number; y: number; w: number; h: number }) => void;
  onCutImagePart?: (imgElem: ImageElement, crop: { x: number; y: number; w: number; h: number }) => void;
  onCropBoxChange?: (box: { x: number; y: number; w: number; h: number } | null) => void;
  layers: Layer[];
  elements: CanvasElement[];
  onAddElement: (element: CanvasElement) => void;
  onUpdateElement: (
    updated: CanvasElement,
    options?: { skipHistory?: boolean }
  ) => void;
  /** Batch-update multiple elements in one state commit (for group move) */
  onUpdateElements?: (
    updated: CanvasElement[],
    options?: { skipHistory?: boolean }
  ) => void;
  /** Commit current canvas state to undo history (e.g. after drag ends) */
  onCommitHistory?: () => void;
  onDeleteElement: (id: string) => void;
  activeLayerId: string;
  selectedElementId: string | null;
  selectedElementIds: string[];
  onSelectElement: (id: string | null) => void;
  onSelectMultipleElements: (ids: string[]) => void;
  onToggleSelectElement: (id: string, isShift: boolean) => void;
  currentTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  selectedShapeType: ShapeType;
  primaryColor: string;
  onPrimaryColorChange: (color: string) => void;
  strokeWidth: number;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  lastShapeStyle: ShapeStylePreset;
  croppingImageId?: string | null;
  onStartCropImage?: (id: string) => void;
  onFinishCropImage?: () => void;
  onInsertImage?: (file: File) => void;
  // Radial Tool
  radialToolState?: RadialToolState;
  onRadialSetCenter?: (x: number, y: number) => void;
  onRadialUpdateRadius?: (radius: number, angle?: number) => void;
  /** Lock / unlock the radius (the radius follows the cursor while unlocked) */
  onRadialSetStep?: (step: RadialStep) => void;
  // Group / Ungroup
  onGroup?: () => void;
  onUngroup?: () => void;
}

/**
 * One copy of the radial array, drawn in a semi-transparent preview state.
 * Mirrors the element rendering of the canvas stage.
 */
const RadialPreviewItem: React.FC<{ el: CanvasElement }> = ({ el }) => {
  const rot = el.rotation || 0;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const flipT =
    el.flipH || el.flipV
      ? `translate(${cx} ${cy}) scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1}) translate(${-cx} ${-cy})`
      : undefined;
  const isStrokeOnly =
    el.type === 'shape' &&
    (el.shapeType === 'line' ||
      el.shapeType.startsWith('line-arrow') ||
      el.shapeType === 'polyline' ||
      el.shapeType === 'arc');

  return (
    <g transform={flipT} opacity={0.7}>
      {el.type === 'shape' && (
        <g
          transform={`translate(${el.x}, ${el.y}) rotate(${rot} ${getRotationOriginAttr(el)})`}
        >
          <path
            d={
              el.shapeType === 'polyline' && el.points && el.points.length >= 2
                ? getPolylinePath(el.points)
                : el.shapeType === 'arc' &&
                  el.points &&
                  el.points.length >= 2 &&
                  el.arcRadius != null
                ? getArcPath(
                    el.points[0],
                    el.points[1],
                    el.arcRadius,
                    !!el.arcLarge,
                    !!el.arcSweep
                  )
                : getShapePath(el.shapeType, el.width, el.height, el.cornerRadius, el.strokeWidth)
            }
            fill={isStrokeOnly ? 'none' : el.fill}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={
              el.strokeDash === 'dashed' ? '8 6' : el.strokeDash === 'dotted' ? '3 4' : undefined
            }
            opacity={el.opacity}
          />
        </g>
      )}

      {el.type === 'brush' && (
        <path
          d={brushPath(el.points)}
          fill="none"
          stroke={el.color}
          strokeWidth={el.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={el.isHighlighter ? el.opacity * 0.45 : el.opacity}
        />
      )}

      {el.type === 'text' && (
        <g transform={rot !== 0 ? `rotate(${rot} ${cx} ${cy})` : undefined}>
          <text
            x={el.align === 'center' ? cx : el.align === 'right' ? el.x + el.width : el.x}
            y={el.y + el.fontSize}
            fontFamily={el.fontFamily}
            fontSize={el.fontSize}
            fontWeight={el.bold ? 'bold' : 'normal'}
            fontStyle={el.italic ? 'italic' : 'normal'}
            textDecoration={el.underline ? 'underline' : 'none'}
            fill={el.color}
            textAnchor={
              el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start'
            }
            opacity={el.opacity}
          >
            {el.text.split('\n').map((line, i) => (
              <tspan
                key={i}
                x={
                  el.align === 'center'
                    ? cx
                    : el.align === 'right'
                    ? el.x + el.width
                    : el.x
                }
                dy={i === 0 ? 0 : el.fontSize * 1.3}
              >
                {line.length === 0 ? '\u00A0' : line}
              </tspan>
            ))}
          </text>
        </g>
      )}

      {el.type === 'image' && (
        <g transform={rot !== 0 ? `rotate(${rot} ${cx} ${cy})` : undefined}>
          <image
            href={el.src}
            x={el.x}
            y={el.y}
            width={el.width}
            height={el.height}
            preserveAspectRatio="none"
            opacity={el.opacity}
            style={{
              filter: `brightness(${el.filters.brightness}%) contrast(${el.filters.contrast}%) saturate(${el.filters.saturation}%) blur(${el.filters.blur}px) grayscale(${el.filters.grayscale}%) invert(${el.filters.invert}%)`,
            }}
          />
        </g>
      )}
    </g>
  );
};

export const CanvasArea: React.FC<CanvasAreaProps> = ({
  config,
  onUpdateConfig,
  onCropCanvas,
  onCutCanvasRegion,
  onCopyCanvasRegion,
  onTriggerPaste,
  onMouseMoveCanvas,
  onCopyImagePart,
  onCutImagePart,
  onCropBoxChange,
  layers,
  elements,
  onAddElement,
  onUpdateElement,
  onUpdateElements,
  onCommitHistory,
  onDeleteElement,
  activeLayerId,
  selectedElementId,
  selectedElementIds,
  onSelectElement,
  onSelectMultipleElements,
  onToggleSelectElement,
  currentTool,
  onSelectTool,
  selectedShapeType,
  primaryColor,
  onPrimaryColorChange,
  strokeWidth,
  zoom,
  onZoomChange,
  lastShapeStyle,
  croppingImageId,
  onStartCropImage,
  onFinishCropImage,
  onInsertImage,
  radialToolState,
  onRadialSetCenter,
  onRadialUpdateRadius,
  onRadialSetStep,
  onGroup,
  onUngroup,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  // Mouse coordinate tracker for rulers & line drawing
  const [cursorPos, setCursorPos] = useState<Point>({ x: 0, y: 0 });

  // Active drawing states
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<Point>({ x: 0, y: 0 });
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Line drawing preview state (start to current)
  const [linePreviewEnd, setLinePreviewEnd] = useState<Point | null>(null);

  // Continuous polyline (node-to-node) drawing draft — absolute canvas coords
  const [polylineDraft, setPolylineDraft] = useState<Point[] | null>(null);
  const [polylineCursor, setPolylineCursor] = useState<Point | null>(null);
  const polylineDraftRef = useRef<Point[] | null>(null);

  // Arc drawing: click start → click end → move to set radius (bend) → click to finish
  const [arcDraft, setArcDraft] = useState<{
    start: Point;
    end: Point | null;
  } | null>(null);
  const [arcBend, setArcBend] = useState<Point | null>(null);
  const arcDraftRef = useRef<{ start: Point; end: Point | null } | null>(null);
  const arcBendRef = useRef<Point | null>(null);

  useEffect(() => {
    polylineDraftRef.current = polylineDraft;
  }, [polylineDraft]);

  useEffect(() => {
    arcDraftRef.current = arcDraft;
  }, [arcDraft]);

  useEffect(() => {
    arcBendRef.current = arcBend;
  }, [arcBend]);

  // Cancel unfinished polyline / arc when leaving the tool
  useEffect(() => {
    if (currentTool !== 'shape' || selectedShapeType !== 'polyline') {
      polylineDraftRef.current = null;
      setPolylineDraft(null);
      setPolylineCursor(null);
    }
    if (currentTool !== 'shape' || selectedShapeType !== 'arc') {
      arcDraftRef.current = null;
      arcBendRef.current = null;
      setArcDraft(null);
      setArcBend(null);
    }
  }, [currentTool, selectedShapeType]);

  const finishPolylineDraft = useCallback(() => {
    const draft = polylineDraftRef.current;
    polylineDraftRef.current = null;
    setPolylineDraft(null);
    setPolylineCursor(null);
    const layer = layers.find((l) => l.id === activeLayerId) || layers[0];
    if (!draft || draft.length < 2 || !layer || layer.locked) return;

    const geom = finalizePolylineGeometry(draft);
    const strokeW =
      lastShapeStyle.strokeWidth && lastShapeStyle.strokeWidth > 0
        ? lastShapeStyle.strokeWidth
        : strokeWidth || 2;
    const lineStroke =
      lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none'
        ? lastShapeStyle.stroke
        : primaryColor || '#000000';

    const newPoly: ShapeElement = {
      id: 'shape-polyline-' + Date.now(),
      layerId: layer.id,
      name: '연속 선',
      type: 'shape',
      shapeType: 'polyline',
      x: geom.x,
      y: geom.y,
      width: Math.max(geom.width, 1),
      height: Math.max(geom.height, 1),
      rotation: 0,
      opacity: lastShapeStyle.opacity ?? 1,
      fill: 'none',
      stroke: lineStroke,
      strokeWidth: strokeW,
      strokeDash: lastShapeStyle.strokeDash || 'solid',
      shadow: lastShapeStyle.shadow,
      points: geom.points,
    };
    onAddElement(newPoly);
    onSelectElement(newPoly.id);
  }, [
    layers,
    activeLayerId,
    lastShapeStyle,
    strokeWidth,
    primaryColor,
    onAddElement,
    onSelectElement,
  ]);

  const cancelPolylineDraft = useCallback(() => {
    polylineDraftRef.current = null;
    setPolylineDraft(null);
    setPolylineCursor(null);
  }, []);

  const cancelArcDraft = useCallback(() => {
    arcDraftRef.current = null;
    arcBendRef.current = null;
    setArcDraft(null);
    setArcBend(null);
  }, []);

  const finishArcDraft = useCallback(() => {
    const draft = arcDraftRef.current;
    const bend = arcBendRef.current;
    arcDraftRef.current = null;
    arcBendRef.current = null;
    setArcDraft(null);
    setArcBend(null);

    const layer = layers.find((l) => l.id === activeLayerId) || layers[0];
    if (!draft?.start || !draft.end || !bend || !layer || layer.locked) return;

    const computed = computeArcFromChordAndBend(draft.start, draft.end, bend);
    if (!computed) return;

    const geom = finalizeArcGeometry(
      draft.start,
      draft.end,
      computed.radius,
      computed.large,
      computed.sweep
    );
    const strokeW =
      lastShapeStyle.strokeWidth && lastShapeStyle.strokeWidth > 0
        ? lastShapeStyle.strokeWidth
        : strokeWidth || 2;
    const lineStroke =
      lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none'
        ? lastShapeStyle.stroke
        : primaryColor || '#000000';

    const newArc: ShapeElement = {
      id: 'shape-arc-' + Date.now(),
      layerId: layer.id,
      name: '아크',
      type: 'shape',
      shapeType: 'arc',
      x: geom.x,
      y: geom.y,
      width: Math.max(geom.width, 1),
      height: Math.max(geom.height, 1),
      rotation: 0,
      opacity: lastShapeStyle.opacity ?? 1,
      fill: 'none',
      stroke: lineStroke,
      strokeWidth: strokeW,
      strokeDash: lastShapeStyle.strokeDash || 'solid',
      shadow: lastShapeStyle.shadow,
      points: geom.points,
      arcRadius: geom.arcRadius,
      arcLarge: geom.arcLarge,
      arcSweep: geom.arcSweep,
    };
    onAddElement(newArc);
    onSelectElement(newArc.id);
  }, [
    layers,
    activeLayerId,
    lastShapeStyle,
    strokeWidth,
    primaryColor,
    onAddElement,
    onSelectElement,
  ]);

  const snapPolylineAngle = useCallback((from: Point, to: Point): Point => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.1) return to;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snappedDeg = Math.round(deg / 45) * 45;
    const rad = (snappedDeg * Math.PI) / 180;
    return {
      x: from.x + Math.cos(rad) * dist,
      y: from.y + Math.sin(rad) * dist,
    };
  }, []);

  // Marquee selection box state (for multi-selection)
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Transform states (Move / Resize / Rotate selected element(s))
  const [isTransforming, setIsTransforming] = useState(false);
  const transformDirtyRef = useRef(false);
  const [activeHandle, setActiveHandle] = useState<HandleType | 'move' | null>(null);
  const [transformStart, setTransformStart] = useState<{
    clientX: number;
    clientY: number;
    elemX: number;
    elemY: number;
    elemW: number;
    elemH: number;
    elemRotation: number;
    elementsStartPositions: { id: string; x: number; y: number }[];
    lineStart?: Point;
    lineEnd?: Point;
    pointsStart?: Point[];
    arcRadiusStart?: number;
  } | null>(null);

  // Canvas crop tool state
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // PowerPoint-style Image Crop States
  const [imgCropBox, setImgCropBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });
  const [imgCropActiveHandle, setImgCropActiveHandle] = useState<
    'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | null
  >(null);
  const [imgCropDragStart, setImgCropDragStart] = useState<{
    clientX: number;
    clientY: number;
    initialBox: { x: number; y: number; w: number; h: number };
  } | null>(null);
  // Parent passes a new callback whenever crop state updates. Effects must not
  // depend on that identity, or the crop rectangle resets to the full image.
  const onCropBoxChangeRef = useRef(onCropBoxChange);
  onCropBoxChangeRef.current = onCropBoxChange;

  // ── Auto Crop (Trim) ─────────────────────────────────────────────────────
  // 여백(px)은 크롭 박스와 같은 좌표계(이미지 로컬 / 캔버스)로 적용된다.
  const [autoCropPadding, setAutoCropPadding] = useState(10);
  const [isAutoCropping, setIsAutoCropping] = useState(false);
  const [autoCropNotice, setAutoCropNotice] = useState<string | null>(null);
  const cropAnimRef = useRef<number | null>(null);

  // Inline text editing
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editingTextSnapshot, setEditingTextSnapshot] = useState<TextElement | null>(null);
  const textEditRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering text edit mode
  useEffect(() => {
    if (!editingTextId || !textEditRef.current) return;
    const el = textEditRef.current;
    // Defer focus so the textarea is mounted after state commit
    const t = requestAnimationFrame(() => {
      el.focus();
      if (editDraft) {
        el.select();
      }
    });
    return () => cancelAnimationFrame(t);
  }, [editingTextId]);

  const measureTextBox = useCallback((text: string, fontSize: number, minW = 80) => {
    const lines = text.length > 0 ? text.split('\n') : [''];
    const longest = Math.max(...lines.map((l) => l.length), 1);
    const width = Math.max(minW, Math.ceil(longest * fontSize * 0.62) + 12);
    const height = Math.max(fontSize + 10, Math.ceil(lines.length * fontSize * 1.3) + 8);
    return { width, height };
  }, []);

  const beginTextEdit = useCallback(
    (textEl: TextElement) => {
      onSelectElement(textEl.id);
      setEditingTextId(textEl.id);
      setEditingTextSnapshot(textEl);
      setEditDraft(textEl.text);
    },
    [onSelectElement]
  );

  const commitTextEdit = useCallback(() => {
    if (!editingTextId) return;
    const live = elements.find((el) => el.id === editingTextId && el.type === 'text') as
      | TextElement
      | undefined;
    const textEl = live || editingTextSnapshot;
    const draft = editDraft;
    setEditingTextId(null);
    setEditingTextSnapshot(null);

    if (!textEl) return;

    if (!draft.trim()) {
      onDeleteElement(textEl.id);
      onSelectElement(null);
      return;
    }

    const fontSize = textEl.fontSize > 0 ? textEl.fontSize : DEFAULT_TEXT_FONT_SIZE;
    const { width, height } = measureTextBox(draft, fontSize, DEFAULT_TEXT_BOX_WIDTH);
    onUpdateElement({
      ...textEl,
      text: draft,
      fontSize,
      width: Math.max(DEFAULT_TEXT_BOX_WIDTH, width),
      height: Math.max(DEFAULT_TEXT_BOX_HEIGHT, height),
    });
  }, [
    editingTextId,
    editingTextSnapshot,
    editDraft,
    elements,
    measureTextBox,
    onDeleteElement,
    onSelectElement,
    onUpdateElement,
  ]);

  const croppingImage = useMemo(
    () =>
      croppingImageId
        ? (elements.find((el) => el.id === croppingImageId && el.type === 'image') as
            | ImageElement
            | undefined) || null
        : null,
    [elements, croppingImageId]
  );

  // Initialize crop box to the full image only when picture-crop starts.
  useEffect(() => {
    if (!croppingImageId) {
      onCropBoxChangeRef.current?.(null);
      return;
    }
    const img = elements.find(
      (el) => el.id === croppingImageId && el.type === 'image'
    ) as ImageElement | undefined;
    if (!img) return;
    const initial = { x: 0, y: 0, w: img.width, h: img.height };
    setImgCropBox(initial);
    onCropBoxChangeRef.current?.(initial);
    // Read the image at the moment crop mode starts. Later parent renders must not reset the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [croppingImageId]);

  useEffect(() => {
    if (!croppingImageId) return;
    if (imgCropBox.w < 1 || imgCropBox.h < 1) return;
    onCropBoxChangeRef.current?.(imgCropBox);
  }, [imgCropBox, croppingImageId]);

  // Is current tool an element manipulation tool or a drawing tool?
  // When in drawing tool mode (shape, brush, text, crop, pan), elements become transparent to clicks
  // so the user can freely draw shapes/lines on top of images without any blocking or hand-cursor!
  // Picture-crop mode also disables element hit-testing so outside→inside drags don't select/move.
  const isSelectOrElementTool =
    !croppingImageId &&
    (currentTool === 'select' ||
      currentTool === 'eyedropper' ||
      currentTool === 'fill' ||
      currentTool === 'eraser');

  const selectedElement = useMemo(
    () => elements.find((el) => el.id === selectedElementId) || null,
    [elements, selectedElementId]
  );

  const selectedLineEndpoints = useMemo(() => {
    // Only show line endpoint handles for a single selection
    if (selectedElementIds.length !== 1) return null;
    if (!selectedElement || selectedElement.type !== 'shape') return null;
    if (selectedElement.shapeType !== 'line' && !selectedElement.shapeType.startsWith('line-arrow')) return null;
    
    // PowerPoint-style: use points if available
    if (selectedElement.points && selectedElement.points.length >= 2) {
      const rad = ((selectedElement.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      
      // Transform points from element-local to canvas coordinates
      const p0 = selectedElement.points[0];
      const p1 = selectedElement.points[selectedElement.points.length - 1];
      
      const sx = selectedElement.x + p0.x * cos - p0.y * sin;
      const sy = selectedElement.y + p0.x * sin + p0.y * cos;
      const ex = selectedElement.x + p1.x * cos - p1.y * sin;
      const ey = selectedElement.y + p1.x * sin + p1.y * cos;
      
      return { start: { x: sx, y: sy }, end: { x: ex, y: ey } };
    }
    
    // Legacy: use width-based calculation
    const sx = selectedElement.x;
    const sy = selectedElement.y + selectedElement.height / 2;
    const rad = ((selectedElement.rotation || 0) * Math.PI) / 180;
    const ex = sx + Math.cos(rad) * selectedElement.width;
    const ey = sy + Math.sin(rad) * selectedElement.width;
    return { start: { x: sx, y: sy }, end: { x: ex, y: ey } };
  }, [selectedElement, selectedElementIds.length]);

  const selectedElements = useMemo(
    () => elements.filter((el) => selectedElementIds.includes(el.id)),
    [elements, selectedElementIds]
  );

  const groupBounds = useMemo(() => {
    if (selectedElements.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    selectedElements.forEach((el) => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    });
    if (!Number.isFinite(minX)) return null;
    return {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
    };
  }, [selectedElements]);

  const activeLayer = useMemo(
    () => layers.find((l) => l.id === activeLayerId) || layers[0],
    [layers, activeLayerId]
  );

  // Center canvas initially
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const initialPanX = Math.max(20, (rect.width - config.width * zoom) / 2);
      const initialPanY = Math.max(20, (rect.height - config.height * zoom) / 2);
      setPan({ x: initialPanX, y: initialPanY });
    }
  }, []);

  // Convert screen client coordinates to Canvas local coordinates (in px)
  const clientToCanvas = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const x = (clientX - rect.left - pan.x) / zoom;
      const y = (clientY - rect.top - pan.y) / zoom;
      return { x, y };
    },
    [pan, zoom]
  );

  // Snap to grid helper
  const snapValue = useCallback(
    (val: number): number => {
      if (!config.snapToGrid) return val;
      const size = config.gridSize;
      return Math.round(val / size) * size;
    },
    [config.snapToGrid, config.gridSize]
  );

  // Wheel zoom / pan handling
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const nextZoom = Math.min(4, Math.max(0.25, zoom + delta));
      onZoomChange(nextZoom);
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX * 0.8,
        y: prev.y - e.deltaY * 0.8,
      }));
    }
  };

  // MOUSE DOWN on Stage (Background)
  const handleMouseDown = (e: React.MouseEvent) => {
    // Bring window and container focus so keyboard events (e.g. Ctrl+V paste) work reliably in iframe
    window.focus();
    containerRef.current?.focus();

    // Middle click or Pan mode or Space key triggers pan
    if (e.button === 1 || currentTool === 'pan' || (e as any).spaceKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (e.button !== 0) return; // Left click only

    const pt = clientToCanvas(e.clientX, e.clientY);

    // Eyedropper tool
    if (currentTool === 'eyedropper') {
      sampleColorFromCanvas(layers, elements, config, pt.x, pt.y).then((color) => {
        onPrimaryColorChange(color);
      });
      return;
    }

    // Paint Bucket tool
    if (currentTool === 'fill') {
      if (selectedElement && selectedElement.type === 'shape') {
        onUpdateElement({
          ...selectedElement,
          fill: primaryColor,
        });
      } else {
        onUpdateConfig({ backgroundColor: primaryColor });
      }
      return;
    }

    // Crop tool click
    if (currentTool === 'crop') {
      setIsDrawing(true);
      setDrawStart(pt);
      setCropBox({ x: pt.x, y: pt.y, w: 0, h: 0 });
      return;
    }

    // Radial Object Tool
    if (currentTool === 'radial') {
      if (activeLayer.locked) return;
      const step = radialToolState?.step;

      if (step === 'placing_center') {
        // First click: place the center of the array (snapped to the grid when
        // grid snapping is enabled).
        const snapped = config.snapToGrid
          ? { x: snapValue(pt.x), y: snapValue(pt.y) }
          : pt;
        onRadialSetCenter?.(snapped.x, snapped.y);
        return;
      }

      if (step === 'adjusting_radius' || step === 'preview') {
        // Clicking toggles between "radius follows the cursor" and "locked".
        onRadialSetStep?.(step === 'preview' ? 'adjusting_radius' : 'preview');
      }
      return;
    }

    // Brush or Highlighter tool
    if (currentTool === 'brush' || currentTool === 'highlighter') {
      if (activeLayer.locked) return;
      setIsDrawing(true);
      setCurrentPoints([pt]);
      return;
    }

    // Eraser tool
    if (currentTool === 'eraser') {
      setIsDrawing(true);
      eraseAtPoint(pt);
      return;
    }

    // Shape Drawing Tool (including Line, Rectangle, Circle, Polyline, etc.)
    if (currentTool === 'shape') {
      if (activeLayer.locked) return;

      // Continuous polyline: each click adds a node; double-click / Enter finishes
      if (selectedShapeType === 'polyline') {
        let node = config.snapToGrid ? { x: snapValue(pt.x), y: snapValue(pt.y) } : pt;
        if (polylineDraft && polylineDraft.length > 0 && e.shiftKey) {
          node = snapPolylineAngle(polylineDraft[polylineDraft.length - 1], node);
          if (config.snapToGrid) {
            node = { x: snapValue(node.x), y: snapValue(node.y) };
          }
        }
        setPolylineDraft((prev) => {
          if (!prev) {
            const next = [node];
            polylineDraftRef.current = next;
            return next;
          }
          const last = prev[prev.length - 1];
          if (Math.hypot(node.x - last.x, node.y - last.y) < 2) return prev;
          const next = [...prev, node];
          polylineDraftRef.current = next;
          return next;
        });
        setPolylineCursor(node);
        return;
      }

      // Arc: 1st click = start, 2nd = end, 3rd = confirm radius (bend)
      if (selectedShapeType === 'arc') {
        let node = config.snapToGrid ? { x: snapValue(pt.x), y: snapValue(pt.y) } : pt;
        if (!arcDraft) {
          const next = { start: node, end: null };
          arcDraftRef.current = next;
          setArcDraft(next);
          setArcBend(node);
          return;
        }
        if (!arcDraft.end) {
          if (Math.hypot(node.x - arcDraft.start.x, node.y - arcDraft.start.y) < 4) return;
          if (e.shiftKey) {
            node = snapPolylineAngle(arcDraft.start, node);
            if (config.snapToGrid) node = { x: snapValue(node.x), y: snapValue(node.y) };
          }
          const next = { start: arcDraft.start, end: node };
          arcDraftRef.current = next;
          setArcDraft(next);
          // Seed bend slightly off the chord so preview is visible
          const mx = (arcDraft.start.x + node.x) / 2;
          const my = (arcDraft.start.y + node.y) / 2;
          const dx = node.x - arcDraft.start.x;
          const dy = node.y - arcDraft.start.y;
          const L = Math.hypot(dx, dy) || 1;
          const seed = { x: mx - (dy / L) * Math.max(12, L * 0.15), y: my + (dx / L) * Math.max(12, L * 0.15) };
          arcBendRef.current = seed;
          setArcBend(seed);
          return;
        }
        // Third click: set final bend and finish
        arcBendRef.current = node;
        setArcBend(node);
        finishArcDraft();
        return;
      }

      const startPt = config.snapToGrid ? { x: snapValue(pt.x), y: snapValue(pt.y) } : pt;
      setIsDrawing(true);
      setDrawStart(startPt);

      if (selectedShapeType === 'line' || selectedShapeType === 'line-arrow') {
        setLinePreviewEnd(startPt);
      } else {
        setPreviewRect({ x: startPt.x, y: startPt.y, w: 0, h: 0 });
      }
      return;
    }

    // Text Creation Tool — place box and open inline editor immediately
    if (currentTool === 'text') {
      if (activeLayer.locked) return;
      if (editingTextId) {
        commitTextEdit();
      }
      const newTextElem: TextElement = {
        id: 'text-' + Date.now(),
        layerId: activeLayer.id,
        name: '텍스트',
        type: 'text',
        x: Math.max(0, snapValue(pt.x)),
        y: Math.max(0, snapValue(pt.y)),
        width: DEFAULT_TEXT_BOX_WIDTH,
        height: DEFAULT_TEXT_BOX_HEIGHT,
        rotation: 0,
        opacity: 1,
        text: '',
        fontFamily: 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
        fontSize: DEFAULT_TEXT_FONT_SIZE,
        color: primaryColor,
        bold: false,
        italic: false,
        underline: false,
        align: 'left',
      };
      onAddElement(newTextElem);
      beginTextEdit(newTextElem);
      return;
    }

    // Select Tool on empty canvas: Start marquee selection box
    // Skip while picture-crop is active — crop overlay owns interaction.
    if (currentTool === 'select' && !isTransforming && !croppingImageId) {
      if (!e.shiftKey) {
        onSelectElement(null);
      }
      setIsMarqueeSelecting(true);
      setDrawStart(pt);
      setMarqueeRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
    }
  };

  // Erase elements intersecting with point
  const eraseAtPoint = (pt: Point) => {
    const radius = Math.max(strokeWidth * 2, 16);
    const toDelete = elements.filter((el) => {
      if (el.layerId !== activeLayer.id) return false;
      return (
        pt.x >= el.x - radius &&
        pt.x <= el.x + el.width + radius &&
        pt.y >= el.y - radius &&
        pt.y <= el.y + el.height + radius
      );
    });

    if (toDelete.length > 0) {
      toDelete.forEach((el) => onDeleteElement(el.id));
    }
  };

  // Element MouseDown (for immediate 1-click selection and drag)
  const handleElementMouseDown = (el: CanvasElement, e: React.MouseEvent) => {
    // If a drawing or pan tool is active, do NOT stop propagation!
    // This allows mouse down to reach the canvas stage so drawing on top of images/shapes starts seamlessly!
    if (
      currentTool === 'shape' ||
      currentTool === 'brush' ||
      currentTool === 'highlighter' ||
      currentTool === 'text' ||
      currentTool === 'crop' ||
      currentTool === 'pan' ||
      croppingImageId
    ) {
      return;
    }

    e.stopPropagation();

    // In non-select modes, let the stage handle it (e.g., eyedropper, eraser, fill)
    if (currentTool === 'eyedropper') {
      const pt = clientToCanvas(e.clientX, e.clientY);
      sampleColorFromCanvas(layers, elements, config, pt.x, pt.y).then((color) => {
        onPrimaryColorChange(color);
      });
      return;
    }

    if (currentTool === 'fill') {
      if (el.type === 'shape') {
        onUpdateElement({
          ...el,
          fill: primaryColor,
        });
      }
      return;
    }

    if (currentTool === 'eraser') {
      onDeleteElement(el.id);
      return;
    }

    if (currentTool !== 'select') return;

    if (e.shiftKey) {
      // Toggle element selection with Shift key
      // If element belongs to a group, toggle the entire group
      if (el.groupId) {
        const groupElements = elements.filter((e) => e.groupId === el.groupId);
        const allSelected = groupElements.every((e) => selectedElementIds.includes(e.id));
        if (allSelected) {
          onSelectMultipleElements(selectedElementIds.filter((id) => !groupElements.some((g) => g.id === id)));
        } else {
          onSelectMultipleElements([...selectedElementIds, ...groupElements.map((g) => g.id)]);
        }
      } else {
        onToggleSelectElement(el.id, true);
      }
      return;
    }

    // Clicking an unselected shape: select only that one (clear previous selection).
    // Clicking an already-selected shape: keep multi-selection for group drag.
    const alreadySelected = selectedElementIds.includes(el.id);
    if (!alreadySelected) {
      // If the element belongs to a group, select all elements in that group
      if (el.groupId) {
        const groupElements = elements.filter((e) => e.groupId === el.groupId);
        onSelectMultipleElements(groupElements.map((e) => e.id));
      } else {
        onSelectElement(el.id);
      }
    }

    // Start moving the selected element(s)
    if (!activeLayer.locked) {
      setIsTransforming(true);
      setActiveHandle('move');
      transformDirtyRef.current = false;
      const idsToMove = alreadySelected ? selectedElementIds : [el.id];
      const startPositions = elements
        .filter((item) => idsToMove.includes(item.id))
        .map((item) => ({ id: item.id, x: item.x, y: item.y }));

      setTransformStart({
        clientX: e.clientX,
        clientY: e.clientY,
        elemX: el.x,
        elemY: el.y,
        elemW: el.width,
        elemH: el.height,
        elemRotation: el.rotation || 0,
        elementsStartPositions: startPositions,
      });
    }
  };

  // Element Double Click: image → crop, text → inline edit, polyline draft → finish
  const handleElementDoubleClick = (el: CanvasElement) => {
    if (polylineDraft) {
      finishPolylineDraft();
      return;
    }
    if (el.type === 'image' && onStartCropImage) {
      onStartCropImage(el.id);
    } else if (el.type === 'text') {
      beginTextEdit(el);
    }
  };

  // Image Crop Handle Mouse Down
  const handleCropHandleMouseDown = (
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move',
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setImgCropActiveHandle(handle);
    setImgCropDragStart({
      clientX: e.clientX,
      clientY: e.clientY,
      initialBox: { ...imgCropBox },
    });
  };

  // Set Crop Aspect Ratio Preset
  const setCropAspectRatio = (ratioW: number, ratioH: number, img: ImageElement) => {
    const maxW = img.width;
    const maxH = img.height;
    let targetW = imgCropBox.w;
    let targetH = targetW * (ratioH / ratioW);
    if (targetH > maxH) {
      targetH = maxH;
      targetW = targetH * (ratioW / ratioH);
    }
    const newX = Math.max(0, Math.min(maxW - targetW, imgCropBox.x));
    const newY = Math.max(0, Math.min(maxH - targetH, imgCropBox.y));
    setImgCropBox({ x: Math.round(newX), y: Math.round(newY), w: Math.round(targetW), h: Math.round(targetH) });
  };

  // Apply Image Crop
  const handleApplyImageCrop = useCallback(
    (imgElem: ImageElement, crop: { x: number; y: number; w: number; h: number }) => {
      if (crop.w < 10 || crop.h < 10) return;
      const naturalW = imgElem.naturalWidth || imgElem.width;
      const naturalH = imgElem.naturalHeight || imgElem.height;
      const scaleX = naturalW / imgElem.width;
      const scaleY = naturalH / imgElem.height;

      const sx = Math.max(0, crop.x * scaleX);
      const sy = Math.max(0, crop.y * scaleY);
      const sw = Math.min(naturalW - sx, crop.w * scaleX);
      const sh = Math.min(naturalH - sy, crop.h * scaleY);

      if (sw < 1 || sh < 1) return;

      const offCanvas = document.createElement('canvas');
      offCanvas.width = Math.round(sw);
      offCanvas.height = Math.round(sh);
      const ctx = offCanvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const croppedSrc = offCanvas.toDataURL('image/png');
        onUpdateElement({
          ...imgElem,
          src: croppedSrc,
          x: Math.round(imgElem.x + crop.x),
          y: Math.round(imgElem.y + crop.y),
          width: Math.round(crop.w),
          height: Math.round(crop.h),
          naturalWidth: Math.round(sw),
          naturalHeight: Math.round(sh),
        });
        onFinishCropImage?.();
      };
      img.src = imgElem.src;
    },
    [onUpdateElement, onFinishCropImage]
  );

  // Keyboard shortcuts for Image Crop (Enter to apply, Ctrl+X to cut slice, Ctrl+C to copy slice, Esc to cancel)
  useEffect(() => {
    if (!croppingImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cut: Ctrl+X
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        e.stopPropagation();
        onCutImagePart?.(croppingImage, imgCropBox);
        return;
      }
      // Copy: Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        e.stopPropagation();
        onCopyImagePart?.(croppingImage, imgCropBox);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApplyImageCrop(croppingImage, imgCropBox);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onFinishCropImage?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    croppingImage,
    imgCropBox,
    handleApplyImageCrop,
    onCutImagePart,
    onCopyImagePart,
    onFinishCropImage,
  ]);

  // MOUSE MOVE
  const handleMouseMove = (e: React.MouseEvent) => {
    const pt = clientToCanvas(e.clientX, e.clientY);
    setCursorPos(pt);
    onMouseMoveCanvas?.(pt);

    // Continuous polyline rubber-band cursor
    if (currentTool === 'shape' && selectedShapeType === 'polyline' && polylineDraft) {
      let cursor = config.snapToGrid ? { x: snapValue(pt.x), y: snapValue(pt.y) } : pt;
      if (e.shiftKey && polylineDraft.length > 0) {
        cursor = snapPolylineAngle(polylineDraft[polylineDraft.length - 1], cursor);
      }
      setPolylineCursor(cursor);
      return;
    }

    // Arc rubber-band: end point or bend (radius) preview
    if (currentTool === 'shape' && selectedShapeType === 'arc' && arcDraft) {
      let cursor = config.snapToGrid ? { x: snapValue(pt.x), y: snapValue(pt.y) } : pt;
      if (!arcDraft.end && e.shiftKey) {
        cursor = snapPolylineAngle(arcDraft.start, cursor);
      }
      if (arcDraft.end) {
        arcBendRef.current = cursor;
        setArcBend(cursor);
      } else {
        setArcBend(cursor);
      }
      return;
    }

    // Radial Tool: the radius follows the cursor while it is not locked
    if (currentTool === 'radial') {
      const center = radialToolState?.center;
      if (radialToolState?.step === 'adjusting_radius' && center) {
        const dx = pt.x - center.x;
        const dy = pt.y - center.y;
        const newRadius = Math.max(1, Math.hypot(dx, dy));
        const newAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        onRadialUpdateRadius?.(newRadius, newAngle);
      }
      return;
    }

    // Panning canvas
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    // Active marquee selection drag
    if (isMarqueeSelecting) {
      const x = Math.min(drawStart.x, pt.x);
      const y = Math.min(drawStart.y, pt.y);
      const w = Math.abs(pt.x - drawStart.x);
      const h = Math.abs(pt.y - drawStart.y);
      setMarqueeRect({ x, y, w, h });
      return;
    }

    // Active brush / highlighter
    if (isDrawing && (currentTool === 'brush' || currentTool === 'highlighter')) {
      setCurrentPoints((prev) => [...prev, pt]);
      return;
    }

    // Active eraser
    if (isDrawing && currentTool === 'eraser') {
      eraseAtPoint(pt);
      return;
    }

    // Active line preview drag
    if (
      isDrawing &&
      currentTool === 'shape' &&
      (selectedShapeType === 'line' || selectedShapeType.startsWith('line-arrow'))
    ) {
      let targetPt = config.snapToGrid ? { x: snapValue(pt.x), y: snapValue(pt.y) } : pt;
      if (e.shiftKey) {
        // Snap line angle to 15 degree increments (PowerPoint-style)
        targetPt = getConstrainedPoint(drawStart.x, drawStart.y, targetPt.x, targetPt.y);
      }
      setLinePreviewEnd(targetPt);
      return;
    }

    // Active non-line shape preview drag
    if (isDrawing && currentTool === 'shape') {
      let x = Math.min(drawStart.x, pt.x);
      let y = Math.min(drawStart.y, pt.y);
      let w = Math.abs(pt.x - drawStart.x);
      let h = Math.abs(pt.y - drawStart.y);

      // Shift key constrains to 1:1 square/circle
      if (e.shiftKey) {
        const side = Math.max(w, h);
        w = side;
        h = side;
        if (pt.x < drawStart.x) x = drawStart.x - side;
        if (pt.y < drawStart.y) y = drawStart.y - side;
      }

      setPreviewRect({ x, y, w, h });
      return;
    }

    // Active crop box
    if (isDrawing && currentTool === 'crop') {
      const x = Math.min(drawStart.x, pt.x);
      const y = Math.min(drawStart.y, pt.y);
      const w = Math.abs(pt.x - drawStart.x);
      const h = Math.abs(pt.y - drawStart.y);
      setCropBox({ x, y, w, h });
      return;
    }

    // Active Image Crop dragging (Crop handles or moving crop window)
    if (imgCropActiveHandle && imgCropDragStart && croppingImage) {
      const dx = (e.clientX - imgCropDragStart.clientX) / zoom;
      const dy = (e.clientY - imgCropDragStart.clientY) / zoom;
      const init = imgCropDragStart.initialBox;
      const maxW = croppingImage.width;
      const maxH = croppingImage.height;

      let nextX = init.x;
      let nextY = init.y;
      let nextW = init.w;
      let nextH = init.h;

      if (imgCropActiveHandle === 'move') {
        nextX = Math.max(0, Math.min(maxW - init.w, init.x + dx));
        nextY = Math.max(0, Math.min(maxH - init.h, init.y + dy));
      } else {
        if (imgCropActiveHandle.includes('w')) {
          const candidateX = Math.max(0, Math.min(init.x + init.w - 20, init.x + dx));
          nextW = init.w - (candidateX - init.x);
          nextX = candidateX;
        }
        if (imgCropActiveHandle.includes('e')) {
          nextW = Math.max(20, Math.min(maxW - init.x, init.w + dx));
        }
        if (imgCropActiveHandle.includes('n')) {
          const candidateY = Math.max(0, Math.min(init.y + init.h - 20, init.y + dy));
          nextH = init.h - (candidateY - init.y);
          nextY = candidateY;
        }
        if (imgCropActiveHandle.includes('s')) {
          nextH = Math.max(20, Math.min(maxH - init.y, init.h + dy));
        }
      }

      setImgCropBox({
        x: Math.round(nextX),
        y: Math.round(nextY),
        w: Math.round(nextW),
        h: Math.round(nextH),
      });
      return;
    }

    // Active element transform (Move / Resize / Rotate / Line Endpoints)
    if (isTransforming && transformStart && selectedElement) {
      const dx = (e.clientX - transformStart.clientX) / zoom;
      const dy = (e.clientY - transformStart.clientY) / zoom;
      const liveOpts = { skipHistory: true } as const;
      transformDirtyRef.current = true;

      // Specialized Line Start Point handle drag - PowerPoint style
      if (activeHandle === 'line-start' && transformStart.lineEnd) {
        const fixedEnd = transformStart.lineEnd;
        let curPt = pt;
        if (config.snapToGrid) {
          curPt = { x: snapValue(curPt.x), y: snapValue(curPt.y) };
        }
        if (e.shiftKey) {
          // PowerPoint-style 15-degree snap
          curPt = getConstrainedPoint(fixedEnd.x, fixedEnd.y, curPt.x, curPt.y);
        }
        
        // For PowerPoint-style arrows with points, update points directly
        if (selectedElement.points && selectedElement.points.length >= 2) {
          const deltaX = fixedEnd.x - curPt.x;
          const deltaY = fixedEnd.y - curPt.y;
          const len = Math.hypot(deltaX, deltaY);
          const deg = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
          const thickness = selectedElement.height;
          
          onUpdateElement({
            ...selectedElement,
            x: Math.round(curPt.x),
            y: Math.round(curPt.y - thickness / 2),
            width: Math.max(5, Math.round(len)),
            rotation: Math.round(deg),
            points: [
              { x: 0, y: thickness / 2 },
              { x: Math.round(len), y: thickness / 2 }
            ],
          }, liveOpts);
        } else {
          // Legacy width-based
          const deltaX = fixedEnd.x - curPt.x;
          const deltaY = fixedEnd.y - curPt.y;
          const len = Math.hypot(deltaX, deltaY);
          const deg = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
          const thickness = selectedElement.height;
          onUpdateElement({
            ...selectedElement,
            x: Math.round(curPt.x),
            y: Math.round(curPt.y - thickness / 2),
            width: Math.max(5, Math.round(len)),
            rotation: Math.round(deg),
          }, liveOpts);
        }
        return;
      }

      // Specialized Line End Point handle drag - PowerPoint style
      if (activeHandle === 'line-end' && transformStart.lineStart) {
        const fixedStart = transformStart.lineStart;
        let curPt = pt;
        if (config.snapToGrid) {
          curPt = { x: snapValue(curPt.x), y: snapValue(curPt.y) };
        }
        if (e.shiftKey) {
          // PowerPoint-style 15-degree snap
          curPt = getConstrainedPoint(fixedStart.x, fixedStart.y, curPt.x, curPt.y);
        }
        
        // For PowerPoint-style arrows with points, update points directly
        if (selectedElement.points && selectedElement.points.length >= 2) {
          const deltaX = curPt.x - fixedStart.x;
          const deltaY = curPt.y - fixedStart.y;
          const len = Math.hypot(deltaX, deltaY);
          const deg = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
          const thickness = selectedElement.height;
          
          onUpdateElement({
            ...selectedElement,
            width: Math.max(5, Math.round(len)),
            rotation: Math.round(deg),
            points: [
              { x: 0, y: thickness / 2 },
              { x: Math.round(len), y: thickness / 2 }
            ],
          }, liveOpts);
        } else {
          // Legacy width-based
          const deltaX = curPt.x - fixedStart.x;
          const deltaY = curPt.y - fixedStart.y;
          const len = Math.hypot(deltaX, deltaY);
          const deg = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
          onUpdateElement({
            ...selectedElement,
            width: Math.max(5, Math.round(len)),
            rotation: Math.round(deg),
          }, liveOpts);
        }
        return;
      }

      if (activeHandle === 'move') {
        // Shift: constrain to horizontal or vertical axis only (straight-line move)
        let moveDx = dx;
        let moveDy = dy;
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            moveDy = 0;
          } else {
            moveDx = 0;
          }
        }

        // Group move: apply all position updates in one batch (avoids stale-state overwrite)
        if (transformStart.elementsStartPositions && transformStart.elementsStartPositions.length > 1) {
          // Snap shared delta once so relative layout stays intact
          let groupDx = moveDx;
          let groupDy = moveDy;
          if (config.snapToGrid) {
            const first = transformStart.elementsStartPositions[0];
            groupDx = snapValue(first.x + moveDx) - first.x;
            groupDy = snapValue(first.y + moveDy) - first.y;
          }
          const updates: CanvasElement[] = [];
          transformStart.elementsStartPositions.forEach((pos) => {
            const el = elements.find((item) => item.id === pos.id);
            if (!el) return;
            updates.push({ ...el, x: pos.x + groupDx, y: pos.y + groupDy });
          });
          if (updates.length > 0) {
            if (onUpdateElements) {
              onUpdateElements(updates, liveOpts);
            } else {
              updates.forEach((u) => onUpdateElement(u, liveOpts));
            }
          }
        } else {
          // Single move
          let newX = transformStart.elemX + moveDx;
          let newY = transformStart.elemY + moveDy;
          if (config.snapToGrid) {
            newX = snapValue(newX);
            newY = snapValue(newY);
          }
          onUpdateElement({
            ...selectedElement,
            x: newX,
            y: newY,
          }, liveOpts);
        }
      } else if (activeHandle === 'rotate') {
        // Calculate angle between center and current mouse
        const cx = transformStart.elemX + transformStart.elemW / 2;
        const cy = transformStart.elemY + transformStart.elemH / 2;
        const rad = Math.atan2(pt.y - cy, pt.x - cx);
        let deg = Math.round((rad * 180) / Math.PI) + 90;
        if (deg < 0) deg += 360;
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }
        onUpdateElement({
          ...selectedElement,
          rotation: deg % 360,
        }, liveOpts);
      } else if (activeHandle) {
        // 8-point resize logic
        let { elemX: newX, elemY: newY, elemW: newW, elemH: newH } = transformStart;

        if (activeHandle.includes('e')) newW = Math.max(10, transformStart.elemW + dx);
        if (activeHandle.includes('s')) newH = Math.max(10, transformStart.elemH + dy);
        if (activeHandle.includes('w')) {
          const possibleW = transformStart.elemW - dx;
          if (possibleW > 10) {
            newW = possibleW;
            newX = transformStart.elemX + dx;
          }
        }
        if (activeHandle.includes('n')) {
          const possibleH = transformStart.elemH - dy;
          if (possibleH > 10) {
            newH = possibleH;
            newY = transformStart.elemY + dy;
          }
        }

        // Shift or image lockAspectRatio keeps proportional size
        const lockAspect =
          e.shiftKey ||
          (selectedElement.type === 'image' &&
            !!(selectedElement as ImageElement).lockAspectRatio);
        if (lockAspect && transformStart.elemH > 0) {
          const ratio = transformStart.elemW / transformStart.elemH;
          if (activeHandle === 'e' || activeHandle === 'w') {
            newH = Math.max(10, newW / ratio);
          } else if (activeHandle === 'n' || activeHandle === 's') {
            newW = Math.max(10, newH * ratio);
          } else if (
            activeHandle === 'se' ||
            activeHandle === 'ne' ||
            activeHandle === 'sw' ||
            activeHandle === 'nw'
          ) {
            const dw = Math.abs(newW - transformStart.elemW);
            const dh = Math.abs(newH - transformStart.elemH);
            if (dw >= dh) {
              newH = Math.max(10, newW / ratio);
            } else {
              newW = Math.max(10, newH * ratio);
            }
            if (activeHandle.includes('w')) {
              newX = transformStart.elemX + transformStart.elemW - newW;
            }
            if (activeHandle.includes('n')) {
              newY = transformStart.elemY + transformStart.elemH - newH;
            }
          }
        }

        if (config.snapToGrid) {
          newX = snapValue(newX);
          newY = snapValue(newY);
          newW = snapValue(newW);
          newH = snapValue(newH);
        }

        onUpdateElement({
          ...selectedElement,
          x: newX,
          y: newY,
          width: Math.max(10, newW),
          height: Math.max(10, newH),
          ...(transformStart.pointsStart
            ? {
                points: transformStart.pointsStart.map((p) => ({
                  x: (p.x / Math.max(transformStart.elemW, 1)) * Math.max(10, newW),
                  y: (p.y / Math.max(transformStart.elemH, 1)) * Math.max(10, newH),
                })),
              }
            : {}),
          ...(transformStart.arcRadiusStart != null
            ? {
                arcRadius:
                  transformStart.arcRadiusStart *
                  Math.max(
                    Math.max(10, newW) / Math.max(transformStart.elemW, 1),
                    Math.max(10, newH) / Math.max(transformStart.elemH, 1)
                  ),
              }
            : {}),
        }, liveOpts);
      }
    }
  };

  // MOUSE UP
  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }

    // Finish marquee selection
    if (isMarqueeSelecting && marqueeRect) {
      if (marqueeRect.w > 4 && marqueeRect.h > 4) {
        const hitIds: string[] = [];
        elements.forEach((el) => {
          if (el.visible === false) return;
          // Only select elements fully inside the marquee (partial overlap excluded)
          const elRight = el.x + el.width;
          const elBottom = el.y + el.height;
          const mqRight = marqueeRect.x + marqueeRect.w;
          const mqBottom = marqueeRect.y + marqueeRect.h;

          const fullyInside =
            el.x >= marqueeRect.x &&
            elRight <= mqRight &&
            el.y >= marqueeRect.y &&
            elBottom <= mqBottom;

          if (fullyInside) {
            hitIds.push(el.id);
          }
        });

        onSelectMultipleElements(hitIds);
      }
      setIsMarqueeSelecting(false);
      setMarqueeRect(null);
    }

    // Finish brush stroke
    if (isDrawing && (currentTool === 'brush' || currentTool === 'highlighter')) {
      if (currentPoints.length > 1) {
        const minX = Math.min(...currentPoints.map((p) => p.x));
        const minY = Math.min(...currentPoints.map((p) => p.y));
        const maxX = Math.max(...currentPoints.map((p) => p.x));
        const maxY = Math.max(...currentPoints.map((p) => p.y));

        const isHigh = currentTool === 'highlighter';
        const newStroke: BrushStrokeElement = {
          id: 'brush-' + Date.now(),
          layerId: activeLayer.id,
          name: isHigh ? '형광펜 획' : '브러시 획',
          type: 'brush',
          x: minX,
          y: minY,
          width: Math.max(maxX - minX, 10),
          height: Math.max(maxY - minY, 10),
          rotation: 0,
          opacity: isHigh ? 0.45 : 1,
          points: currentPoints,
          color: primaryColor,
          strokeWidth: isHigh ? Math.max(strokeWidth * 3, 16) : strokeWidth,
          isHighlighter: isHigh,
        };
        onAddElement(newStroke);
      }
      setCurrentPoints([]);
      setIsDrawing(false);
    }

    // Finish LINE Shape creation (Direct Start Point to End Point) - PowerPoint style
    if (
      isDrawing &&
      currentTool === 'shape' &&
      (selectedShapeType === 'line' || selectedShapeType.startsWith('line-arrow'))
    ) {
      let endPt = linePreviewEnd || drawStart;
      let startX = drawStart.x;
      let startY = drawStart.y;
      let endX = endPt.x;
      let endY = endPt.y;

      if (config.snapToGrid) {
        startX = snapValue(startX);
        startY = snapValue(startY);
        endX = snapValue(endX);
        endY = snapValue(endY);
      }

      const dx = endX - startX;
      const dy = endY - startY;
      const length = Math.hypot(dx, dy);

      // Create line if length is at least 4px (or default horizontal line if just clicked)
      const finalLength = length >= 4 ? length : 140;
      const deg = length >= 4 ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
      const strokeW = (lastShapeStyle.strokeWidth && lastShapeStyle.strokeWidth > 0) ? lastShapeStyle.strokeWidth : (strokeWidth || 2);
      const thickness = Math.max(strokeW * 4, 16);
      const lineStroke = (lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none') ? lastShapeStyle.stroke : (primaryColor || '#000000');

      // Map shapeType to PowerPoint-style arrow configuration
      let beginArrow: ArrowConfig = { type: 'none', size: 'medium' };
      let endArrow: ArrowConfig = { type: 'none', size: 'medium' };
      
      if (selectedShapeType.startsWith('line-arrow')) {
        if (selectedShapeType === 'line-arrow') {
          endArrow = { type: 'triangle', size: 'medium' };
        } else if (selectedShapeType === 'line-arrow-both') {
          beginArrow = { type: 'triangle', size: 'medium' };
          endArrow = { type: 'triangle', size: 'medium' };
        } else if (selectedShapeType === 'line-arrow-start') {
          beginArrow = { type: 'triangle', size: 'medium' };
        } else if (selectedShapeType === 'line-arrow-open') {
          endArrow = { type: 'open', size: 'medium' };
        } else if (selectedShapeType === 'line-arrow-dot') {
          endArrow = { type: 'oval', size: 'medium' };
        } else if (selectedShapeType === 'line-arrow-diamond') {
          endArrow = { type: 'diamond', size: 'medium' };
        }
      }

      const arrowNameMap: Record<string, string> = {
        'line-arrow': '끝 화살표',
        'line-arrow-both': '양끝 화살표',
        'line-arrow-start': '시작 화살표',
        'line-arrow-open': '열린 화살표',
        'line-arrow-dot': '끝 점 화살표',
        'line-arrow-diamond': '마름모 화살표',
      };
      
      const newLineShape: ShapeElement = {
        id: 'shape-line-' + Date.now(),
        layerId: activeLayer.id,
        name: arrowNameMap[selectedShapeType] || (selectedShapeType === 'line' ? '직선' : '화살표 선'),
        type: 'shape',
        shapeType: selectedShapeType,
        x: Math.round(startX),
        y: Math.round(startY - thickness / 2),
        width: Math.max(5, Math.round(finalLength)),
        height: thickness,
        rotation: Math.round(deg),
        opacity: lastShapeStyle.opacity ?? 1,
        fill: 'none',
        stroke: lineStroke,
        strokeWidth: strokeW,
        strokeDash: lastShapeStyle.strokeDash || 'solid',
        shadow: lastShapeStyle.shadow,
        lineCap: 'round',
        beginArrow,
        endArrow,
        // Store actual endpoints in points for PowerPoint-style behavior
        points: [
          { x: 0, y: thickness / 2 },
          { x: Math.round(finalLength), y: thickness / 2 }
        ],
      };

      onAddElement(newLineShape);
      onSelectElement(newLineShape.id);
      // NOTE: Do NOT automatically switch to 'select' mode! Allow continuous drawing.
      setLinePreviewEnd(null);
      setIsDrawing(false);
    }

    // Finish Regular Shape creation (Inheriting lastShapeStyle for persistent styles)
    if (
      isDrawing &&
      currentTool === 'shape' &&
      previewRect &&
      selectedShapeType !== 'line' &&
      !selectedShapeType.startsWith('line-arrow') &&
      selectedShapeType !== 'polyline' &&
      selectedShapeType !== 'arc'
    ) {
      if (previewRect.w >= 5 && previewRect.h >= 5) {
        const newShape: ShapeElement = {
          id: 'shape-' + Date.now(),
          layerId: activeLayer.id,
          name: getShapeKoreanName(selectedShapeType),
          type: 'shape',
          shapeType: selectedShapeType,
          x: config.snapToGrid ? snapValue(previewRect.x) : previewRect.x,
          y: config.snapToGrid ? snapValue(previewRect.y) : previewRect.y,
          width: config.snapToGrid ? snapValue(previewRect.w) : previewRect.w,
          height: config.snapToGrid ? snapValue(previewRect.h) : previewRect.h,
          rotation: 0,
          opacity: lastShapeStyle.opacity ?? 1,
          fill:
            lastShapeStyle.fill === 'none' || lastShapeStyle.fill
              ? lastShapeStyle.fill || 'none'
              : 'none',
          gradient: lastShapeStyle.gradient?.enabled ? lastShapeStyle.gradient : undefined,
          stroke:
            lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none'
              ? lastShapeStyle.stroke
              : primaryColor || '#FF0000',
          strokeWidth: lastShapeStyle.strokeWidth ?? (strokeWidth > 0 ? strokeWidth : 2),
          strokeDash: lastShapeStyle.strokeDash || 'solid',
          cornerRadius: lastShapeStyle.cornerRadius ?? 16,
          shadow: lastShapeStyle.shadow,
        };
        onAddElement(newShape);
        onSelectElement(newShape.id);
        // NOTE: Keep tool in 'shape' mode to allow drawing multiple shapes sequentially!
      }
      setPreviewRect(null);
      setIsDrawing(false);
    }

    // Finish crop drag
    if (isDrawing && currentTool === 'crop') {
      setIsDrawing(false);
    }

    // Finish element transform — one undo step for the whole drag
    if (isTransforming) {
      if (transformDirtyRef.current) {
        onCommitHistory?.();
        transformDirtyRef.current = false;
      }
      setIsTransforming(false);
      setActiveHandle(null);
      setTransformStart(null);
    }

    // Finish active image crop handle dragging
    if (imgCropActiveHandle) {
      setImgCropActiveHandle(null);
      setImgCropDragStart(null);
    }
  };

  const getShapeKoreanName = (type: ShapeType): string => {
    switch (type) {
      case 'rect': return '직사각형';
      case 'rounded-rect': return '둥근 모서리 사각형';
      case 'ellipse': return '원 / 타원';
      case 'triangle': return '삼각형';
      case 'diamond': return '다이아몬드';
      case 'star': return '오각별';
      case 'arrow-right': return '오른쪽 화살표';
      case 'arrow-bidirectional': return '양방향 화살표';
      case 'speech-bubble': return '말풍선';
      case 'heart': return '하트';
      case 'hexagon': return '육각형';
      case 'line': return '직선';
      case 'line-arrow': return '화살표 선';
      case 'polyline': return '연속 선';
      case 'arc': return '아크';
    }
  };

  // Synchronize canvas-tool crop box with parent. Picture-crop owns the box while it is active.
  useEffect(() => {
    if (croppingImageId) return;
    if (currentTool === 'crop' && cropBox && cropBox.w >= 5 && cropBox.h >= 5) {
      onCropBoxChangeRef.current?.(cropBox);
    } else if (currentTool !== 'crop') {
      onCropBoxChangeRef.current?.(null);
    }
  }, [cropBox, currentTool, croppingImageId]);

  // Reset cropBox when switching away from crop tool
  useEffect(() => {
    if (currentTool !== 'crop' && cropBox) {
      setCropBox(null);
    }
  }, [currentTool, cropBox]);

  // Flash state when capture copy/cut succeeds
  const [isCropFlashing, setIsCropFlashing] = useState(false);

  // Cut Canvas Crop Region (Ctrl+X)
  const handleCutCrop = useCallback(async () => {
    if (!cropBox || cropBox.w < 5 || cropBox.h < 5) return;
    setIsCropFlashing(true);
    setTimeout(() => setIsCropFlashing(false), 300);

    if (onCutCanvasRegion) {
      await onCutCanvasRegion(cropBox);
      setCropBox(null);
    }
  }, [cropBox, onCutCanvasRegion]);

  // Copy Canvas Crop Region (Ctrl+C)
  const handleCopyCrop = useCallback(async () => {
    if (!cropBox || cropBox.w < 5 || cropBox.h < 5) return;
    setIsCropFlashing(true);
    setTimeout(() => setIsCropFlashing(false), 300);

    if (onCopyCanvasRegion) {
      await onCopyCanvasRegion(cropBox);
    }
  }, [cropBox, onCopyCanvasRegion]);

  // Apply Crop (Canvas Resize)
  const applyCrop = useCallback(() => {
    if (!cropBox || cropBox.w < 20 || cropBox.h < 20) {
      setCropBox(null);
      return;
    }
    if (onCropCanvas) {
      onCropCanvas(cropBox);
    } else {
      onUpdateConfig({
        width: Math.round(cropBox.w),
        height: Math.round(cropBox.h),
      });
      elements.forEach((el) => {
        onUpdateElement({
          ...el,
          x: el.x - cropBox.x,
          y: el.y - cropBox.y,
        });
      });
    }
    setCropBox(null);
  }, [cropBox, onCropCanvas, onUpdateConfig, elements, onUpdateElement]);

  /* ---------------------------------------------------------------------- */
  /* Auto Crop (Trim)                                                       */
  /* ---------------------------------------------------------------------- */

  // 크롭 박스를 목표 사각형까지 부드럽게 이동 (ease-out cubic)
  const animateRectTo = useCallback(
    (from: CropRect, to: CropRect, onUpdate: (rect: CropRect) => void, duration = 220) => {
      if (cropAnimRef.current !== null) cancelAnimationFrame(cropAnimRef.current);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        if (t >= 1) {
          onUpdate(to);
          cropAnimRef.current = null;
          return;
        }
        onUpdate({
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          w: from.w + (to.w - from.w) * e,
          h: from.h + (to.h - from.h) * e,
        });
        cropAnimRef.current = requestAnimationFrame(step);
      };
      cropAnimRef.current = requestAnimationFrame(step);
    },
    []
  );

  useEffect(
    () => () => {
      if (cropAnimRef.current !== null) cancelAnimationFrame(cropAnimRef.current);
    },
    []
  );

  // 알림 자동 해제
  useEffect(() => {
    if (!autoCropNotice) return;
    const t = setTimeout(() => setAutoCropNotice(null), 3600);
    return () => clearTimeout(t);
  }, [autoCropNotice]);

  // 이미지 요소의 실제 픽셀에서 여백을 찾아 크롭 박스를 맞춘다.
  const handleAutoCropImage = useCallback(async () => {
    if (!croppingImage || isAutoCropping) return;
    setIsAutoCropping(true);
    setAutoCropNotice(null);
    try {
      const result = await autoCropImageElement(croppingImage, {
        tolerance: 12,
        alphaThreshold: 8,
        mode: 'auto',
      });

      if (!result.ok || !result.rect) {
        // 실패 시 기존 크롭 범위를 그대로 유지한다.
        setAutoCropNotice(trimFailureMessage(result.reason));
        return;
      }

      const target = padRect(
        result.rect,
        autoCropPadding,
        { w: croppingImage.width, h: croppingImage.height }
      );

      if (target.w < 4 || target.h < 4) {
        setAutoCropNotice('자동 자르기: 결과 영역이 너무 작아 기존 범위를 유지합니다.');
        return;
      }

      animateRectTo(imgCropBox, target, setImgCropBox);
      setAutoCropNotice(
        result.fullFrame
          ? '자동 자르기: 잘라낼 여백이 없습니다.'
          : `자동 자르기: ${Math.round(target.w)} × ${Math.round(target.h)} px`
      );
    } catch {
      setAutoCropNotice(trimFailureMessage('error'));
    } finally {
      setIsAutoCropping(false);
    }
  }, [croppingImage, isAutoCropping, autoCropPadding, imgCropBox, animateRectTo]);

  // 캔버스 전체(합성 결과)에서 여백을 찾아 크롭 박스를 맞춘다.
  const handleAutoCropCanvas = useCallback(async () => {
    if (isAutoCropping) return;
    setIsAutoCropping(true);
    setAutoCropNotice(null);
    try {
      const result = await autoCropCanvas(layers, elements, config, {
        tolerance: 12,
        alphaThreshold: 8,
      });

      if (!result.ok || !result.rect) {
        setAutoCropNotice(trimFailureMessage(result.reason));
        return;
      }

      const target = padRect(result.rect, autoCropPadding, {
        w: config.width,
        h: config.height,
      });

      if (target.w < 20 || target.h < 20) {
        setAutoCropNotice('자동 자르기: 결과 영역이 너무 작아 기존 범위를 유지합니다.');
        return;
      }

      // 크롭 박스가 없으면 캔버스 전체에서 줄어드는 애니메이션으로 시작
      const from = cropBox ?? { x: 0, y: 0, w: config.width, h: config.height };
      animateRectTo(from, target, setCropBox);
      setAutoCropNotice(
        result.fullFrame
          ? '자동 자르기: 잘라낼 여백이 없습니다.'
          : `자동 자르기: ${Math.round(target.w)} × ${Math.round(target.h)} px`
      );
    } catch {
      setAutoCropNotice(trimFailureMessage('error'));
    } finally {
      setIsAutoCropping(false);
    }
  }, [
    isAutoCropping,
    layers,
    elements,
    config,
    autoCropPadding,
    cropBox,
    animateRectTo,
  ]);

  // Keyboard: finish / cancel continuous polyline
  useEffect(() => {
    if (!polylineDraft) return;
    const handlePolyKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishPolylineDraft();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelPolylineDraft();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        setPolylineDraft((prev) => {
          if (!prev || prev.length <= 1) {
            polylineDraftRef.current = null;
            setPolylineCursor(null);
            return null;
          }
          const next = prev.slice(0, -1);
          polylineDraftRef.current = next;
          return next;
        });
      }
    };
    window.addEventListener('keydown', handlePolyKey, true);
    return () => window.removeEventListener('keydown', handlePolyKey, true);
  }, [polylineDraft, finishPolylineDraft, cancelPolylineDraft]);

  // Keyboard: finish / cancel arc
  useEffect(() => {
    if (!arcDraft) return;
    const handleArcKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Enter' && arcDraft.end && arcBendRef.current) {
        e.preventDefault();
        e.stopPropagation();
        finishArcDraft();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelArcDraft();
      }
    };
    window.addEventListener('keydown', handleArcKey, true);
    return () => window.removeEventListener('keydown', handleArcKey, true);
  }, [arcDraft, finishArcDraft, cancelArcDraft]);

  // Keyboard shortcuts for Canvas Crop:
  // Ctrl+X: Cut dragged region
  // Ctrl+C: Copy dragged region
  // Ctrl+V: Paste captured image
  // Enter: Apply canvas resize
  // Esc: Cancel
  useEffect(() => {
    if (currentTool !== 'crop' || !cropBox) return;
    const handleCropKeyDown = (e: KeyboardEvent) => {
      // Cut: Ctrl+X or Cmd+X
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        e.stopPropagation();
        handleCutCrop();
        return;
      }
      // Copy: Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        e.stopPropagation();
        handleCopyCrop();
        return;
      }
      // Paste: Ctrl+V or Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        e.stopPropagation();
        onTriggerPaste?.();
        setCropBox(null);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCrop();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setCropBox(null);
      }
    };
    window.addEventListener('keydown', handleCropKeyDown);
    return () => window.removeEventListener('keydown', handleCropKeyDown);
  }, [currentTool, cropBox, applyCrop, onSelectTool, handleCutCrop, handleCopyCrop, onTriggerPaste]);

  // Start handle transform
  const startTransform = (handle: HandleType | 'move', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedElement || activeLayer.locked) return;
    setIsTransforming(true);
    setActiveHandle(handle);
    transformDirtyRef.current = false;
    const startPositions = selectedElements.map((item) => ({ id: item.id, x: item.x, y: item.y }));

    let lineStart: Point | undefined;
    let lineEnd: Point | undefined;
    if (
      selectedElement.type === 'shape' &&
      (selectedElement.shapeType === 'line' || selectedElement.shapeType.startsWith('line-arrow'))
    ) {
      const sx = selectedElement.x;
      const sy = selectedElement.y + selectedElement.height / 2;
      const rad = ((selectedElement.rotation || 0) * Math.PI) / 180;
      const ex = sx + Math.cos(rad) * selectedElement.width;
      const ey = sy + Math.sin(rad) * selectedElement.width;
      lineStart = { x: sx, y: sy };
      lineEnd = { x: ex, y: ey };
    }

    setTransformStart({
      clientX: e.clientX,
      clientY: e.clientY,
      elemX: selectedElement.x,
      elemY: selectedElement.y,
      elemW: selectedElement.width,
      elemH: selectedElement.height,
      elemRotation: selectedElement.rotation || 0,
      elementsStartPositions: startPositions,
      lineStart,
      lineEnd,
      pointsStart:
        selectedElement.type === 'shape' &&
        (selectedElement.shapeType === 'polyline' || selectedElement.shapeType === 'arc') &&
        selectedElement.points
          ? selectedElement.points.map((p) => ({ ...p }))
          : undefined,
      arcRadiusStart:
        selectedElement.type === 'shape' && selectedElement.shapeType === 'arc'
          ? selectedElement.arcRadius
          : undefined,
    });
  };

  // Calculate Ruler markers
  const rulerStep = zoom > 1.5 ? 50 : zoom < 0.5 ? 200 : 100;
  const hMarkers = [];
  for (let x = 0; x <= config.width; x += rulerStep) {
    hMarkers.push(x);
  }
  const vMarkers = [];
  for (let y = 0; y <= config.height; y += rulerStep) {
    vMarkers.push(y);
  }

  // Active cursor style based on tool and interactions
  const currentCursor = useMemo(() => {
    if (isPanning) return 'grabbing';
    if (currentTool === 'pan') return 'grab';
    return getToolCursor(currentTool);
  }, [currentTool, isPanning]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={(e) => {
        if (currentTool === 'shape' && selectedShapeType === 'polyline' && polylineDraft) {
          e.preventDefault();
          finishPolylineDraft();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && onInsertImage) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];
            if (
              file.type.startsWith('image/') ||
              /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i.test(file.name)
            ) {
              onInsertImage(file);
              break;
            }
          }
        }
      }}
      style={{ cursor: currentCursor }}
      className="flex-1 relative overflow-hidden bg-stone-950 select-none outline-none focus:ring-0"
    >
      {/* Horizontal Top Ruler */}
      {config.showRulers && (
        <div className="absolute top-0 left-6 right-0 h-6 bg-stone-900 border-b border-stone-800 z-10 pointer-events-none overflow-hidden font-mono text-[9px] text-stone-500">
          <div
            style={{
              transform: `translateX(${pan.x}px)`,
              width: `${config.width * zoom}px`,
              height: '100%',
              position: 'relative',
            }}
          >
            {hMarkers.map((m) => (
              <div
                key={m}
                className="absolute top-0 border-l border-stone-700 pl-1"
                style={{ left: `${m * zoom}px`, height: '100%' }}
              >
                {m}
              </div>
            ))}
            {/* Dynamic cursor tick */}
            <div
              className="absolute top-0 bottom-0 w-[1px] bg-amber-500 z-20"
              style={{ left: `${cursorPos.x * zoom}px` }}
            />
          </div>
        </div>
      )}

      {/* Vertical Left Ruler */}
      {config.showRulers && (
        <div className="absolute top-6 left-0 bottom-0 w-6 bg-stone-900 border-r border-stone-800 z-10 pointer-events-none overflow-hidden font-mono text-[9px] text-stone-500">
          <div
            style={{
              transform: `translateY(${pan.y}px)`,
              height: `${config.height * zoom}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {vMarkers.map((m) => (
              <div
                key={m}
                className="absolute left-0 border-t border-stone-700 pt-0.5 pl-0.5"
                style={{ top: `${m * zoom}px`, width: '100%' }}
              >
                {m}
              </div>
            ))}
            {/* Dynamic cursor tick */}
            <div
              className="absolute left-0 right-0 h-[1px] bg-amber-500 z-20"
              style={{ top: `${cursorPos.y * zoom}px` }}
            />
          </div>
        </div>
      )}

      {/* Top Left Ruler Corner */}
      {config.showRulers && (
        <div className="absolute top-0 left-0 w-6 h-6 bg-stone-900 border-r border-b border-stone-800 z-20 flex items-center justify-center font-mono text-[8px] text-stone-600">
          px
        </div>
      )}

      {/* Interactive Transform Viewport */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: config.width,
          height: config.height,
        }}
        className="absolute shadow-2xl transition-transform duration-75 ease-out"
      >
        {/* Canvas Background Paper */}
        <div
          className={`absolute inset-0 rounded-sm shadow-xl ${
            config.backgroundColor === 'transparent'
              ? 'bg-[radial-gradient(#374151_1px,transparent_1px)] [background-size:12px_12px] bg-stone-900/60'
              : ''
          }`}
          style={{
            backgroundColor:
              config.backgroundColor === 'transparent' ? undefined : config.backgroundColor,
          }}
        />

        {/* Grid lines overlay */}
        {config.showGrid && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              <pattern
                id="grid-pattern"
                width={config.gridSize}
                height={config.gridSize}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${config.gridSize} 0 L 0 0 0 ${config.gridSize}`}
                  fill="none"
                  stroke="#A8A29E"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-pattern)" opacity="0.85" />
          </svg>
        )}

        {/* SVG Drawing & Elements Stage */}
        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          viewBox={`0 0 ${config.width} ${config.height}`}
        >
          {/* Shadow, Gradient, and Image ClipPath Filters */}
          <defs>
            {elements.map((el) => {
              const nodes = [];
              if (el.shadow?.enabled) {
                nodes.push(
                  <filter
                    key={`shadow-${el.id}`}
                    id={`shadow-${el.id}`}
                    x="-50%"
                    y="-50%"
                    width="200%"
                    height="200%"
                  >
                    <feDropShadow
                      dx={el.shadow.offsetX}
                      dy={el.shadow.offsetY}
                      stdDeviation={el.shadow.blur / 2}
                      floodColor={el.shadow.color}
                    />
                  </filter>
                );
              }
              if (el.type === 'shape' && el.gradient?.enabled) {
                const grad = el.gradient;
                if (grad.type === 'linear') {
                  const rad = (grad.angle * Math.PI) / 180;
                  const x1 = Math.round(50 - Math.cos(rad) * 50);
                  const y1 = Math.round(50 - Math.sin(rad) * 50);
                  const x2 = Math.round(50 + Math.cos(rad) * 50);
                  const y2 = Math.round(50 + Math.sin(rad) * 50);
                  nodes.push(
                    <linearGradient
                      key={`grad-${el.id}`}
                      id={`grad-${el.id}`}
                      x1={`${x1}%`}
                      y1={`${y1}%`}
                      x2={`${x2}%`}
                      y2={`${y2}%`}
                    >
                      <stop offset="0%" stopColor={grad.startColor} />
                      <stop offset="100%" stopColor={grad.endColor} />
                    </linearGradient>
                  );
                } else {
                  nodes.push(
                    <radialGradient key={`grad-${el.id}`} id={`grad-${el.id}`} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={grad.startColor} />
                      <stop offset="100%" stopColor={grad.endColor} />
                    </radialGradient>
                  );
                }
              }
              if (el.type === 'image' && el.cornerRadius) {
                nodes.push(
                  <clipPath key={`clip-${el.id}`} id={`clip-${el.id}`}>
                    <rect
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      rx={el.cornerRadius}
                      ry={el.cornerRadius}
                    />
                  </clipPath>
                );
              }
              return nodes;
            })}
          </defs>

          {/* Render Elements by Layer */}
          {layers.map((layer) => {
            if (!layer.visible) return null;
            const layerElements = elements.filter(
              (el) => el.layerId === layer.id && el.visible !== false
            );

            return (
              <g key={layer.id} opacity={layer.opacity}>
                {layerElements.map((el) => {
                  const isSelected = selectedElementIds.includes(el.id);
                  const rot = el.rotation || 0;
                  const filterAttr = el.shadow?.enabled ? `url(#shadow-${el.id})` : undefined;
                  const flipT =
                    el.flipH || el.flipV
                      ? `translate(${el.x + el.width / 2} ${el.y + el.height / 2}) scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1}) translate(${-(el.x + el.width / 2)} ${-(el.y + el.height / 2)})`
                      : undefined;

                  return (
                    <g
                      key={el.id}
                      transform={flipT}
                      onMouseDown={(e) => handleElementMouseDown(el, e)}
                      onDoubleClick={() => handleElementDoubleClick(el)}
                      style={{ pointerEvents: isSelectOrElementTool ? 'all' : 'none' }}
                      className={currentTool === 'select' ? 'cursor-pointer' : ''}
                    >
                      {/* SHAPE ELEMENT */}
                      {el.type === 'shape' && (
                        <g
                          transform={`translate(${el.x}, ${el.y}) rotate(${rot} ${getRotationOriginAttr(el)})`}
                        >
                          {/* PowerPoint-style arrow lines with proper arrow heads */}
                          {(el.shapeType === 'line' || el.shapeType.startsWith('line-arrow')) && 
                           (el.beginArrow || el.endArrow) ? (
                            <ArrowLineRenderer
                              el={el}
                              isSelected={isSelected}
                              filterAttr={filterAttr}
                              isSelectOrElementTool={isSelectOrElementTool}
                              currentTool={currentTool}
                            />
                          ) : (
                            <>
                              {/* Invisible Extra-Wide Hitbox for 1-Click Selection */}
                              {el.shapeType === 'line' || el.shapeType.startsWith('line-arrow') ? (
                                <line
                                  x1={0}
                                  y1={el.height / 2}
                                  x2={el.width}
                                  y2={el.height / 2}
                                  stroke="transparent"
                                  strokeWidth={Math.max(el.strokeWidth, 24)}
                                  pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                                  className={currentTool === 'select' ? 'cursor-pointer' : ''}
                                />
                              ) : el.shapeType === 'polyline' && el.points && el.points.length >= 2 ? (
                                <path
                                  d={getPolylinePath(el.points)}
                                  fill="none"
                                  stroke="transparent"
                                  strokeWidth={Math.max(el.strokeWidth, 24)}
                                  pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                                  className={currentTool === 'select' ? 'cursor-pointer' : ''}
                                />
                              ) : el.shapeType === 'arc' &&
                                el.points &&
                                el.points.length >= 2 &&
                                el.arcRadius != null ? (
                                <path
                                  d={getArcPath(
                                    el.points[0],
                                    el.points[1],
                                    el.arcRadius,
                                    !!el.arcLarge,
                                    !!el.arcSweep
                                  )}
                                  fill="none"
                                  stroke="transparent"
                                  strokeWidth={Math.max(el.strokeWidth, 24)}
                                  pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                                  className={currentTool === 'select' ? 'cursor-pointer' : ''}
                                />
                              ) : (
                                <path
                                  d={getShapePath(el.shapeType, el.width, el.height, el.cornerRadius, el.strokeWidth)}
                                  fill="transparent"
                                  stroke="transparent"
                                  strokeWidth={Math.max(el.strokeWidth, 16)}
                                  pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                                  className={currentTool === 'select' ? 'cursor-pointer' : ''}
                                />
                              )}

                              {/* Visual Visible Shape Path */}
                              <path
                                d={
                                  el.shapeType === 'polyline' && el.points && el.points.length >= 2
                                    ? getPolylinePath(el.points)
                                    : el.shapeType === 'arc' &&
                                      el.points &&
                                      el.points.length >= 2 &&
                                      el.arcRadius != null
                                    ? getArcPath(
                                        el.points[0],
                                        el.points[1],
                                        el.arcRadius,
                                        !!el.arcLarge,
                                        !!el.arcSweep
                                      )
                                    : getShapePath(el.shapeType, el.width, el.height, el.cornerRadius, el.strokeWidth)
                                }
                                fill={
                                  el.shapeType === 'line' ||
                                  el.shapeType === 'line-arrow' ||
                                  el.shapeType === 'polyline' ||
                                  el.shapeType === 'arc'
                                    ? 'none'
                                    : el.gradient?.enabled
                                    ? `url(#grad-${el.id})`
                                    : el.fill
                                }
                                stroke={el.stroke}
                                strokeWidth={el.strokeWidth}
                                strokeLinecap={
                                  el.shapeType === 'line' ||
                                  el.shapeType === 'line-arrow' ||
                                  el.shapeType === 'polyline' ||
                                  el.shapeType === 'arc'
                                    ? 'round'
                                    : undefined
                                }
                                strokeLinejoin={
                                  el.shapeType === 'line' ||
                                  el.shapeType === 'line-arrow' ||
                                  el.shapeType === 'polyline' ||
                                  el.shapeType === 'arc'
                                    ? 'round'
                                    : undefined
                                }
                                strokeDasharray={
                                  el.strokeDash === 'dashed'
                                    ? '8 6'
                                    : el.strokeDash === 'dotted'
                                    ? '3 4'
                                    : undefined
                                }
                                opacity={el.opacity}
                                filter={filterAttr}
                                pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                              />
                            </>
                          )}
                        </g>
                      )}

                      {/* BRUSH STROKE ELEMENT */}
                      {el.type === 'brush' && (
                        <g>
                          {/* Invisible wide hitbox for brush */}
                          <path
                            d={brushPath(el.points)}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={Math.max(el.strokeWidth, 20)}
                            pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                            className={currentTool === 'select' ? 'cursor-pointer' : ''}
                          />
                          <path
                            d={brushPath(el.points)}
                            fill="none"
                            stroke={el.color}
                            strokeWidth={el.strokeWidth}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={el.isHighlighter ? el.opacity * 0.45 : el.opacity}
                            filter={filterAttr}
                            pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                          />
                        </g>
                      )}

                      {/* TEXT ELEMENT */}
                      {el.type === 'text' && el.id !== editingTextId && (
                        <g
                          transform={
                            rot !== 0
                              ? `rotate(${rot} ${el.x + el.width / 2} ${el.y + el.height / 2})`
                              : undefined
                          }
                        >
                          {/* Text hitbox rect */}
                          <rect
                            x={el.x}
                            y={el.y}
                            width={el.width}
                            height={el.height}
                            fill="transparent"
                            pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                            className={currentTool === 'select' ? 'cursor-pointer' : ''}
                          />
                          <text
                            x={
                              el.align === 'center'
                                ? el.x + el.width / 2
                                : el.align === 'right'
                                ? el.x + el.width
                                : el.x
                            }
                            y={el.y + el.fontSize}
                            fontFamily={el.fontFamily}
                            fontSize={el.fontSize}
                            fontWeight={el.bold ? 'bold' : 'normal'}
                            fontStyle={el.italic ? 'italic' : 'normal'}
                            textDecoration={el.underline ? 'underline' : 'none'}
                            fill={el.color}
                            textAnchor={
                              el.align === 'center'
                                ? 'middle'
                                : el.align === 'right'
                                ? 'end'
                                : 'start'
                            }
                            opacity={el.opacity}
                            filter={filterAttr}
                            pointerEvents="none"
                          >
                            {el.text.split('\n').map((line, i) => (
                              <tspan
                                key={i}
                                x={
                                  el.align === 'center'
                                    ? el.x + el.width / 2
                                    : el.align === 'right'
                                    ? el.x + el.width
                                    : el.x
                                }
                                dy={i === 0 ? 0 : el.fontSize * 1.3}
                              >
                                {line.length === 0 ? '\u00A0' : line}
                              </tspan>
                            ))}
                          </text>
                        </g>
                      )}

                      {/* IMAGE ELEMENT (Supports ClipPath Corner Radius, Border, and Non-blocking pointer events) */}
                      {el.type === 'image' && (
                        <g
                          transform={
                            rot !== 0
                              ? `rotate(${rot} ${el.x + el.width / 2} ${el.y + el.height / 2})`
                              : undefined
                          }
                        >
                          <image
                            href={el.src}
                            x={el.x}
                            y={el.y}
                            width={el.width}
                            height={el.height}
                            preserveAspectRatio="none"
                            opacity={el.opacity}
                            filter={filterAttr}
                            clipPath={el.cornerRadius ? `url(#clip-${el.id})` : undefined}
                            pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
                            className={currentTool === 'select' ? 'cursor-pointer' : ''}
                            style={{
                              filter: `brightness(${el.filters.brightness}%) contrast(${el.filters.contrast}%) saturate(${el.filters.saturation}%) blur(${el.filters.blur}px) grayscale(${el.filters.grayscale}%) invert(${el.filters.invert}%)`,
                            }}
                          />
                          {/* Optional Picture Border */}
                          {el.borderWidth ? (
                            <rect
                              x={el.x}
                              y={el.y}
                              width={el.width}
                              height={el.height}
                              rx={el.cornerRadius || 0}
                              ry={el.cornerRadius || 0}
                              fill="none"
                              stroke={el.borderColor || '#000000'}
                              strokeWidth={el.borderWidth}
                              pointerEvents="none"
                            />
                          ) : null}
                        </g>
                      )}

                      {/* Multi-selection indicator highlight border if element is selected */}
                      {isSelected && selectedElementIds.length > 1 && (
                        <rect
                          x={el.x - 2}
                          y={el.y - 2}
                          width={el.width + 4}
                          height={el.height + 4}
                          fill="none"
                          stroke="#F59E0B"
                          strokeWidth="1.5"
                          strokeDasharray="4 3"
                          pointerEvents="none"
                          transform={
                            rot !== 0
                              ? `rotate(${rot} ${
                                  el.type === 'shape' && (el.shapeType === 'line' || el.shapeType.startsWith('line-arrow'))
                                    ? `${el.x} ${el.y + el.height / 2}`
                                    : `${el.x + el.width / 2} ${el.y + el.height / 2}`
                                })`
                              : undefined
                          }
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

        {/* Radial Array (방사상 배열) – guide + live preview of the copies */}
        {radialToolState && radialToolState.step !== 'idle' && (
          <g pointerEvents="none">
            {radialToolState.center && (
              <>
                {/* Radius guide */}
                <circle
                  cx={radialToolState.center.x}
                  cy={radialToolState.center.y}
                  r={radialToolState.radius}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  opacity={0.7}
                />
                {/* Spokes towards every copy */}
                {radialToolState.previewElements.map((el) => {
                  const dx = el.x + el.width / 2 - radialToolState.center!.x;
                  const dy = el.y + el.height / 2 - radialToolState.center!.y;
                  return (
                    <line
                      key={`spoke-${el.id}`}
                      x1={radialToolState.center!.x}
                      y1={radialToolState.center!.y}
                      x2={radialToolState.center!.x + dx}
                      y2={radialToolState.center!.y + dy}
                      stroke="#F59E0B"
                      strokeWidth={0.75}
                      opacity={0.45}
                    />
                  );
                })}
                {/* Center marker – makes the pivot of the array obvious */}
                <g transform={`translate(${radialToolState.center.x} ${radialToolState.center.y})`}>
                  <circle
                    r={13}
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    opacity={0.9}
                  />
                  <circle r={7} fill="none" stroke="#F59E0B" strokeWidth={1} opacity={0.55} />
                  <line x1={-20} y1={0} x2={-13} y2={0} stroke="#F59E0B" strokeWidth={1.5} />
                  <line x1={13} y1={0} x2={20} y2={0} stroke="#F59E0B" strokeWidth={1.5} />
                  <line x1={0} y1={-20} x2={0} y2={-13} stroke="#F59E0B" strokeWidth={1.5} />
                  <line x1={0} y1={13} x2={0} y2={20} stroke="#F59E0B" strokeWidth={1.5} />
                  <circle r={3.5} fill="#F59E0B" stroke="#1C1917" strokeWidth={1} />
                  <text
                    x={0}
                    y={-26}
                    textAnchor="middle"
                    fill="#FBBF24"
                    fontSize={11}
                    fontWeight={600}
                    stroke="#1C1917"
                    strokeWidth={2.5}
                    paintOrder="stroke"
                    style={{ letterSpacing: '-0.02em' }}
                  >
                    중심
                  </text>
                </g>
              </>
            )}
            {radialToolState.previewElements.map((el) => (
              <RadialPreviewItem key={el.id} el={el} />
            ))}
          </g>
        )}

        {/* Radial Array – "click here to set the center" hint */}
        {currentTool === 'radial' && radialToolState?.step === 'placing_center' && (
          <g
            pointerEvents="none"
            transform={`translate(${
              config.snapToGrid ? snapValue(cursorPos.x) : cursorPos.x
            } ${
              config.snapToGrid ? snapValue(cursorPos.y) : cursorPos.y
            })`}
          >
            <circle
              r={16}
              fill="none"
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.9}
            >
              <animate
                attributeName="r"
                values="12;20;12"
                dur="1.6s"
                repeatCount="indefinite"
              />
            </circle>
            <circle r={3} fill="#F59E0B" />
            <text
              x={0}
              y={-26}
              textAnchor="middle"
              fill="#FBBF24"
              fontSize={11}
              fontWeight={600}
              stroke="#1C1917"
              strokeWidth={2.5}
              paintOrder="stroke"
            >
              여기를 클릭 → 중심점
            </text>
          </g>
        )}

        {/* Active Brush Stroke Live Drawing Preview */}
          {isDrawing && currentPoints.length > 1 && (
            <path
              d={brushPath(currentPoints)}
              fill="none"
              stroke={primaryColor}
              strokeWidth={
                currentTool === 'highlighter' ? Math.max(strokeWidth * 3, 16) : strokeWidth
              }
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={currentTool === 'highlighter' ? 0.45 : 1}
            />
          )}

          {/* Active LINE Live Drawing Preview - PowerPoint style */}
          {isDrawing &&
            currentTool === 'shape' &&
            (selectedShapeType === 'line' || selectedShapeType.startsWith('line-arrow')) &&
            linePreviewEnd && (() => {
            const activeLineStroke = (lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none') ? lastShapeStyle.stroke : (primaryColor || '#000000');
            const activeStrokeW = (lastShapeStyle.strokeWidth && lastShapeStyle.strokeWidth > 0) ? lastShapeStyle.strokeWidth : (strokeWidth || 2);
            
            // Map shapeType to arrow configuration for preview
            let beginArrow = { type: 'none' as ArrowType, size: 'medium' as ArrowSize };
            let endArrow = { type: 'none' as ArrowType, size: 'medium' as ArrowSize };
            
            if (selectedShapeType.startsWith('line-arrow')) {
              if (selectedShapeType === 'line-arrow') {
                endArrow = { type: 'triangle', size: 'medium' };
              } else if (selectedShapeType === 'line-arrow-both') {
                beginArrow = { type: 'triangle', size: 'medium' };
                endArrow = { type: 'triangle', size: 'medium' };
              } else if (selectedShapeType === 'line-arrow-start') {
                beginArrow = { type: 'triangle', size: 'medium' };
              } else if (selectedShapeType === 'line-arrow-open') {
                endArrow = { type: 'open', size: 'medium' };
              } else if (selectedShapeType === 'line-arrow-dot') {
                endArrow = { type: 'oval', size: 'medium' };
              } else if (selectedShapeType === 'line-arrow-diamond') {
                endArrow = { type: 'diamond', size: 'medium' };
              }
            }
            
            // Calculate shortened endpoints
            const shortened = getShortenedLineEndpoints(
              drawStart.x,
              drawStart.y,
              linePreviewEnd.x,
              linePreviewEnd.y,
              activeStrokeW,
              beginArrow.type,
              beginArrow.size,
              endArrow.type,
              endArrow.size
            );
            
            const dx = linePreviewEnd.x - drawStart.x;
            const dy = linePreviewEnd.y - drawStart.y;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            
            return (
              <g pointerEvents="none">
                {/* Shortened line shaft (dashed for preview) */}
                <line
                  x1={shortened.startX}
                  y1={shortened.startY}
                  x2={shortened.endX}
                  y2={shortened.endY}
                  stroke={activeLineStroke}
                  strokeWidth={activeStrokeW}
                  strokeLinecap="round"
                  strokeDasharray="6 4"
                />
                
                {/* Begin arrow head */}
                {beginArrow.type !== 'none' && (
                  <path
                    d={getArrowHeadPath(activeStrokeW, beginArrow.type, beginArrow.size)}
                    transform={`translate(${drawStart.x}, ${drawStart.y}) rotate(${angle})`}
                    fill={isArrowHeadFilled(beginArrow.type) ? activeLineStroke : 'none'}
                    stroke={activeLineStroke}
                    strokeWidth={isArrowHeadFilled(beginArrow.type) ? 0 : activeStrokeW}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                
                {/* End arrow head */}
                {endArrow.type !== 'none' && (
                  <path
                    d={getArrowHeadPath(activeStrokeW, endArrow.type, endArrow.size)}
                    transform={`translate(${linePreviewEnd.x}, ${linePreviewEnd.y}) rotate(${angle})`}
                    fill={isArrowHeadFilled(endArrow.type) ? activeLineStroke : 'none'}
                    stroke={activeLineStroke}
                    strokeWidth={isArrowHeadFilled(endArrow.type) ? 0 : activeStrokeW}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                
                {/* Start/end point indicators */}
                <circle cx={drawStart.x} cy={drawStart.y} r={4} fill="#F59E0B" stroke="#000000" strokeWidth={1} />
                <circle cx={linePreviewEnd.x} cy={linePreviewEnd.y} r={4} fill="#F59E0B" stroke="#000000" strokeWidth={1} />
              </g>
            );
          })()}

          {/* Continuous Polyline Draft Preview */}
          {polylineDraft && polylineDraft.length > 0 && (() => {
            const stroke =
              lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none'
                ? lastShapeStyle.stroke
                : primaryColor || '#000000';
            const sw =
              lastShapeStyle.strokeWidth && lastShapeStyle.strokeWidth > 0
                ? lastShapeStyle.strokeWidth
                : strokeWidth || 2;
            const previewPts =
              polylineCursor && polylineDraft.length > 0
                ? [...polylineDraft, polylineCursor]
                : polylineDraft;
            return (
              <g className="pointer-events-none">
                <path
                  d={getPolylinePath(previewPts)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="6 4"
                  opacity={0.9}
                />
                {polylineDraft.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill="#F59E0B"
                    stroke="#000000"
                    strokeWidth={1}
                  />
                ))}
                {polylineCursor && (
                  <circle
                    cx={polylineCursor.x}
                    cy={polylineCursor.y}
                    r={3.5}
                    fill="#FBBF24"
                    stroke="#000000"
                    strokeWidth={1}
                  />
                )}
              </g>
            );
          })()}

          {/* Arc Draft Preview */}
          {arcDraft && (() => {
            const stroke =
              lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none'
                ? lastShapeStyle.stroke
                : primaryColor || '#000000';
            const sw =
              lastShapeStyle.strokeWidth && lastShapeStyle.strokeWidth > 0
                ? lastShapeStyle.strokeWidth
                : strokeWidth || 2;
            const endPt = arcDraft.end || arcBend;
            const computed =
              arcDraft.end && arcBend
                ? computeArcFromChordAndBend(arcDraft.start, arcDraft.end, arcBend)
                : null;
            return (
              <g className="pointer-events-none">
                {endPt && (
                  <line
                    x1={arcDraft.start.x}
                    y1={arcDraft.start.y}
                    x2={endPt.x}
                    y2={endPt.y}
                    stroke="#78716c"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    opacity={0.7}
                  />
                )}
                {computed && (
                  <>
                    <path
                      d={getArcPath(
                        arcDraft.start,
                        arcDraft.end!,
                        computed.radius,
                        computed.large,
                        computed.sweep
                      )}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={sw}
                      strokeLinecap="round"
                      strokeDasharray="6 4"
                      opacity={0.95}
                    />
                    <circle
                      cx={computed.apex.x}
                      cy={computed.apex.y}
                      r={3.5}
                      fill="#FBBF24"
                      stroke="#000"
                      strokeWidth={1}
                    />
                    <text
                      x={computed.apex.x + 8}
                      y={computed.apex.y - 8}
                      fill="#FBBF24"
                      fontSize={11}
                      fontFamily="ui-monospace, monospace"
                    >
                      R {Math.round(computed.radius)}
                    </text>
                  </>
                )}
                <circle
                  cx={arcDraft.start.x}
                  cy={arcDraft.start.y}
                  r={4}
                  fill="#F59E0B"
                  stroke="#000"
                  strokeWidth={1}
                />
                {arcDraft.end && (
                  <circle
                    cx={arcDraft.end.x}
                    cy={arcDraft.end.y}
                    r={4}
                    fill="#F59E0B"
                    stroke="#000"
                    strokeWidth={1}
                  />
                )}
              </g>
            );
          })()}

          {/* Active Shape Live Drawing Preview (for non-line shapes) */}
          {isDrawing &&
            previewRect &&
            selectedShapeType !== 'line' &&
            selectedShapeType !== 'line-arrow' &&
            selectedShapeType !== 'polyline' &&
            selectedShapeType !== 'arc' && (
            <g transform={`translate(${previewRect.x}, ${previewRect.y})`}>
              <path
                d={getShapePath(selectedShapeType, previewRect.w, previewRect.h, undefined, strokeWidth)}
                fill={
                  lastShapeStyle.fill === 'none' || lastShapeStyle.fill
                    ? lastShapeStyle.fill || 'none'
                    : 'none'
                }
                stroke={
                  lastShapeStyle.stroke && lastShapeStyle.stroke !== 'none'
                    ? lastShapeStyle.stroke
                    : primaryColor || '#FF0000'
                }
                strokeWidth={lastShapeStyle.strokeWidth || strokeWidth || 1}
                opacity={0.8}
                strokeDasharray="4 4"
              />
            </g>
          )}
        </svg>

        {/* Marquee Selection Drag Box (Multi-selection) */}
        {isMarqueeSelecting && marqueeRect && (
          <div
            style={{
              position: 'absolute',
              left: `${marqueeRect.x}px`,
              top: `${marqueeRect.y}px`,
              width: `${marqueeRect.w}px`,
              height: `${marqueeRect.h}px`,
            }}
            className="border-2 border-dashed border-amber-400 bg-amber-500/15 pointer-events-none z-30"
          />
        )}

        {/* Selected LINE Endpoint Handles & Move Overlay (PowerPoint Style) */}
        {currentTool === 'select' && !croppingImageId && selectedLineEndpoints && selectedElement && !activeLayer.locked && (
          <div className="absolute inset-0 pointer-events-none z-20">
            <svg className="w-full h-full absolute inset-0 overflow-visible pointer-events-none">
              {/* Move hitbox along the entire line */}
              <line
                x1={selectedLineEndpoints.start.x}
                y1={selectedLineEndpoints.start.y}
                x2={selectedLineEndpoints.end.x}
                y2={selectedLineEndpoints.end.y}
                stroke="transparent"
                strokeWidth={Math.max(selectedElement.strokeWidth + 18, 24)}
                className="pointer-events-auto cursor-move"
                onMouseDown={(e) => startTransform('move', e)}
              />
              {/* Dashed line selection indicator */}
              <line
                x1={selectedLineEndpoints.start.x}
                y1={selectedLineEndpoints.start.y}
                x2={selectedLineEndpoints.end.x}
                y2={selectedLineEndpoints.end.y}
                stroke="#F59E0B"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                className="pointer-events-none"
              />
            </svg>
            {/* Start Point Handle */}
            <div
              style={{
                left: `${selectedLineEndpoints.start.x}px`,
                top: `${selectedLineEndpoints.start.y}px`,
                transform: 'translate(-50%, -50%)',
              }}
              onMouseDown={(e) => startTransform('line-start', e)}
              className="absolute w-3.5 h-3.5 bg-white border-2 border-amber-500 rounded-full shadow-md cursor-crosshair pointer-events-auto hover:scale-125 transition-transform"
              title="선 시작점 이동"
            />
            {/* End Point Handle */}
            <div
              style={{
                left: `${selectedLineEndpoints.end.x}px`,
                top: `${selectedLineEndpoints.end.y}px`,
                transform: 'translate(-50%, -50%)',
              }}
              onMouseDown={(e) => startTransform('line-end', e)}
              className="absolute w-3.5 h-3.5 bg-white border-2 border-amber-500 rounded-full shadow-md cursor-crosshair pointer-events-auto hover:scale-125 transition-transform"
              title="선 끝점 이동"
            />
          </div>
        )}

        {/* Multi-select group bounds: move all selected shapes together */}
        {currentTool === 'select' && !croppingImageId && groupBounds && selectedElements.length > 1 && !activeLayer.locked && (
          <div
            style={{
              position: 'absolute',
              left: `${groupBounds.x}px`,
              top: `${groupBounds.y}px`,
              width: `${groupBounds.w}px`,
              height: `${groupBounds.h}px`,
            }}
            className="pointer-events-none border border-dashed border-amber-500 ring-1 ring-amber-500/40 z-20"
          >
            <div
              onMouseDown={(e) => startTransform('move', e)}
              className="absolute inset-0 cursor-move pointer-events-auto bg-amber-500/5"
              title="선택된 도형 일괄 이동 (Shift+드래그: 수평/수직만)"
            />
          </div>
        )}

        {/* Selected Non-Line Element Interactive Transform Box (PowerPoint Style Handles) */}
        {currentTool === 'select' &&
          !croppingImageId &&
          selectedElementIds.length === 1 &&
          !selectedLineEndpoints &&
          selectedElement &&
          !activeLayer.locked &&
          selectedElement.id !== editingTextId && (
          <div
            style={{
              position: 'absolute',
              left: `${selectedElement.x}px`,
              top: `${selectedElement.y}px`,
              width: `${selectedElement.width}px`,
              height: `${selectedElement.height}px`,
              transform: `rotate(${selectedElement.rotation || 0}deg)`,
              transformOrigin: 'center center',
            }}
            className="pointer-events-none border border-amber-500 ring-1 ring-amber-500/50 z-20"
          >
            {/* Move handle area */}
            <div
              onMouseDown={(e) => startTransform('move', e)}
              className="absolute inset-0 cursor-move pointer-events-auto bg-amber-500/5"
              title="드래그하여 이동 (Shift+드래그: 수평/수직만, Shift+클릭: 다중 선택)"
            />

            {/* Rotation handle and line */}
            <div className="absolute left-1/2 -top-6 -translate-x-1/2 flex flex-col items-center pointer-events-auto">
              <div
                onMouseDown={(e) => startTransform('rotate', e)}
                className="w-3.5 h-3.5 rounded-full bg-amber-500 border border-white cursor-grab shadow hover:scale-125 transition-transform"
                title="회전 핸들 (Shift 누르면 15도 스냅)"
              />
              <div className="w-[1px] h-3 bg-amber-500" />
            </div>

            {/* 8 Resize Handles */}
            {[
              { type: 'nw', cursor: 'nwse-resize', pos: '-top-1.5 -left-1.5' },
              { type: 'n', cursor: 'ns-resize', pos: '-top-1.5 left-1/2 -translate-x-1/2' },
              { type: 'ne', cursor: 'nesw-resize', pos: '-top-1.5 -right-1.5' },
              { type: 'e', cursor: 'ew-resize', pos: 'top-1/2 -right-1.5 -translate-y-1/2' },
              { type: 'se', cursor: 'nwse-resize', pos: '-bottom-1.5 -right-1.5' },
              { type: 's', cursor: 'ns-resize', pos: '-bottom-1.5 left-1/2 -translate-x-1/2' },
              { type: 'sw', cursor: 'nesw-resize', pos: '-bottom-1.5 -left-1.5' },
              { type: 'w', cursor: 'ew-resize', pos: 'top-1/2 -left-1.5 -translate-y-1/2' },
            ].map((h) => (
              <div
                key={h.type}
                onMouseDown={(e) => startTransform(h.type as HandleType, e)}
                style={{ cursor: h.cursor }}
                className={`absolute w-3 h-3 bg-white border border-amber-600 rounded-sm shadow-sm pointer-events-auto hover:scale-125 transition-transform ${h.pos}`}
              />
            ))}
          </div>
        )}

        {/* Inline Text Editor Overlay */}
        {editingTextId &&
          (() => {
            const live = elements.find((el) => el.id === editingTextId && el.type === 'text') as
              | TextElement
              | undefined;
            const textEl = live || editingTextSnapshot;
            if (!textEl) return null;
            // Always prefer the element's fontSize; fall back to 12 for brand-new boxes
            const fontSize = textEl.fontSize > 0 ? textEl.fontSize : DEFAULT_TEXT_FONT_SIZE;
            const draftSize = measureTextBox(
              editDraft || '텍스트 입력',
              fontSize,
              Math.min(textEl.width, DEFAULT_TEXT_BOX_WIDTH)
            );
            const boxW = Math.max(DEFAULT_TEXT_BOX_WIDTH, draftSize.width);
            const boxH = Math.max(DEFAULT_TEXT_BOX_HEIGHT, draftSize.height);
            return (
              <textarea
                ref={textEditRef}
                value={editDraft}
                placeholder="텍스트 입력"
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={() => commitTextEdit()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  // Ctrl+Enter / Cmd+Enter: confirm text entry
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    commitTextEdit();
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    commitTextEdit();
                  }
                }}
                style={{
                  position: 'absolute',
                  left: `${textEl.x}px`,
                  top: `${textEl.y}px`,
                  width: `${boxW}px`,
                  height: `${boxH}px`,
                  fontFamily: textEl.fontFamily,
                  fontSize: `${fontSize}px`,
                  fontWeight: textEl.bold ? 'bold' : 'normal',
                  fontStyle: textEl.italic ? 'italic' : 'normal',
                  textDecoration: textEl.underline ? 'underline' : 'none',
                  color: textEl.color,
                  textAlign: textEl.align,
                  lineHeight: 1.3,
                  transform: `rotate(${textEl.rotation || 0}deg)`,
                  transformOrigin: 'center center',
                  opacity: textEl.opacity,
                }}
                className="z-40 resize-none overflow-hidden bg-white/95 border-2 border-amber-500 rounded-sm outline-none shadow-lg p-0.5 m-0 select-text caret-amber-600"
                spellCheck={false}
              />
            );
          })()}

        {/* PowerPoint-style Image Cropping Overlay */}
        {croppingImage && croppingImageId === croppingImage.id && (
          <div
            style={{
              position: 'absolute',
              left: `${croppingImage.x}px`,
              top: `${croppingImage.y}px`,
              width: `${croppingImage.width}px`,
              height: `${croppingImage.height}px`,
              transform: `rotate(${croppingImage.rotation || 0}deg)`,
              transformOrigin: 'center center',
            }}
            className="pointer-events-none z-30"
          >
            {/* Dimmed Areas (outside crop region) */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: `${imgCropBox.y}px`,
              }}
              className="bg-stone-950/65 pointer-events-auto"
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: `${imgCropBox.y + imgCropBox.h}px`,
                width: '100%',
                height: `${Math.max(0, croppingImage.height - (imgCropBox.y + imgCropBox.h))}px`,
              }}
              className="bg-stone-950/65 pointer-events-auto"
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: `${imgCropBox.y}px`,
                width: `${imgCropBox.x}px`,
                height: `${imgCropBox.h}px`,
              }}
              className="bg-stone-950/65 pointer-events-auto"
            />
            <div
              style={{
                position: 'absolute',
                left: `${imgCropBox.x + imgCropBox.w}px`,
                top: `${imgCropBox.y}px`,
                width: `${Math.max(0, croppingImage.width - (imgCropBox.x + imgCropBox.w))}px`,
                height: `${imgCropBox.h}px`,
              }}
              className="bg-stone-950/65 pointer-events-auto"
            />

            {/* Active Crop Box Frame */}
            <div
              style={{
                position: 'absolute',
                left: `${imgCropBox.x}px`,
                top: `${imgCropBox.y}px`,
                width: `${imgCropBox.w}px`,
                height: `${imgCropBox.h}px`,
              }}
              className="pointer-events-none border-2 border-white shadow-2xl"
            >
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                <div className="border-r border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-b border-white" />
                <div className="border-r border-white" />
                <div className="border-r border-white" />
                <div />
              </div>

              <div
                onMouseDown={(e) => handleCropHandleMouseDown('move', e)}
                className="absolute inset-0 cursor-move pointer-events-auto hover:bg-amber-500/10 transition-colors"
                title="드래그하여 자르기 영역 이동"
              />

              <div
                onMouseDown={(e) => handleCropHandleMouseDown('nw', e)}
                className="absolute -top-1.5 -left-1.5 w-4 h-4 border-t-4 border-l-4 border-black pointer-events-auto cursor-nwse-resize shadow bg-white/50"
              />
              <div
                onMouseDown={(e) => handleCropHandleMouseDown('ne', e)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 border-t-4 border-r-4 border-black pointer-events-auto cursor-nesw-resize shadow bg-white/50"
              />
              <div
                onMouseDown={(e) => handleCropHandleMouseDown('se', e)}
                className="absolute -bottom-1.5 -right-1.5 w-4 h-4 border-b-4 border-r-4 border-black pointer-events-auto cursor-nwse-resize shadow bg-white/50"
              />
              <div
                onMouseDown={(e) => handleCropHandleMouseDown('sw', e)}
                className="absolute -bottom-1.5 -left-1.5 w-4 h-4 border-b-4 border-l-4 border-black pointer-events-auto cursor-nesw-resize shadow bg-white/50"
              />

              <div
                onMouseDown={(e) => handleCropHandleMouseDown('n', e)}
                className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-6 h-1.5 bg-black border border-white pointer-events-auto cursor-ns-resize shadow"
              />
              <div
                onMouseDown={(e) => handleCropHandleMouseDown('s', e)}
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-1.5 bg-black border border-white pointer-events-auto cursor-ns-resize shadow"
              />
              <div
                onMouseDown={(e) => handleCropHandleMouseDown('w', e)}
                className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-1.5 h-6 bg-black border border-white pointer-events-auto cursor-ew-resize shadow"
              />
              <div
                onMouseDown={(e) => handleCropHandleMouseDown('e', e)}
                className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-1.5 h-6 bg-black border border-white pointer-events-auto cursor-ew-resize shadow"
              />
            </div>

            {/* Floating Crop Control Toolbar */}
            <div
              style={{
                position: 'absolute',
                left: `${imgCropBox.x}px`,
                top: `${imgCropBox.y + imgCropBox.h + 10}px`,
              }}
              className="pointer-events-auto flex items-center bg-stone-900 border border-stone-700 rounded-lg p-1.5 shadow-2xl space-x-1.5 z-40 text-xs text-stone-200 backdrop-blur whitespace-nowrap"
            >
              <div className="flex items-center px-1.5 font-mono text-[11px] text-amber-400 font-semibold border-r border-stone-700 pr-2">
                <Crop className="w-3.5 h-3.5 mr-1" />
                {Math.round(imgCropBox.w)} × {Math.round(imgCropBox.h)} px
              </div>

              <div className="flex items-center space-x-1 pr-1.5 border-r border-stone-700">
                <button
                  type="button"
                  onClick={() => setCropAspectRatio(1, 1, croppingImage)}
                  className="px-1.5 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-[10px] text-stone-300 transition-colors"
                  title="1:1 정사각형"
                >
                  1:1
                </button>
                <button
                  type="button"
                  onClick={() => setCropAspectRatio(4, 3, croppingImage)}
                  className="px-1.5 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-[10px] text-stone-300 transition-colors"
                  title="4:3 비율"
                >
                  4:3
                </button>
                <button
                  type="button"
                  onClick={() => setCropAspectRatio(16, 9, croppingImage)}
                  className="px-1.5 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-[10px] text-stone-300 transition-colors"
                  title="16:9 와이드"
                >
                  16:9
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImgCropBox({
                      x: 0,
                      y: 0,
                      w: croppingImage.width,
                      h: croppingImage.height,
                    });
                  }}
                  className="px-1.5 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-[10px] text-stone-400 transition-colors"
                  title="전체 영역으로 초기화"
                >
                  초기화
                </button>
              </div>

              {/* Auto Crop (Trim) — 실제 픽셀에서 여백을 찾아 크롭 박스를 맞춤 */}
              <div className="flex items-center space-x-1 pr-1.5 border-r border-stone-700">
                <button
                  type="button"
                  onClick={handleAutoCropImage}
                  disabled={isAutoCropping}
                  className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 disabled:cursor-wait text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 text-[11px] font-semibold rounded transition-colors flex items-center space-x-1"
                  title="투명/단색 여백을 자동 감지해 크롭 영역을 맞춥니다"
                >
                  <Wand2 className={`w-3 h-3 ${isAutoCropping ? 'animate-pulse' : ''}`} />
                  <span>자동 자르기</span>
                </button>
                <div
                  className="flex items-center bg-stone-800 border border-stone-700 rounded overflow-hidden"
                  title="자동 자르기 결과에 남길 여백(px)"
                >
                  <button
                    type="button"
                    onClick={() => setAutoCropPadding((p) => Math.max(0, p - 2))}
                    className="px-1 py-1 text-stone-400 hover:text-stone-100 hover:bg-stone-700 transition-colors"
                    aria-label="여백 줄이기"
                  >
                    <Minus className="w-2.5 h-2.5" />
                  </button>
                  <span className="w-7 text-center font-mono text-[10px] text-amber-400 font-semibold select-none">
                    {autoCropPadding}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAutoCropPadding((p) => Math.min(200, p + 2))}
                    className="px-1 py-1 text-stone-400 hover:text-stone-100 hover:bg-stone-700 transition-colors"
                    aria-label="여백 늘리기"
                  >
                    <Plus className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {/* Cut & Copy image portion */}
              <div className="flex items-center space-x-1 pr-1.5 border-r border-stone-700">
                <button
                  type="button"
                  onClick={() => onCutImagePart?.(croppingImage, imgCropBox)}
                  className="px-2 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-300 hover:text-red-200 border border-red-500/30 text-[11px] font-semibold rounded transition-colors flex items-center space-x-1"
                  title="선택 영역을 오려내어 클립보드에 저장하고 원본에서 비웁니다 (Ctrl+X)"
                >
                  <Scissors className="w-3 h-3" />
                  <span>오려내기</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCopyImagePart?.(croppingImage, imgCropBox)}
                  className="px-2 py-1 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 hover:text-sky-200 border border-sky-500/30 text-[11px] font-semibold rounded transition-colors flex items-center space-x-1"
                  title="복사 (Ctrl+C)"
                >
                  <Copy className="w-3 h-3" />
                  <span>복사</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleApplyImageCrop(croppingImage, imgCropBox)}
                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs rounded transition-colors shadow flex items-center"
                title="남기기 (Enter)"
              >
                남기기
              </button>
              <button
                type="button"
                onClick={() => onFinishCropImage?.()}
                className="px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs rounded transition-colors"
                title="취소 (Esc)"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* Crop Box Overlay */}
        {cropBox && (
          <div
            style={{
              left: `${cropBox.x}px`,
              top: `${cropBox.y}px`,
              width: `${cropBox.w}px`,
              height: `${cropBox.h}px`,
            }}
            className={`absolute border-2 border-dashed border-amber-400 pointer-events-none z-30 transition-all duration-150 ${
              isCropFlashing
                ? 'bg-white/80 ring-4 ring-amber-400 shadow-2xl'
                : 'bg-amber-500/15'
            }`}
          >
            {/* Corner resize indicators */}
            <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-sm border border-stone-900 shadow-sm" />
            <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-amber-400 rounded-sm border border-stone-900 shadow-sm" />
            <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-sm border border-stone-900 shadow-sm" />
            <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-amber-400 rounded-sm border border-stone-900 shadow-sm" />
          </div>
        )}
      </div>

      {/* Canvas Crop – action bar (자동 자르기 / 적용 / 취소) */}
      {currentTool === 'crop' && !croppingImageId && (
        <div className="absolute top-9 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 pointer-events-none">
          <div className="pointer-events-auto bg-stone-900/95 backdrop-blur border border-amber-500/50 rounded-lg px-3 py-1.5 text-[11px] text-stone-200 flex items-center gap-2.5 shadow-xl whitespace-nowrap">
            <span className="font-semibold text-amber-300">자르기</span>

            {cropBox ? (
              <span className="font-mono text-[10px] text-stone-400">
                {Math.round(cropBox.w)} × {Math.round(cropBox.h)} px
              </span>
            ) : (
              <span className="text-stone-500">영역을 드래그하거나 자동 자르기를 사용하세요</span>
            )}

            <span className="text-stone-700">|</span>

            <button
              type="button"
              onClick={handleAutoCropCanvas}
              disabled={isAutoCropping}
              className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 disabled:cursor-wait text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 text-[11px] font-semibold rounded transition-colors flex items-center gap-1"
              title="객체가 있는 실제 영역을 감지해 크롭 박스를 맞춥니다"
            >
              <Wand2 className={`w-3 h-3 ${isAutoCropping ? 'animate-pulse' : ''}`} />
              자동 자르기
            </button>

            <div
              className="flex items-center bg-stone-800 border border-stone-700 rounded overflow-hidden"
              title="자동 자르기 결과에 남길 여백(px)"
            >
              <button
                type="button"
                onClick={() => setAutoCropPadding((p) => Math.max(0, p - 2))}
                className="px-1 py-1 text-stone-400 hover:text-stone-100 hover:bg-stone-700 transition-colors"
                aria-label="여백 줄이기"
              >
                <Minus className="w-2.5 h-2.5" />
              </button>
              <span className="w-7 text-center font-mono text-[10px] text-amber-400 font-semibold select-none">
                {autoCropPadding}
              </span>
              <button
                type="button"
                onClick={() => setAutoCropPadding((p) => Math.min(200, p + 2))}
                className="px-1 py-1 text-stone-400 hover:text-stone-100 hover:bg-stone-700 transition-colors"
                aria-label="여백 늘리기"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            </div>

            <span className="text-stone-700">|</span>

            <button
              type="button"
              onClick={applyCrop}
              disabled={!cropBox || cropBox.w < 20 || cropBox.h < 20}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-stone-950 font-bold text-[11px] rounded transition-colors"
              title="크롭 영역으로 캔버스 크기 변경 (Enter)"
            >
              적용
            </button>
            <button
              type="button"
              onClick={() => setCropBox(null)}
              disabled={!cropBox}
              className="px-2 py-1 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed text-stone-300 text-[11px] rounded transition-colors"
              title="크롭 취소 (Esc)"
            >
              취소
            </button>
          </div>

          {autoCropNotice && (
            <div className="pointer-events-none bg-stone-900/95 backdrop-blur border border-stone-700 rounded-md px-3 py-1 text-[10px] text-stone-300 shadow-lg">
              {autoCropNotice}
            </div>
          )}
        </div>
      )}

      {/* Image Crop – auto crop notice */}
      {croppingImageId && autoCropNotice && (
        <div className="absolute top-9 left-1/2 -translate-x-1/2 z-40 pointer-events-none bg-stone-900/95 backdrop-blur border border-stone-700 rounded-md px-3 py-1.5 text-[10px] text-stone-200 shadow-lg whitespace-nowrap">
          {autoCropNotice}
        </div>
      )}

      {/* Radial Array – step guide banner */}
      {currentTool === 'radial' && radialToolState && radialToolState.step !== 'idle' && (
        <div className="absolute top-9 left-1/2 -translate-x-1/2 z-20 bg-stone-900/95 backdrop-blur border border-amber-500/50 rounded-lg px-3.5 py-2 text-[11px] text-stone-200 flex items-center gap-3 shadow-xl pointer-events-none">
          <span className="font-semibold text-amber-300">방사상 배열</span>
          <span className="text-stone-400">
            {radialToolState.step === 'placing_center'
              ? '① 캔버스를 클릭해 중심점 지정'
              : radialToolState.step === 'adjusting_radius'
              ? '② 마우스를 움직여 반지름 조절'
              : '③ 반지름 고정됨'}
          </span>
          <span className="text-stone-600">|</span>
          <span className="text-stone-400">
            <kbd className="px-1 py-0.5 rounded bg-stone-800 border border-stone-700 text-amber-300 font-mono text-[10px] font-bold">
              Enter
            </kbd>{' '}
            확정
          </span>
          <span className="text-stone-400">
            <kbd className="px-1 py-0.5 rounded bg-stone-800 border border-stone-700 text-amber-300 font-mono text-[10px] font-bold">
              Esc
            </kbd>{' '}
            취소
          </span>
        </div>
      )}

      {/* Bottom Status Info Bar */}
      <div className="absolute bottom-2 right-4 bg-stone-900/90 backdrop-blur border border-stone-800 rounded-lg px-3 py-1.5 text-[11px] font-mono text-stone-400 flex items-center space-x-4 pointer-events-none z-10 shadow-lg">
        {cropBox && cropBox.w >= 1 && cropBox.h >= 1 && (
          <div>
            크롭:{' '}
            <span className="text-amber-400 font-semibold">
              {Math.round(cropBox.w)} × {Math.round(cropBox.h)} px
            </span>
          </div>
        )}
        {croppingImage && imgCropBox.w >= 1 && imgCropBox.h >= 1 && !cropBox && (
          <div>
            크롭:{' '}
            <span className="text-amber-400 font-semibold">
              {Math.round(imgCropBox.w)} × {Math.round(imgCropBox.h)} px
            </span>
          </div>
        )}
        <div>
          캔버스: <span className="text-stone-200">{config.width} × {config.height} px</span>
        </div>
        <div>
          마우스: <span className="text-stone-200">{Math.round(cursorPos.x)}, {Math.round(cursorPos.y)}</span>
        </div>
        <div>
          배율: <span className="text-amber-400 font-semibold">{Math.round(zoom * 100)}%</span>
        </div>
        {selectedElements.length > 1 ? (
          <div className="text-amber-400 font-semibold">
            선택: {selectedElements.length}개 개체 다중 선택됨
          </div>
        ) : selectedElement ? (
          <div className="text-stone-300">
            선택: {selectedElement.name || selectedElement.type} ({Math.round(selectedElement.width)}×{Math.round(selectedElement.height)})
          </div>
        ) : null}
      </div>
    </div>
  );
};
