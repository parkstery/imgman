import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CanvasConfig,
  CanvasElement,
  Layer,
  ToolType,
  ShapeType,
  HistorySnapshot,
  ImageElement,
  ShapeStylePreset,
  Point,
  RadialToolState,
  RadialStep,
  RadialRotateMode,
} from './types';
import { HeaderNavbar } from './components/HeaderNavbar';
import { Toolbar } from './components/Toolbar';
import { LayersPanel } from './components/LayersPanel';
import { CanvasArea } from './components/CanvasArea';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ExportModal } from './components/ExportModal';
import { ShortcutsGuideModal } from './components/ShortcutsGuideModal';
import { NewCanvasModal } from './components/NewCanvasModal';
import { ClipboardGuideModal } from './components/ClipboardGuideModal';
import { exportRegionToRaster } from './utils/rasterExport';
import { getContentBounds } from './utils/canvasFit';
import {
  extractImageSlice,
  getImageLocalIntersection,
  punchHoleInImageElement,
  removeImageBackground,
} from './utils/imageEdit';
import { buildRadialPreview, normalizeAngle } from './utils/radialArray';
import { useDocumentHistory } from './hooks/useDocumentHistory';
import { recallDocument, rememberDocument } from './utils/documentSession';
import { validateProjectData, formatProjectErrors } from './utils/projectSchema';
import {
  canApplyElementMutation,
  canDeleteLayer,
  canEditElement,
  canEditLayer,
  elementsRemainingAfterClear,
  filterEditableElements,
  isLayerLocked,
} from './utils/lockGuards';
import { cloneElements, remapRadialInstanceGroups } from './utils/cloneElements';
import {
  shouldBlockDocumentPaste,
  shouldBlockDocumentShortcut,
} from './utils/documentShortcuts';

const INITIAL_CONFIG: CanvasConfig = {
  width: 1280,
  height: 720,
  backgroundColor: '#FFFFFF',
  showGrid: false,
  showRulers: true,
  snapToGrid: false,
  gridSize: 20,
};

const INITIAL_LAYERS: Layer[] = [
  {
    id: 'layer-1',
    name: '레이어1',
    visible: true,
    locked: false,
    opacity: 1,
  },
];

/** Next free name in 레이어1, 레이어2, … form */
function nextLayerName(existing: Layer[]): string {
  let max = 0;
  for (const layer of existing) {
    const m = /^레이어(\d+)$/.exec(layer.name.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let n = max + 1;
  if (n < 1) n = 1;
  while (existing.some((l) => l.name === `레이어${n}`)) n += 1;
  return `레이어${n}`;
}

const INITIAL_ELEMENTS: CanvasElement[] = [];

/** Offset when pasting / duplicating objects (right + down) */
const PASTE_OFFSET_PX = 10;

function initialSnapshot() {
  const recalled = recallDocument();
  if (recalled) return recalled;
  return {
    elements: INITIAL_ELEMENTS,
    layers: INITIAL_LAYERS,
    activeLayerId: INITIAL_LAYERS[0].id,
    canvasConfig: INITIAL_CONFIG,
  };
}

export default function App() {
  const recovered = useMemo(() => initialSnapshot(), []);

  // State
  const [config, setConfig] = useState<CanvasConfig>(recovered.canvasConfig);
  const [layers, setLayers] = useState<Layer[]>(recovered.layers);
  const [activeLayerId, setActiveLayerId] = useState<string>(recovered.activeLayerId);
  const [elements, setElements] = useState<CanvasElement[]>(recovered.elements);

  // Multi-element selection state
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const selectedElementId = selectedElementIds[selectedElementIds.length - 1] || null;

  // Persistent shape styling (Feature 5: applied to subsequent shapes)
  const [lastShapeStyle, setLastShapeStyle] = useState<ShapeStylePreset>({
    fill: 'none',
    stroke: '#FF0000',
    strokeWidth: 2,
    strokeDash: 'solid',
    cornerRadius: 16,
    opacity: 1,
  });

  // Tool & styling state
  const [currentTool, setCurrentTool] = useState<ToolType>('select');
  const [selectedShapeType, setSelectedShapeType] = useState<ShapeType>('rounded-rect');
  const [primaryColor, setPrimaryColor] = useState<string>('#FF0000');
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [zoom, setZoom] = useState<number>(0.9);
  const [zoomFitActive, setZoomFitActive] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);

  // Modals
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isNewCanvasOpen, setIsNewCanvasOpen] = useState(false);
  const [isClipboardGuideOpen, setIsClipboardGuideOpen] = useState(false);

  // Toast feedback message
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Left & Right Panels Collapse State
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

  // PowerPoint-style Image Cropping State
  const [croppingImageId, setCroppingImageId] = useState<string | null>(null);
  const [activeImgCropBox, setActiveImgCropBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const activeImgCropBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Canvas-wide Crop Box State (for Screen/Canvas Region Capture)
  const activeCanvasCropBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastMouseCanvasPosRef = useRef<{ x: number; y: number } | null>(null);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // Internal Clipboard for Object Copy/Cut and Image Slice Cut/Copy
  const internalClipboardRef = useRef<{
    type: 'image-slice' | 'elements';
    imageSlice?: {
      src: string;
      width: number;
      height: number;
      naturalWidth: number;
      naturalHeight: number;
      suggestedX?: number;
      suggestedY?: number;
    };
    elements?: CanvasElement[];
  } | null>(null);

  // Size of the last PNG we exported to the OS clipboard (null = we didn't).
  // Used to tell "our own leftover export" apart from a NEW OS screenshot on paste.
  const lastWrittenPngSizeRef = useRef<number | null>(null);

  // Export a PNG blob to the OS clipboard so OTHER apps can paste it.
  // Returns true when the OS-level write actually succeeded.
  const writeImageBlobToSystemClipboard = useCallback(
    async (blob: Blob | null | undefined): Promise<boolean> => {
      lastWrittenPngSizeRef.current = null;
      if (!blob) return false;
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          lastWrittenPngSizeRef.current = blob.size;
          return true;
        } catch (e) {
          console.warn('System clipboard write failed:', e);
          showToast(
            '시스템 클립보드 복사가 거부되었습니다. 앱 화면을 마우스로 클릭해 포커스를 준 뒤 다시 시도하세요.'
          );
          return false;
        }
      }
      showToast('이 브라우저는 시스템 클립보드로 PNG 내보내기를 지원하지 않습니다. Chrome/Edge를 권장합니다.');
      return false;
    },
    [showToast]
  );

  const handleStartCropImage = useCallback((id: string) => {
    const target = elementsRef.current.find((el) => el.id === id);
    if (target && !canEditElement(target, layers)) return;
    setCroppingImageId(id);
    setSelectedElementIds([id]);
    setCurrentTool('select');
  }, [layers]);

  const handleFinishCropImage = useCallback(() => {
    setCroppingImageId(null);
    setActiveImgCropBox(null);
    activeImgCropBoxRef.current = null;
  }, []);

  // Picture-crop reports the live rectangle. Ignore identical boxes so parent
  // renders do not bounce back into the canvas and reset the crop.
  const handleCropBoxChange = useCallback(
    (box: { x: number; y: number; w: number; h: number } | null) => {
      if (croppingImageId) {
        activeImgCropBoxRef.current = box;
        setActiveImgCropBox((prev) => {
          if (box === prev) return prev;
          if (!box || !prev) return box;
          if (prev.x === box.x && prev.y === box.y && prev.w === box.w && prev.h === box.h) {
            return prev;
          }
          return box;
        });
      } else {
        activeCanvasCropBoxRef.current = box;
      }
    },
    [croppingImageId]
  );

  // Radial Object Tool State
  const [radialToolState, setRadialToolState] = useState<RadialToolState>({
    step: 'idle',
    radius: 120,
    count: 12,
    startAngle: 0,
    sweepAngle: 360,
    rotateMode: 'radial',
    previewElements: [],
  });
  /** True once the start angle is decided (first drag, or a manual panel edit) */
  const radialAngleLockedRef = useRef(false);

  // ---------------------------------------------------------------------
  // Radial Object Tool (방사상 배열)
  // ---------------------------------------------------------------------
  /** Enter the radial tool with `source` as the element that gets replicated. */
  const handleRadialStart = useCallback(
    (source: CanvasElement) => {
      radialAngleLockedRef.current = false;
      
      // If the source element is part of a group, get all elements in that group
      const sourceElements = source.groupId
        ? elements.filter((el) => el.groupId === source.groupId)
        : [source];
      
      // Calculate bounding box of the source element(s)
      let baseWidth: number, baseHeight: number;
      if (sourceElements.length === 1) {
        baseWidth = sourceElements[0].width;
        baseHeight = sourceElements[0].height;
      } else {
        // Calculate bounding box of the group
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of sourceElements) {
          minX = Math.min(minX, el.x);
          minY = Math.min(minY, el.y);
          maxX = Math.max(maxX, el.x + el.width);
          maxY = Math.max(maxY, el.y + el.height);
        }
        baseWidth = maxX - minX;
        baseHeight = maxY - minY;
      }
      
      const baseSize = Math.max(baseWidth, baseHeight, 24);
      setRadialToolState({
        step: 'placing_center',
        radius: Math.max(120, Math.round(baseSize * 2)),
        count: 12,
        startAngle: 0,
        sweepAngle: 360,
        rotateMode: 'radial',
        sourceElement: source,
        sourceElements: sourceElements, // Store all elements in the group
        previewElements: [],
      });
      showToast('① 캔버스를 클릭해 중심점 지정 → ② 마우스로 반지름 조절 → ③ Enter 확정');
    },
    [elements, showToast]
  );

  /**
   * Start the radial tool with the given element as the source.
   * Used by the "방사상 복제" shortcut in the properties panel.
   */
  const handleCreateRadialArray = useCallback(
    (source: CanvasElement) => {
      handleRadialStart(source);
      setCurrentTool('radial');
    },
    [handleRadialStart]
  );

  /** First click: the center of the array is placed. */
  const handleRadialSetCenter = useCallback((x: number, y: number) => {
    radialAngleLockedRef.current = false;
    setRadialToolState((prev) => ({
      ...prev,
      step: 'adjusting_radius',
      center: { x, y },
      previewElements: [],
    }));
  }, []);

  /** Lock / unlock the radius (while unlocked it follows the cursor). */
  const handleRadialSetStep = useCallback((step: RadialStep) => {
    setRadialToolState((prev) => ({ ...prev, step }));
  }, []);

  /**
   * Live-update the radius.
   * The very first drag after the center is placed also decides the start angle.
   */
  const handleRadialUpdateRadius = useCallback((radius: number, angle?: number) => {
    const takeAngle = !radialAngleLockedRef.current && angle !== undefined;
    if (takeAngle) radialAngleLockedRef.current = true;

    setRadialToolState((prev) => ({
      ...prev,
      radius: Math.max(1, radius),
      startAngle: takeAngle ? normalizeAngle(angle as number) : prev.startAngle,
    }));
  }, []);

  const handleRadialUpdateCount = useCallback((count: number) => {
    setRadialToolState((prev) => ({
      ...prev,
      count: Math.max(2, Math.min(50, Math.round(count) || 2)),
    }));
  }, []);

  const handleRadialUpdateSweepAngle = useCallback((angle: number) => {
    setRadialToolState((prev) => ({
      ...prev,
      sweepAngle: Math.max(0, Math.min(360, Math.round(angle) || 0)),
    }));
  }, []);

  const handleRadialUpdateStartAngle = useCallback((angle: number) => {
    radialAngleLockedRef.current = true;
    setRadialToolState((prev) => ({
      ...prev,
      startAngle: normalizeAngle(angle),
    }));
  }, []);

  const handleRadialUpdateRadiusValue = useCallback((radius: number) => {
    setRadialToolState((prev) => ({ ...prev, radius: Math.max(1, Math.round(radius) || 1) }));
  }, []);

  const handleRadialSetRotateMode = useCallback((mode: RadialRotateMode) => {
    setRadialToolState((prev) => ({ ...prev, rotateMode: mode }));
  }, []);

  const handleRadialToggleHideSource = useCallback((hide: boolean) => {
    setRadialToolState((prev) => ({ ...prev, hideSource: hide }));
  }, []);

  const handleRadialCancel = useCallback(() => {
    radialAngleLockedRef.current = false;
    setRadialToolState({
      step: 'idle',
      radius: 120,
      count: 12,
      startAngle: 0,
      sweepAngle: 360,
      rotateMode: 'radial',
      previewElements: [],
    });
    showToast('방사상 배열을 취소했습니다.');
  }, [showToast]);

  // Switching tools: canvas crop must not keep selection/transform active
  const handleSelectTool = useCallback(
    (tool: ToolType) => {
      if (tool === 'crop') {
        setSelectedElementIds([]);
        setCroppingImageId(null);
        setActiveImgCropBox(null);
        activeImgCropBoxRef.current = null;
      } else if (tool !== 'select' && croppingImageId) {
        setCroppingImageId(null);
        setActiveImgCropBox(null);
        activeImgCropBoxRef.current = null;
      }

      if (tool === 'radial') {
        // The currently selected element is the one that gets replicated.
        const source = selectedElementId
          ? elements.find((e) => e.id === selectedElementId)
          : undefined;
        if (!source) {
          showToast('방사상 배열을 만들려면 먼저 복제할 객체를 선택하세요.');
          setCurrentTool('select');
          return;
        }
        handleRadialStart(source);
        setCurrentTool('radial');
        return;
      }

      // Leaving the radial tool clears the preview.
      if (radialToolState.step !== 'idle') {
        setRadialToolState((prev) => ({
          ...prev,
          step: 'idle',
          previewElements: [],
          center: undefined,
          sourceElement: undefined,
        }));
      }
      setCurrentTool(tool);
    },
    [
      croppingImageId,
      elements,
      selectedElementId,
      radialToolState.step,
      showToast,
      handleRadialStart,
    ]
  );

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelOpen((prev) => !prev);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setIsRightPanelOpen((prev) => !prev);
  }, []);

  /**
   * Rebuild the preview copies whenever one of the radial parameters changes
   * (radius, count, sweep, start angle, rotation, …).
   */
  useEffect(() => {
    setRadialToolState((prev) => {
      if (prev.step === 'idle' || !prev.center || !prev.sourceElement) {
        return prev.previewElements.length > 0 ? { ...prev, previewElements: [] } : prev;
      }
      return { ...prev, previewElements: buildRadialPreview(prev, activeLayerId) };
    });
  }, [
    activeLayerId,
    radialToolState.center,
    radialToolState.radius,
    radialToolState.count,
    radialToolState.startAngle,
    radialToolState.sweepAngle,
    radialToolState.rotateMode,
    radialToolState.sourceElement,
  ]);


  // History for Undo / Redo (commit always records; undo/redo never skip the next edit)
  const {
    canUndo,
    canRedo,
    commit: commitHistorySnapshot,
    undo: undoHistorySnapshot,
    redo: redoHistorySnapshot,
    reset: resetHistorySnapshot,
  } = useDocumentHistory(recovered);

  const pushHistory = useCallback(
    (
      newElements: CanvasElement[],
      newLayers: Layer[],
      newConfig: CanvasConfig,
      nextActiveLayerId?: string
    ) => {
      const snapshot: HistorySnapshot = {
        elements: newElements,
        layers: newLayers,
        activeLayerId: nextActiveLayerId ?? activeLayerId,
        canvasConfig: newConfig,
      };
      commitHistorySnapshot(snapshot);
    },
    [commitHistorySnapshot, activeLayerId]
  );

  const applySnapshot = useCallback((snap: HistorySnapshot) => {
    setElements(snap.elements);
    elementsRef.current = snap.elements;
    setLayers(snap.layers);
    setActiveLayerId(snap.activeLayerId);
    setConfig(snap.canvasConfig);
    rememberDocument(snap);
    setSelectedElementIds((prev) =>
      prev.filter((id) => snap.elements.some((el) => el.id === id))
    );
    setCroppingImageId((prev) => {
      if (prev && !snap.elements.some((el) => el.id === prev)) {
        return null;
      }
      return prev;
    });
    if (croppingImageId && !snap.elements.some((el) => el.id === croppingImageId)) {
      setActiveImgCropBox(null);
      activeImgCropBoxRef.current = null;
    }
  }, [croppingImageId]);

  /**
   * Turn the preview copies into real elements.
   * Defined after pushHistory so the history snapshot can be pushed directly.
   */
  const handleRadialConfirm = useCallback(() => {
    const { center, previewElements, hideSource, sourceElement, sourceElements } = radialToolState;
    if (!center || previewElements.length === 0) {
      showToast('방사상 위치를 먼저 지정하세요.');
      return;
    }
    const stamp = Date.now();
    const sourceCount =
      sourceElements && sourceElements.length > 0
        ? sourceElements.length
        : sourceElement
          ? 1
          : 1;
    const remapped = remapRadialInstanceGroups(
      previewElements,
      sourceCount,
      `radial-commit-${stamp}`
    );
    const newElements = remapped.map((el, i) => ({
      ...el,
      id: `radial-${stamp}-${i}`,
      name: el.name.replace(/\s*\(방사상.*\)$/, ''),
    }));
    // Optionally hide the source so only the finished ring remains.
    const nextElements = hideSource && sourceElement
      ? [
          ...elements.map((el) => {
            const hideTarget =
              (sourceElement.groupId && el.groupId === sourceElement.groupId) ||
              el.id === sourceElement.id;
            if (!hideTarget) return el;
            if (!canEditElement(el, layers)) return el;
            return { ...el, visible: false };
          }),
          ...newElements,
        ]
      : [...elements, ...newElements];
    setElements(nextElements);
    setSelectedElementIds(newElements.map((e) => e.id));
    pushHistory(nextElements, layers, config);
    radialAngleLockedRef.current = false;
    setRadialToolState((prev) => ({
      ...prev,
      step: 'idle',
      previewElements: [],
      center: undefined,
      sourceElement: undefined,
      sourceElements: undefined,
    }));
    showToast(`방사상 배열 ${newElements.length}개를 생성했습니다.`);
  }, [radialToolState, elements, layers, config, pushHistory, showToast]);

  // Undo Handler
  const handleUndo = useCallback(() => {
    const snap = undoHistorySnapshot();
    if (snap) applySnapshot(snap);
  }, [undoHistorySnapshot, applySnapshot]);

  // Redo Handler
  const handleRedo = useCallback(() => {
    const snap = redoHistorySnapshot();
    if (snap) applySnapshot(snap);
  }, [redoHistorySnapshot, applySnapshot]);

  // Selection handlers ??sync selected object's color/style for subsequent drawing
  const handleSelectElement = useCallback(
    (id: string | null) => {
      setSelectedElementIds(id ? [id] : []);
      if (!id) return;

      const target = elements.find((e) => e.id === id);
      if (!target) return;

      if (target.type === 'shape') {
        const isLineShape =
          target.shapeType === 'line' ||
          target.shapeType.startsWith('line-arrow') ||
          target.shapeType === 'polyline' || target.shapeType === 'arc';

        if (isLineShape) {
          setSelectedShapeType(target.shapeType);
          if (target.stroke && target.stroke !== 'none') {
            setPrimaryColor(target.stroke);
          }
          if (target.strokeWidth) {
            setStrokeWidth(target.strokeWidth);
          }
          setLastShapeStyle((prev) => ({
            ...prev,
            stroke: target.stroke !== 'none' ? target.stroke : prev.stroke,
            strokeWidth: target.strokeWidth,
            strokeDash: target.strokeDash,
            opacity: target.opacity,
            shadow: target.shadow,
            gradient: target.gradient?.enabled
              ? { ...target.gradient, enabled: false }
              : prev.gradient
                ? { ...prev.gradient, enabled: false }
                : undefined,
          }));
        } else {
          setSelectedShapeType(target.shapeType);
          const fillColor =
            target.fill && target.fill !== 'none'
              ? target.fill
              : target.gradient?.enabled
                ? target.gradient.startColor
                : null;
          if (fillColor) {
            setPrimaryColor(fillColor);
          } else if (target.stroke && target.stroke !== 'none') {
            setPrimaryColor(target.stroke);
          }
          if (target.strokeWidth) {
            setStrokeWidth(target.strokeWidth);
          }
          setLastShapeStyle((prev) => ({
            ...prev,
            fill: fillColor || prev.fill,
            stroke:
              target.stroke && target.stroke !== 'none' ? target.stroke : fillColor || prev.stroke,
            strokeWidth: target.strokeWidth,
            strokeDash: target.strokeDash,
            cornerRadius: target.cornerRadius ?? prev.cornerRadius,
            opacity: target.opacity,
            gradient: target.gradient,
            shadow: target.shadow,
          }));
        }
      } else if (target.type === 'brush') {
        setPrimaryColor(target.color);
        setStrokeWidth(
          target.isHighlighter
            ? Math.max(2, Math.round(target.strokeWidth / 3))
            : target.strokeWidth
        );
        setLastShapeStyle((prev) => ({
          ...prev,
          fill: target.color,
          stroke: target.color,
          strokeWidth: target.isHighlighter
            ? Math.max(2, Math.round(target.strokeWidth / 3))
            : target.strokeWidth,
          gradient: prev.gradient ? { ...prev.gradient, enabled: false } : undefined,
        }));
      } else if (target.type === 'text') {
        setPrimaryColor(target.color);
        setLastShapeStyle((prev) => ({
          ...prev,
          fill: target.color,
          stroke: target.color,
          gradient: prev.gradient ? { ...prev.gradient, enabled: false } : undefined,
        }));
      }
    },
    [elements]
  );

  const handleSelectMultipleElements = useCallback((ids: string[]) => {
    setSelectedElementIds(ids);
  }, []);

  const handleToggleSelectElement = useCallback((id: string, isShift: boolean) => {
    setSelectedElementIds((prev) => {
      if (isShift) {
        if (prev.includes(id)) {
          return prev.filter((item) => item !== id);
        } else {
          return [...prev, id];
        }
      }
      return [id];
    });
  }, []);

  // Clear Canvas — locked objects and objects on locked layers are kept
  const handleClearCanvas = () => {
    if (window.confirm('캔버스의 모든 요소를 비우시겠습니까?')) {
      const nextElements = elementsRemainingAfterClear(elements, layers);
      setElements(nextElements);
      elementsRef.current = nextElements;
      setSelectedElementIds((prev) =>
        prev.filter((id) => nextElements.some((el) => el.id === id))
      );
      pushHistory(nextElements, layers, config);
      const removed = elements.length - nextElements.length;
      if (removed === 0 && elements.length > 0) {
        showToast('잠긴 객체는 지우지 않았습니다.');
      } else if (nextElements.length > 0) {
        showToast(`잠긴 객체 ${nextElements.length}개는 그대로 두었습니다.`);
      }
    }
  };

  // Add Element
  const handleAddElement = useCallback(
    (newElem: CanvasElement) => {
      const targetLayer = layers.find((l) => l.id === newElem.layerId);
      if (!canEditLayer(targetLayer)) return;
      const next = [...elements, newElem];
      setElements(next);
      if (newElem.type === 'shape') {
        const isLineShape =
          newElem.shapeType === 'line' ||
          newElem.shapeType.startsWith('line-arrow') ||
          newElem.shapeType === 'polyline' || newElem.shapeType === 'arc';
        if (isLineShape) {
          setSelectedShapeType(newElem.shapeType);
          if (newElem.stroke && newElem.stroke !== 'none') {
            setPrimaryColor(newElem.stroke);
          }
          if (newElem.strokeWidth) {
            setStrokeWidth(newElem.strokeWidth);
          }
        } else if (newElem.fill && newElem.fill !== 'none') {
          setPrimaryColor(newElem.fill);
        }
        setLastShapeStyle((prev) => ({
          ...prev,
          fill: isLineShape
            ? prev.fill
            : newElem.fill && newElem.fill !== 'none'
              ? newElem.fill
              : prev.fill,
          stroke: newElem.stroke && newElem.stroke !== 'none' ? newElem.stroke : prev.stroke,
          strokeWidth: newElem.strokeWidth,
          strokeDash: newElem.strokeDash,
          cornerRadius: newElem.cornerRadius ?? prev.cornerRadius,
          opacity: newElem.opacity,
          gradient: newElem.gradient?.enabled ? newElem.gradient : undefined,
          shadow: newElem.shadow,
        }));
      } else if (newElem.type === 'brush') {
        setPrimaryColor(newElem.color);
        setLastShapeStyle((prev) => ({
          ...prev,
          fill: newElem.color,
          stroke: newElem.color,
          strokeWidth: newElem.isHighlighter
            ? Math.max(2, Math.round(newElem.strokeWidth / 3))
            : newElem.strokeWidth,
          gradient: prev.gradient ? { ...prev.gradient, enabled: false } : undefined,
        }));
      } else if (newElem.type === 'text') {
        setPrimaryColor(newElem.color);
        setSelectedElementIds([newElem.id]);
        setLastShapeStyle((prev) => ({
          ...prev,
          fill: newElem.color,
          stroke: newElem.color,
          gradient: prev.gradient ? { ...prev.gradient, enabled: false } : undefined,
        }));
      }
      pushHistory(next, layers, config);
    },
    [elements, layers, config, pushHistory]
  );

  // Update Element (skipHistory: live drag/resize — commit once on mouse up)
  const handleUpdateElement = useCallback(
    (updated: CanvasElement, options?: { skipHistory?: boolean }) => {
      const existing = elementsRef.current.find((el) => el.id === updated.id);
      if (existing && !canApplyElementMutation(existing, updated, layers)) {
        return;
      }
      const next = elementsRef.current.map((el) => (el.id === updated.id ? updated : el));
      elementsRef.current = next;
      setElements(next);
      // Feature 5: Keep style persistent for future shapes & lines
      if (updated.type === 'shape') {
        const isLineShape = updated.shapeType === 'line' || updated.shapeType.startsWith('line-arrow') || updated.shapeType === 'polyline' || updated.shapeType === 'arc';
        if (isLineShape) {
          // Keep line shape type sticky for next drawings
          setSelectedShapeType(updated.shapeType);
          if (updated.stroke && updated.stroke !== 'none') {
            setPrimaryColor(updated.stroke);
          }
          if (updated.strokeWidth) {
            setStrokeWidth(updated.strokeWidth);
          }
        } else if (updated.fill && updated.fill !== 'none') {
          setPrimaryColor(updated.fill);
        }

        setLastShapeStyle((prev) => ({
          ...prev,
          fill: isLineShape
            ? prev.fill
            : updated.fill && updated.fill !== 'none'
              ? updated.fill
              : prev.fill,
          stroke: updated.stroke && updated.stroke !== 'none' ? updated.stroke : prev.stroke,
          strokeWidth: updated.strokeWidth,
          strokeDash: updated.strokeDash,
          cornerRadius: updated.cornerRadius ?? prev.cornerRadius,
          opacity: updated.opacity,
          gradient: updated.gradient?.enabled ? updated.gradient : undefined,
          shadow: updated.shadow,
        }));
      } else if (updated.type === 'brush') {
        setPrimaryColor(updated.color);
        setLastShapeStyle((prev) => ({
          ...prev,
          fill: updated.color,
          stroke: updated.color,
          strokeWidth: updated.isHighlighter
            ? Math.max(2, Math.round(updated.strokeWidth / 3))
            : updated.strokeWidth,
          gradient: prev.gradient ? { ...prev.gradient, enabled: false } : undefined,
        }));
      } else if (updated.type === 'text') {
        setPrimaryColor(updated.color);
        setLastShapeStyle((prev) => ({
          ...prev,
          fill: updated.color,
          stroke: updated.color,
          gradient: prev.gradient ? { ...prev.gradient, enabled: false } : undefined,
        }));
      }
      if (!options?.skipHistory) {
        pushHistory(next, layers, config);
      }
    },
    [layers, config, pushHistory]
  );

  // Batch-update multiple elements in one commit (group move / multi-edit)
  const handleUpdateElements = useCallback(
    (updatedList: CanvasElement[], options?: { skipHistory?: boolean }) => {
      if (updatedList.length === 0) return;
      const map = new Map(updatedList.map((u) => [u.id, u]));
      const next = elementsRef.current.map((el) => {
        const updated = map.get(el.id);
        if (!updated) return el;
        if (!canApplyElementMutation(el, updated, layers)) return el;
        return updated;
      });
      elementsRef.current = next;
      setElements(next);
      if (!options?.skipHistory) {
        pushHistory(next, layers, config);
      }
    },
    [layers, config, pushHistory]
  );

  // Commit live edits (e.g. finished drag) as a single undo step
  const handleCommitHistory = useCallback(() => {
    pushHistory(elementsRef.current, layers, config);
  }, [layers, config, pushHistory]);

  /** Keep only the selected crop region (남기기) — same as canvas crop toolbar Enter */
  const handleApplyCropImage = useCallback(async () => {
    const crop = activeImgCropBoxRef.current || activeImgCropBox;
    if (!croppingImageId || !crop || crop.w < 10 || crop.h < 10) return;
    const imgElem = elements.find(
      (el) => el.id === croppingImageId && el.type === 'image'
    ) as ImageElement | undefined;
    if (!imgElem) return;
    try {
      const slice = await extractImageSlice(imgElem, crop);
      handleUpdateElement({
        ...imgElem,
        src: slice.src,
        x: Math.round(imgElem.x + crop.x),
        y: Math.round(imgElem.y + crop.y),
        width: Math.round(crop.w),
        height: Math.round(crop.h),
        naturalWidth: slice.naturalWidth,
        naturalHeight: slice.naturalHeight,
      });
      handleFinishCropImage();
    } catch (err) {
      console.error('Failed to apply image crop:', err);
      showToast('그림 자르기 적용 중 오류가 발생했습니다.');
    }
  }, [
    croppingImageId,
    activeImgCropBox,
    elements,
    handleUpdateElement,
    handleFinishCropImage,
    showToast,
  ]);

  // Delete Element (single or multiple)
  const handleDeleteElement = useCallback(
    (id: string) => {
      const target = elements.find((el) => el.id === id);
      if (target && !canEditElement(target, layers)) return;
      const next = elements.filter((el) => el.id !== id);
      setElements(next);
      elementsRef.current = next;
      setSelectedElementIds((prev) => prev.filter((item) => item !== id));
      pushHistory(next, layers, config);
    },
    [elements, layers, config, pushHistory]
  );

  const handleDeleteSelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return;
    const removable = new Set(
      filterEditableElements(
        elements.filter((el) => selectedElementIds.includes(el.id)),
        layers
      ).map((el) => el.id)
    );
    if (removable.size === 0) return;
    const next = elements.filter((el) => !removable.has(el.id));
    setElements(next);
    elementsRef.current = next;
    setSelectedElementIds((prev) => prev.filter((id) => !removable.has(id)));
    pushHistory(next, layers, config);
  }, [elements, selectedElementIds, layers, config, pushHistory]);

  // Duplicate Element (single or multiple)
  const handleDuplicateElement = useCallback(
    (el: CanvasElement) => {
      const [dup] = cloneElements([el], {
        offsetX: PASTE_OFFSET_PX,
        offsetY: PASTE_OFFSET_PX,
        nameSuffix: ' (복제)',
      });
      const next = [...elements, dup];
      setElements(next);
      elementsRef.current = next;
      setSelectedElementIds([dup.id]);
      pushHistory(next, layers, config);
    },
    [elements, layers, config, pushHistory]
  );

  // Create a mirror (flipped duplicate) of the selected element, placed
  // flush against it so the pair reads as one reflected image.
  const handleCreateMirrorElement = useCallback(
    (axis: 'h' | 'v') => {
      const source = elements.find((el) => selectedElementIds.includes(el.id));
      if (!source) return;
      const [mirrored] = cloneElements([source], {
        offsetX: axis === 'h' ? source.width : 0,
        offsetY: axis === 'v' ? source.height : 0,
        nameSuffix: ' (거울상)',
      });
      mirrored.flipH = axis === 'h' ? !(source.flipH ?? false) : (source.flipH ?? false);
      mirrored.flipV = axis === 'v' ? !(source.flipV ?? false) : (source.flipV ?? false);
      const next = [...elements, mirrored];
      setElements(next);
      setSelectedElementIds([mirrored.id]);
      pushHistory(next, layers, config);
      showToast(
        axis === 'h'
          ? '좌우 거울상 복제를 만들었습니다. (원본 오른쪽에 붙음)'
          : '상하 거울상 복제를 만들었습니다. (원본 아래에 붙음)'
      );
    },
    [elements, selectedElementIds, layers, config, pushHistory, showToast]
  );

  const handleDuplicateSelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return;
    const toDuplicate = elements.filter((el) => selectedElementIds.includes(el.id));
    if (toDuplicate.length === 0) return;
    const newItems = cloneElements(toDuplicate, {
      offsetX: PASTE_OFFSET_PX,
      offsetY: PASTE_OFFSET_PX,
      nameSuffix: ' (복제)',
    });
    const next = [...elements, ...newItems];
    setElements(next);
    elementsRef.current = next;
    setSelectedElementIds(newItems.map((item) => item.id));
    pushHistory(next, layers, config);
  }, [elements, selectedElementIds, layers, config, pushHistory]);

  // Crop Canvas: crops the entire canvas to specified bounding box and repositions all elements atomically
  const handleCropCanvas = useCallback(
    (crop: { x: number; y: number; w: number; h: number }) => {
      if (crop.w < 20 || crop.h < 20) return;
      const nextConfig: CanvasConfig = {
        ...config,
        width: Math.round(crop.w),
        height: Math.round(crop.h),
      };
      const nextElements = elements.map((el) => {
        const nextX = Math.round(el.x - crop.x);
        const nextY = Math.round(el.y - crop.y);
        if (el.type === 'brush' && el.points) {
          return {
            ...el,
            x: nextX,
            y: nextY,
            points: el.points.map((p) => ({
              x: Math.round(p.x - crop.x),
              y: Math.round(p.y - crop.y),
            })),
          };
        }
        return {
          ...el,
          x: nextX,
          y: nextY,
        };
      });
      setConfig(nextConfig);
      setElements(nextElements);
      pushHistory(nextElements, layers, nextConfig);
      showToast(`캔버스가 ${nextConfig.width}×${nextConfig.height}px 크기로 잘렸습니다.`);
    },
    [config, elements, layers, pushHistory, showToast]
  );

  // Fit Canvas To Content: 객체 최대 범위에 맞춰 한 번에 캔버스 축소
  const handleFitCanvasToContent = useCallback(() => {
    const bounds = getContentBounds(elements, layers);
    if (!bounds) {
      showToast('캔버스에 맞춰줄 객체가 없습니다.');
      return;
    }
    const nextWidth = Math.min(4000, Math.max(1, Math.round(bounds.w)));
    const nextHeight = Math.min(4000, Math.max(1, Math.round(bounds.h)));
    const nextX = Math.round(bounds.x);
    const nextY = Math.round(bounds.y);
    if (
      nextX === 0 &&
      nextY === 0 &&
      nextWidth === config.width &&
      nextHeight === config.height
    ) {
      showToast('이미 콘텐츠 크기에 맞습니다.');
      return;
    }
    const nextConfig: CanvasConfig = {
      ...config,
      width: nextWidth,
      height: nextHeight,
    };
    const nextElements = elements.map((el) => {
      const nextElX = Math.round(el.x - nextX);
      const nextElY = Math.round(el.y - nextY);
      if (el.type === 'brush' && el.points) {
        return {
          ...el,
          x: nextElX,
          y: nextElY,
          points: el.points.map((p) => ({
            x: Math.round(p.x - nextX),
            y: Math.round(p.y - nextY),
          })),
        };
      }
      return {
        ...el,
        x: nextElX,
        y: nextElY,
      };
    });
    setConfig(nextConfig);
    setElements(nextElements);
    pushHistory(nextElements, layers, nextConfig);
    showToast(`캔버스를 콘텐츠 크기 ${nextWidth}×${nextHeight}px에 맞췄습니다.`);
  }, [config, elements, layers, pushHistory, showToast]);

  // Cut Screen/Canvas Dragged Region (Ctrl+X when Crop box is active)
  // Punches transparent holes in intersecting images; slice goes to clipboard only (not placed on canvas).
  const handleCutCanvasRegion = useCallback(
    async (region: { x: number; y: number; w: number; h: number }) => {
      if (region.w < 5 || region.h < 5) return;
      try {
        const { dataUrl, blob } = await exportRegionToRaster(
          layers,
          elements,
          config,
          region,
          1,
          false
        );

        const sliceW = Math.round(region.w);
        const sliceH = Math.round(region.h);
        const sliceX = Math.round(region.x);
        const sliceY = Math.round(region.y);

        internalClipboardRef.current = {
          type: 'image-slice',
          imageSlice: {
            src: dataUrl,
            width: sliceW,
            height: sliceH,
            naturalWidth: sliceW,
            naturalHeight: sliceH,
            suggestedX: sliceX + PASTE_OFFSET_PX,
            suggestedY: sliceY + PASTE_OFFSET_PX,
          },
        };

        if (blob) {
          await writeImageBlobToSystemClipboard(blob);
        }

        const regRight = region.x + region.w;
        const regBottom = region.y + region.h;

        const keptSlots: CanvasElement[] = [];
        const punchById = new Map<string, Promise<ImageElement>>();

        for (const el of elements) {
          const editable = canEditElement(el, layers);
          const elRight = el.x + el.width;
          const elBottom = el.y + el.height;
          const isFullyInside =
            el.x >= region.x &&
            elRight <= regRight &&
            el.y >= region.y &&
            elBottom <= regBottom;

          // Fully inside -> remove (contents already captured in the slice)
          if (isFullyInside) {
            if (!editable) keptSlots.push(el);
            continue;
          }

          if (el.type === 'image' && editable) {
            const local = getImageLocalIntersection(el, region);
            if (local) {
              punchById.set(el.id, punchHoleInImageElement(el, local));
              keptSlots.push(el); // placeholder; replaced after punch resolves
              continue;
            }
          }

          keptSlots.push(el);
        }

        const punchedEntries = await Promise.all(
          [...punchById.entries()].map(async ([id, task]) => [id, await task] as const)
        );
        const punchedMap = new Map<string, ImageElement>(punchedEntries);

        const nextElements = keptSlots.map((el) => punchedMap.get(el.id) ?? el);
        setElements(nextElements);
        setSelectedElementIds([]);
        pushHistory(nextElements, layers, config);
        showToast('선택 영역을 오려냈습니다. Ctrl+V로 붙여넣기 하세요.');
      } catch (err) {
        console.error('Failed to cut region:', err);
        showToast('영역 오려내기 중 오류가 발생했습니다.');
      }
    },
    [layers, elements, config, pushHistory, showToast, writeImageBlobToSystemClipboard]
  );

  // Copy Screen/Canvas Dragged Region (Ctrl+C when Crop box is active)
  const handleCopyCanvasRegion = useCallback(
    async (region: { x: number; y: number; w: number; h: number }) => {
      if (region.w < 5 || region.h < 5) return;
      try {
        const { dataUrl, blob } = await exportRegionToRaster(
          layers,
          elements,
          config,
          region,
          1,
          false
        );

        internalClipboardRef.current = {
          type: 'image-slice',
          imageSlice: {
            src: dataUrl,
            width: Math.round(region.w),
            height: Math.round(region.h),
            naturalWidth: Math.round(region.w),
            naturalHeight: Math.round(region.h),
            suggestedX: Math.round(region.x + PASTE_OFFSET_PX),
            suggestedY: Math.round(region.y + PASTE_OFFSET_PX),
          },
        };

        await writeImageBlobToSystemClipboard(blob);

        showToast('지정한 화면 영역을 캡쳐 복사했습니다. (Ctrl+V로 붙여넣기)');
      } catch (err) {
        console.error('Failed to capture region:', err);
        showToast('영역 캡쳐 중 오류가 발생했습니다.');
      }
    },
    [layers, elements, config, showToast, writeImageBlobToSystemClipboard]
  );

  // Copy Selected Canvas Elements (Ctrl+C)
  const handleCopySelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return;
    const selected = elements.filter((el) => selectedElementIds.includes(el.id));
    if (selected.length === 0) return;

    internalClipboardRef.current = {
      type: 'elements',
      elements: JSON.parse(JSON.stringify(selected)),
    };
    // Replace any leftover OS clipboard image so Ctrl+V pastes these elements
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText('').catch(() => {});
    }
    lastWrittenPngSizeRef.current = null;
    showToast(`${selected.length}개 객체가 복사되었습니다. (Ctrl+V로 붙여넣기)`);
  }, [elements, selectedElementIds, showToast]);

  // Cut (오려내기/잘라내기) Selected Canvas Elements (Ctrl+X)
  const handleCutSelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return;
    const selected = filterEditableElements(
      elements.filter((el) => selectedElementIds.includes(el.id)),
      layers
    );
    if (selected.length === 0) return;

    internalClipboardRef.current = {
      type: 'elements',
      elements: JSON.parse(JSON.stringify(selected)),
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText('').catch(() => {});
    }
    lastWrittenPngSizeRef.current = null;
    handleDeleteSelectedElements();
    showToast(`${selected.length}개 객체를 잘라냈습니다. (Ctrl+V로 붙여넣기)`);
  }, [elements, selectedElementIds, layers, handleDeleteSelectedElements, showToast]);

  // Background removal: color-key from the border, clear matched pixels to transparent.
  const handleRemoveImageBackground = useCallback(
    async (imgElem: ImageElement, tolerance: number) => {
      if (!canEditElement(imgElem, layers)) return;
      try {
        showToast('배경을 제거하는 중...');
        const { element: next, removedPct } = await removeImageBackground(imgElem, tolerance);
        const nextElements = elementsRef.current.map((el) => (el.id === imgElem.id ? next : el));
        elementsRef.current = nextElements;
        setElements(nextElements);
        pushHistory(nextElements, layers, config);
        setSelectedElementIds([imgElem.id]);
        showToast(`배경을 제거했습니다. (픽셀 ${removedPct}% 지움) 경계가 거칠면 허용치를 조정해 다시 적용하세요.`);
      } catch (err) {
        console.error('Background removal failed:', err);
        const msg = err instanceof Error ? err.message : '알 수 없는 오류';
        showToast(`배경 제거 실패: ${msg}`);
      }
    },
    [elements, layers, config, pushHistory, showToast]
  );

  // Copy Selected Region of an Image (Ctrl+C in crop mode)
  const handleCopyImagePart = useCallback(
    async (imgElem: ImageElement, crop: { x: number; y: number; w: number; h: number }) => {
      if (crop.w < 5 || crop.h < 5) return;
      try {
        const slice = await extractImageSlice(imgElem, crop);

        internalClipboardRef.current = {
          type: 'image-slice',
          imageSlice: {
            src: slice.src,
            width: Math.round(crop.w),
            height: Math.round(crop.h),
            naturalWidth: slice.naturalWidth,
            naturalHeight: slice.naturalHeight,
            suggestedX: Math.round(imgElem.x + crop.x + PASTE_OFFSET_PX),
            suggestedY: Math.round(imgElem.y + crop.y + PASTE_OFFSET_PX),
          },
        };

        if (navigator.clipboard && window.ClipboardItem) {
          const res = await fetch(slice.src);
          const sliceBlob = await res.blob();
          await writeImageBlobToSystemClipboard(sliceBlob);
        }

        showToast('선택한 이미지 영역을 복사했습니다. (Ctrl+V로 붙여넣기)');
      } catch (err) {
        console.error('Failed to copy image part:', err);
        showToast('이미지 복사 중 오류가 발생했습니다.');
      }
    },
    [showToast, writeImageBlobToSystemClipboard]
  );

  // Cut (오려내기) Selected Region of an Image (Ctrl+X in crop mode)
  // Clipboard only + transparent hole in original. Do not place the slice back on canvas.
  const handleCutImagePart = useCallback(
    async (imgElem: ImageElement, crop: { x: number; y: number; w: number; h: number }) => {
      if (crop.w < 5 || crop.h < 5) return;
      if (!canEditElement(imgElem, layers)) return;
      try {
        const [slice, punched] = await Promise.all([
          extractImageSlice(imgElem, crop),
          punchHoleInImageElement(imgElem, crop),
        ]);

        const pieceX = Math.round(imgElem.x + crop.x);
        const pieceY = Math.round(imgElem.y + crop.y);
        const pieceW = Math.round(crop.w);
        const pieceH = Math.round(crop.h);

        internalClipboardRef.current = {
          type: 'image-slice',
          imageSlice: {
            src: slice.src,
            width: pieceW,
            height: pieceH,
            naturalWidth: slice.naturalWidth,
            naturalHeight: slice.naturalHeight,
            suggestedX: pieceX + PASTE_OFFSET_PX,
            suggestedY: pieceY + PASTE_OFFSET_PX,
          },
        };

        if (navigator.clipboard && window.ClipboardItem) {
          const res = await fetch(slice.src);
          const sliceBlob = await res.blob();
          await writeImageBlobToSystemClipboard(sliceBlob);
        }

        const next = elementsRef.current.map((el) => (el.id === imgElem.id ? punched : el));
        elementsRef.current = next;
        setElements(next);
        pushHistory(next, layers, config);
        setSelectedElementIds([imgElem.id]);
        setCroppingImageId(null);
        setCurrentTool('select');
        showToast('선택 영역을 오려냈습니다. Ctrl+V로 붙여넣기 하세요.');
      } catch (err) {
        console.error('Failed to cut image part:', err);
        showToast('이미지 오려내기 중 오류가 발생했습니다.');
      }
    },
    [layers, config, pushHistory, showToast, writeImageBlobToSystemClipboard]
  );

  // Bring Forward / Send Backward
  const handleBringForward = useCallback(
    (id: string) => {
      const idx = elements.findIndex((el) => el.id === id);
      if (idx < 0 || !canEditElement(elements[idx], layers)) return;
      if (idx < elements.length - 1) {
        const next = [...elements];
        const temp = next[idx];
        next[idx] = next[idx + 1];
        next[idx + 1] = temp;
        setElements(next);
        pushHistory(next, layers, config);
      }
    },
    [elements, layers, config, pushHistory]
  );

  const handleSendBackward = useCallback(
    (id: string) => {
      const idx = elements.findIndex((el) => el.id === id);
      if (idx < 0 || !canEditElement(elements[idx], layers)) return;
      if (idx > 0) {
        const next = [...elements];
        const temp = next[idx];
        next[idx] = next[idx - 1];
        next[idx - 1] = temp;
        setElements(next);
        pushHistory(next, layers, config);
      }
    },
    [elements, layers, config, pushHistory]
  );

  const handleBringToFront = useCallback(
    (id: string) => {
      const target = elements.find((el) => el.id === id);
      if (target && canEditElement(target, layers)) {
        const next = elements.filter((el) => el.id !== id).concat(target);
        setElements(next);
        pushHistory(next, layers, config);
      }
    },
    [elements, layers, config, pushHistory]
  );

  const handleSendToBack = useCallback(
    (id: string) => {
      const target = elements.find((el) => el.id === id);
      if (target && canEditElement(target, layers)) {
        const next = [target].concat(elements.filter((el) => el.id !== id));
        setElements(next);
        pushHistory(next, layers, config);
      }
    },
    [elements, layers, config, pushHistory]
  );

  // Alignment relative to canvas
  const handleAlign = useCallback(
    (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
      if (!selectedElementId) return;
      const el = elements.find((e) => e.id === selectedElementId);
      if (!el) return;

      let newX = el.x;
      let newY = el.y;

      switch (type) {
        case 'left':
          newX = 0;
          break;
        case 'center':
          newX = (config.width - el.width) / 2;
          break;
        case 'right':
          newX = config.width - el.width;
          break;
        case 'top':
          newY = 0;
          break;
        case 'middle':
          newY = (config.height - el.height) / 2;
          break;
        case 'bottom':
          newY = config.height - el.height;
          break;
      }

      handleUpdateElement({ ...el, x: newX, y: newY });
    },
    [selectedElementId, elements, config, handleUpdateElement]
  );

  // Group / Ungroup
  const handleGroup = useCallback(() => {
    if (selectedElementIds.length < 2) {
      showToast('그룹화할 객체를 2개 이상 선택하세요.');
      return;
    }
    const selected = elements.filter((el) => selectedElementIds.includes(el.id));
    if (selected.some((el) => !canEditElement(el, layers))) {
      showToast('잠긴 객체는 그룹화할 수 없습니다.');
      return;
    }
    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextElements = elements.map((el) =>
      selectedElementIds.includes(el.id) ? { ...el, groupId } : el
    );
    setElements(nextElements);
    pushHistory(nextElements, layers, config);
    showToast(`${selectedElementIds.length}개 객체를 그룹화했습니다.`);
  }, [selectedElementIds, elements, layers, config, pushHistory, showToast]);

  const handleUngroup = useCallback(() => {
    if (selectedElementIds.length === 0) {
      showToast('해제할 그룹을 선택하세요.');
      return;
    }
    const selected = elements.filter((el) => selectedElementIds.includes(el.id));
    if (selected.some((el) => !canEditElement(el, layers))) {
      showToast('잠긴 객체는 그룹 해제할 수 없습니다.');
      return;
    }
    // Find all groupIds among selected elements
    const groupIds = new Set(
      elements
        .filter((el) => selectedElementIds.includes(el.id))
        .map((el) => el.groupId)
        .filter((g): g is string => Boolean(g))
    );
    if (groupIds.size === 0) {
      showToast('선택된 객체 중 그룹화된 것이 없습니다.');
      return;
    }
    const nextElements = elements.map((el) =>
      groupIds.has(el.groupId) ? { ...el, groupId: undefined } : el
    );
    setElements(nextElements);
    pushHistory(nextElements, layers, config);
    showToast('그룹을 해제했습니다.');
  }, [selectedElementIds, elements, layers, config, pushHistory, showToast]);

  // Update Config
  const handleUpdateConfig = useCallback(
    (partial: Partial<CanvasConfig>) => {
      const next = { ...config, ...partial };
      setConfig(next);
      pushHistory(elements, layers, next);
    },
    [config, elements, layers, pushHistory]
  );

  // New document: apply the chosen canvas and drop every object from the previous one.
  const handleCreateNewCanvas = useCallback(
    (newCfg: { width: number; height: number; backgroundColor: string }) => {
      const nextLayers: Layer[] = [
        {
          id: 'layer-' + Date.now(),
          name: '레이어1',
          visible: true,
          locked: false,
          opacity: 1,
        },
      ];
      const nextElements: CanvasElement[] = [];
      const nextConfig: CanvasConfig = {
        ...config,
        width: newCfg.width,
        height: newCfg.height,
        backgroundColor: newCfg.backgroundColor,
      };
      setElements(nextElements);
      setLayers(nextLayers);
      setActiveLayerId(nextLayers[0].id);
      setSelectedElementIds([]);
      setCroppingImageId(null);
      setActiveImgCropBox(null);
      activeImgCropBoxRef.current = null;
      activeCanvasCropBoxRef.current = null;
      setConfig(nextConfig);
      resetHistorySnapshot({
        elements: nextElements,
        layers: nextLayers,
        activeLayerId: nextLayers[0].id,
        canvasConfig: nextConfig,
      });
    },
    [config, resetHistorySnapshot]
  );

  // Layers Handlers
  const handleAddLayer = () => {
    const newLayer: Layer = {
      id: 'layer-' + Date.now(),
      name: nextLayerName(layers),
      visible: true,
      locked: false,
      opacity: 1,
    };
    const nextLayers = [...layers, newLayer];
    setLayers(nextLayers);
    setActiveLayerId(newLayer.id);
    pushHistory(elements, nextLayers, config, newLayer.id);
  };

  const handleDeleteLayer = (layerId: string) => {
    const target = layers.find((l) => l.id === layerId);
    if (!canDeleteLayer(target, layers.length, elements)) {
      if (target && elements.some((el) => el.layerId === target.id && el.locked)) {
        showToast('잠긴 객체가 있는 레이어는 삭제할 수 없습니다.');
      }
      return;
    }
    const nextLayers = layers.filter((l) => l.id !== layerId);
    const nextElements = elements.filter((el) => el.layerId !== layerId);
    setLayers(nextLayers);
    setElements(nextElements);
    const nextActive = nextLayers[nextLayers.length - 1].id;
    setActiveLayerId(nextActive);
    if (selectedElementId && !nextElements.some((e) => e.id === selectedElementId)) {
      handleSelectElement(null);
    }
    pushHistory(nextElements, nextLayers, config, nextActive);
  };

  const handleDuplicateLayer = (layerId: string) => {
    const targetLayer = layers.find((l) => l.id === layerId);
    if (!targetLayer) return;

    const newLayerId = 'layer-' + Date.now();
    const newLayer: Layer = {
      ...targetLayer,
      id: newLayerId,
      name: nextLayerName(layers),
    };

    // Duplicate all elements belonging to this layer
    const layerElems = elements.filter((el) => el.layerId === layerId);
    const dupElems = cloneElements(layerElems, {
      offsetX: 15,
      offsetY: 15,
      layerId: newLayerId,
    });

    const nextLayers = [...layers, newLayer];
    const nextElements = [...elements, ...dupElems];
    setLayers(nextLayers);
    setElements(nextElements);
    setActiveLayerId(newLayerId);
    pushHistory(nextElements, nextLayers, config, newLayerId);
  };

  const handleMoveLayerUp = (layerId: string) => {
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx < layers.length - 1) {
      const next = [...layers];
      const temp = next[idx];
      next[idx] = next[idx + 1];
      next[idx + 1] = temp;
      setLayers(next);
      pushHistory(elements, next, config);
    }
  };

  const handleMoveLayerDown = (layerId: string) => {
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx > 0) {
      const next = [...layers];
      const temp = next[idx];
      next[idx] = next[idx - 1];
      next[idx - 1] = temp;
      setLayers(next);
      pushHistory(elements, next, config);
    }
  };

  /** Bring element forward within its layer (drawn later = on top). */
  const handleMoveElementForward = useCallback(
    (elementId: string) => {
      const idx = elements.findIndex((el) => el.id === elementId);
      if (idx < 0) return;
      if (!canEditElement(elements[idx], layers)) return;
      const layerId = elements[idx].layerId;
      let swapWith = -1;
      for (let i = idx + 1; i < elements.length; i++) {
        if (elements[i].layerId === layerId) {
          swapWith = i;
          break;
        }
      }
      if (swapWith < 0) return;
      const next = [...elements];
      const temp = next[idx];
      next[idx] = next[swapWith];
      next[swapWith] = temp;
      setElements(next);
      pushHistory(next, layers, config);
    },
    [elements, layers, config, pushHistory]
  );

  /** Send element backward within its layer (drawn earlier = behind). */
  const handleMoveElementBackward = useCallback(
    (elementId: string) => {
      const idx = elements.findIndex((el) => el.id === elementId);
      if (idx < 0) return;
      if (!canEditElement(elements[idx], layers)) return;
      const layerId = elements[idx].layerId;
      let swapWith = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (elements[i].layerId === layerId) {
          swapWith = i;
          break;
        }
      }
      if (swapWith < 0) return;
      const next = [...elements];
      const temp = next[idx];
      next[idx] = next[swapWith];
      next[swapWith] = temp;
      setElements(next);
      pushHistory(next, layers, config);
    },
    [elements, layers, config, pushHistory]
  );

  const handleUpdateLayer = (updated: Layer) => {
    const next = layers.map((l) => (l.id === updated.id ? updated : l));
    setLayers(next);
    pushHistory(elements, next, config);
  };

  // Insert Image from source URL or data URL
  const handleInsertImageSrc = useCallback(
    (src: string, name = '붙여넣은 이미지') => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const maxWidth = Math.min(600, config.width * 0.7);
        const naturalW = img.naturalWidth || 400;
        const naturalH = img.naturalHeight || 300;
        const ratio = naturalW / naturalH;
        const width = Math.min(maxWidth, naturalW);
        const height = width / ratio;
        let x = Math.round((config.width - width) / 2);
        let y = Math.round((config.height - height) / 2);
        if (lastMouseCanvasPosRef.current) {
          const mx = lastMouseCanvasPosRef.current.x;
          const my = lastMouseCanvasPosRef.current.y;
          if (mx >= 0 && mx <= config.width && my >= 0 && my <= config.height) {
            x = Math.round(mx - width / 2);
            y = Math.round(my - height / 2);
          }
        }
        x = Math.min(Math.max(0, x), Math.max(0, config.width - width));
        y = Math.min(Math.max(0, y), Math.max(0, config.height - height));

        const targetLayer = layers.find((l) => l.id === (activeLayerId || layers[0]?.id));
        if (!canEditLayer(targetLayer)) {
          showToast('잠긴 레이어에는 이미지를 넣을 수 없습니다.');
          return;
        }
        const newImgElem: ImageElement = {
          id: 'image-' + Date.now(),
          layerId: activeLayerId || layers[0]?.id || 'layer-default',
          name: name.substring(0, 20),
          type: 'image',
          src,
          naturalWidth: naturalW,
          naturalHeight: naturalH,
          x,
          y,
          width: Math.round(width),
          height: Math.round(height),
          rotation: 0,
          opacity: 1,
          filters: {
            brightness: 100,
            contrast: 100,
            saturation: 100,
            blur: 0,
            grayscale: 0,
            invert: 0,
          },
        };

        const next = [...elementsRef.current, newImgElem];
        elementsRef.current = next;
        setElements(next);
        pushHistory(next, layers, config);
        setSelectedElementIds([newImgElem.id]);
        setCurrentTool('select');
        showToast('클립보드 이미지를 캔버스에 붙여넣었습니다.');
      };
      img.onerror = () => {
        alert('이미지 데이터를 불러오는 데 실패했습니다.');
      };
      img.src = src;
    },
    [activeLayerId, config, layers, pushHistory, showToast]
  );

  // Insert Image file (File object)
  const handleInsertImage = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const src = e.target?.result as string;
        if (src) {
          handleInsertImageSrc(src, file.name || '삽입한 이미지');
        }
      };
      reader.readAsDataURL(file);
    },
    [handleInsertImageSrc]
  );

  // Paste only from the app's internal clipboard (cut/copy inside the app).
  // Returns true if something was pasted.
  const pasteFromInternalClipboard = useCallback((): boolean => {
    const clip = internalClipboardRef.current;
    if (!clip) return false;

    const targetLayer = layers.find((l) => l.id === activeLayerId);
    if (!canEditLayer(targetLayer)) {
      showToast('잠긴 레이어에는 붙여넣을 수 없습니다.');
      return true;
    }

    if (clip.type === 'image-slice' && clip.imageSlice) {
      const slice = clip.imageSlice;
      // Crop/cut slices paste at origin + offset (not under the mouse)
      const targetX = slice.suggestedX ?? 50;
      const targetY = slice.suggestedY ?? 50;

      const newImg: ImageElement = {
        id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'image',
        name: '오려낸 이미지',
        layerId: activeLayerId,
        x: Math.min(Math.max(0, targetX), Math.max(0, config.width - slice.width)),
        y: Math.min(Math.max(0, targetY), Math.max(0, config.height - slice.height)),
        width: slice.width,
        height: slice.height,
        src: slice.src,
        naturalWidth: slice.naturalWidth,
        naturalHeight: slice.naturalHeight,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        filters: {
          brightness: 100,
          contrast: 100,
          saturation: 100,
          blur: 0,
          grayscale: 0,
          invert: 0,
        },
      };
      slice.suggestedX = targetX + PASTE_OFFSET_PX;
      slice.suggestedY = targetY + PASTE_OFFSET_PX;

      const next = [...elementsRef.current, newImg];
      elementsRef.current = next;
      setElements(next);
      pushHistory(next, layers, config);
      setSelectedElementIds([newImg.id]);
      setCurrentTool('select');
      showToast('클립보드 이미지를 붙여넣었습니다.');
      return true;
    }

    if (clip.type === 'elements' && clip.elements) {
      const cloned = cloneElements(clip.elements, {
        offsetX: PASTE_OFFSET_PX,
        offsetY: PASTE_OFFSET_PX,
        layerId: activeLayerId,
      });

      clip.elements = cloned;

      const next = [...elementsRef.current, ...cloned];
      elementsRef.current = next;
      setElements(next);
      pushHistory(next, layers, config);
      setSelectedElementIds(cloned.map((c) => c.id));
      setCurrentTool('select');
      showToast(`${cloned.length}개 객체를 붙여넣었습니다.`);
      return true;
    }

    return false;
  }, [activeLayerId, config, layers, pushHistory, showToast]);

  // Read image/text from the OS clipboard (Windows screenshot, Snipping Tool, etc.)
  const handlePasteFromClipboard = useCallback(async (): Promise<boolean> => {
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const file = new File([blob], 'clipboard-image.png', { type: imageType });
            handleInsertImage(file);
            return true;
          }
        }
      } catch (err) {
        console.warn('Clipboard read() failed:', err);
      }
    }

    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (
          text.startsWith('data:image/') ||
          /^https?:\/\/.+\.(png|jpe?g|webp|gif|svg|bmp|avif)(\?.*)?$/i.test(text)
        ) {
          handleInsertImageSrc(text, '클립보드 이미지');
          return true;
        }
      } catch (err) {
        console.warn('Clipboard readText() failed:', err);
      }
    }

    return false;
  }, [handleInsertImage, handleInsertImageSrc]);

  // Unified Paste: app internal clipboard first (crop slice keeps origin+10px),
  // then OS clipboard (screenshots, etc.)
  const handlePasteAction = useCallback(async () => {
    if (pasteFromInternalClipboard()) return;

    const fromSystem = await handlePasteFromClipboard();
    if (fromSystem) return;

    setIsClipboardGuideOpen(true);
  }, [handlePasteFromClipboard, pasteFromInternalClipboard]);

  // Global Clipboard Paste (Ctrl+V): OS image first, then internal clipboard
  useEffect(() => {
    const extractImageFileFromClipboard = (clipboardData: DataTransfer): File | null => {
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];
          if (
            file.type.startsWith('image/') ||
            /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i.test(file.name)
          ) {
            return file;
          }
        }
      }

      if (clipboardData.items && clipboardData.items.length > 0) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.type.indexOf('image') !== -1 || item.kind === 'file') {
            const file = item.getAsFile();
            if (
              file &&
              (file.type.startsWith('image/') ||
                /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i.test(file.name) ||
                file.size > 0)
            ) {
              return file;
            }
          }
        }
      }
      return null;
    };

    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      // Clipboard guide owns paste; do not preventDefault so the zone can receive it.
      if (isClipboardGuideOpen) return;
      const modalOpen = isExportOpen || isShortcutsOpen || isNewCanvasOpen;
      if (shouldBlockDocumentPaste({ modalOpen, target })) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // 1) App-internal cut/copy first — crop slices use origin + 10px offset.
      //    Those copies also export the same PNG to the OS clipboard, so an equal
      //    size file means "our own leftover export" → paste app-internal content.
      //    But a NEW OS screenshot (Snipping Tool etc.) has different bytes → it
      //    must win, otherwise Windows captures could never be pasted in.
      if (internalClipboardRef.current) {
        const pendingImageFile = extractImageFileFromClipboard(clipboardData);
        if (
          pendingImageFile &&
          lastWrittenPngSizeRef.current !== null &&
          pendingImageFile.size !== lastWrittenPngSizeRef.current
        ) {
          e.preventDefault();
          e.stopPropagation();
          handleInsertImage(pendingImageFile);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        pasteFromInternalClipboard();
        return;
      }

      // 2) Windows / OS clipboard image (Snipping Tool, Win+Shift+S, Explorer copy, etc.)
      const imageFile = extractImageFileFromClipboard(clipboardData);
      if (imageFile) {
        e.preventDefault();
        e.stopPropagation();
        handleInsertImage(imageFile);
        return;
      }

      // 3) HTML embedded image (Word / browser)
      const html = clipboardData.getData('text/html');
      if (html) {
        const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match && match[1]) {
          e.preventDefault();
          handleInsertImageSrc(match[1], '복사한 이미지');
          return;
        }
      }

      // 4) Image URL / data-URI / SVG text
      const text = clipboardData.getData('text/plain')?.trim();
      if (text) {
        if (
          text.startsWith('data:image/') ||
          /^https?:\/\/.+\.(png|jpe?g|webp|gif|svg|bmp|avif)(\?.*)?$/i.test(text)
        ) {
          e.preventDefault();
          handleInsertImageSrc(text, 'URL 이미지');
          return;
        }
        if (text.startsWith('<svg') && text.includes('</svg>')) {
          e.preventDefault();
          const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
          handleInsertImageSrc(svgDataUrl, '붙여넣은 SVG');
          return;
        }
      }
    };

    document.addEventListener('paste', handlePaste, true);
    return () => {
      document.removeEventListener('paste', handlePaste, true);
    };
  }, [
    handleInsertImage,
    handleInsertImageSrc,
    pasteFromInternalClipboard,
    isExportOpen,
    isShortcutsOpen,
    isNewCanvasOpen,
    isClipboardGuideOpen,
  ]);

  // Save Project as JSON
  const handleSaveProject = () => {
    const projectData = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      config,
      layers,
      elements,
    };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `imgman-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Load Project from JSON
  const handleLoadProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        const result = validateProjectData(parsed);
        if (result.ok === false) {
          showToast(formatProjectErrors(result.errors));
          return;
        }
        const { config: nextConfig, layers: nextLayers, elements: nextElements } = result.data;
        const nextActive = nextLayers[0].id;
        setConfig(nextConfig);
        setLayers(nextLayers);
        setActiveLayerId(nextActive);
        setElements(nextElements);
        elementsRef.current = nextElements;
        setSelectedElementIds([]);
        setCroppingImageId(null);
        setActiveImgCropBox(null);
        activeImgCropBoxRef.current = null;
        resetHistorySnapshot({
          elements: nextElements,
          layers: nextLayers,
          activeLayerId: nextActive,
          canvasConfig: nextConfig,
        });
        showToast('프로젝트를 불러왔습니다.');
      } catch (err) {
        showToast('파일을 불러오는 중 오류가 발생했습니다. 현재 문서는 그대로 둡니다.');
      }
    };
    reader.readAsText(file);
  };

  const handlePrimaryColorChange = useCallback(
    (color: string) => {
      setPrimaryColor(color);
      // Persist for subsequent shapes / lines / paint; clear sticky gradient so solid color wins
      setLastShapeStyle((prev) => ({
        ...prev,
        fill: color,
        stroke: color,
        gradient: prev.gradient
          ? { ...prev.gradient, enabled: false, startColor: color }
          : undefined,
      }));

      // Immediately update selected element if any
      if (selectedElementIds.length > 0) {
        let hasChanges = false;
        const next = elements.map((el) => {
            if (!selectedElementIds.includes(el.id)) return el;
            if (!canEditElement(el, layers)) return el;
            hasChanges = true;
            if (el.type === 'shape') {
              const isLineShape =
                el.shapeType === 'line' ||
                el.shapeType.startsWith('line-arrow') ||
                el.shapeType === 'polyline' || el.shapeType === 'arc';
              if (isLineShape || el.fill === 'none') {
                return { ...el, stroke: color };
              }
              return {
                ...el,
                fill: color,
                gradient: el.gradient
                  ? { ...el.gradient, enabled: false, startColor: color }
                  : undefined,
              };
            } else if (el.type === 'text') {
              return { ...el, color };
            } else if (el.type === 'brush') {
              return { ...el, color };
            }
            return el;
          });
        if (hasChanges) {
          setElements(next);
          elementsRef.current = next;
          pushHistory(next, layers, config);
        }
      }
    },
    [selectedElementIds, elements, layers, config, pushHistory]
  );

  const handleStrokeWidthChange = useCallback(
    (w: number) => {
      setStrokeWidth(w);
      setLastShapeStyle((prev) => ({ ...prev, strokeWidth: w }));

      if (selectedElementIds.length > 0) {
        let hasChanges = false;
        const next = elements.map((el) => {
          if (!selectedElementIds.includes(el.id)) return el;
          if (!canEditElement(el, layers)) return el;
          hasChanges = true;
          if (el.type === 'shape') {
            const isStraightLine =
              el.shapeType === 'line' || el.shapeType.startsWith('line-arrow');
            return {
              ...el,
              strokeWidth: w,
              height: isStraightLine ? Math.max(w * 4, 16) : el.height,
            };
          } else if (el.type === 'brush') {
            return { ...el, strokeWidth: w };
          }
          return el;
        });
        if (hasChanges) {
          setElements(next);
          elementsRef.current = next;
          pushHistory(next, layers, config);
        }
      }
    },
    [selectedElementIds, elements, layers, config, pushHistory]
  );

  // Keyboard Nudge logic (Arrow keys for 1px, Shift + Arrow for 10px)
  const nudgeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isNudgingRef = useRef(false);

  const handleNudgeSelectedElements = useCallback(
    (dx: number, dy: number) => {
      if (selectedElementIds.length === 0) return;

      let changed = false;
      const nextElements = elementsRef.current.map((el) => {
        if (!selectedElementIds.includes(el.id)) return el;
        if (!canEditElement(el, layers)) return el;

        changed = true;
        const nextX = Math.round(el.x + dx);
        const nextY = Math.round(el.y + dy);

        if (el.type === 'brush' && el.points) {
          return {
            ...el,
            x: nextX,
            y: nextY,
            points: el.points.map((p) => ({
              x: Math.round(p.x + dx),
              y: Math.round(p.y + dy),
            })),
          };
        }

        return {
          ...el,
          x: nextX,
          y: nextY,
        };
      });

      if (!changed) return;
      elementsRef.current = nextElements;
      setElements(nextElements);

      if (!isNudgingRef.current) {
        isNudgingRef.current = true;
      }
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
      }
      nudgeTimerRef.current = setTimeout(() => {
        if (isNudgingRef.current) {
          pushHistory(elementsRef.current, layers, config);
          isNudgingRef.current = false;
        }
        nudgeTimerRef.current = null;
      }, 400);
    },
    [selectedElementIds, layers, config, pushHistory]
  );

  const handleHeaderZoomChange = useCallback((z: number) => {
    setZoomFitActive(false);
    setZoom(z);
  }, []);

  const handleCanvasZoomChange = useCallback((z: number, source: 'fit' | 'user' = 'user') => {
    setZoom(z);
    setZoomFitActive(source === 'fit');
  }, []);

  const handleZoomFit = useCallback(() => {
    setZoomFitActive(true);
    setFitNonce((n) => n + 1);
  }, []);

  const handleZoom100 = useCallback(() => {
    setZoomFitActive(false);
    setZoom(1);
  }, []);

  const isAnyModalOpen =
    isExportOpen || isShortcutsOpen || isNewCanvasOpen || isClipboardGuideOpen;

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        shouldBlockDocumentShortcut({
          modalOpen: isAnyModalOpen,
          target,
        })
      ) {
        return;
      }

      // Keyboard Nudge: Arrow keys for fine movement (1px), Shift + Arrow for fast movement (10px)
      if (
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !croppingImageId
      ) {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          else if (e.key === 'ArrowRight') dx = step;
          else if (e.key === 'ArrowUp') dy = -step;
          else if (e.key === 'ArrowDown') dy = step;

          handleNudgeSelectedElements(dx, dy);
          return;
        }
      }

      // Radial array: Enter confirms, Escape cancels
      if (radialToolState.step !== 'idle') {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleRadialConfirm();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          handleRadialCancel();
          return;
        }
      }

      // Escape: same as clicking the Select tool button
      if (e.key === 'Escape') {
        e.preventDefault();
        handleSelectTool('select');
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Duplicate: Ctrl+D
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedElementIds.length > 0) {
          handleDuplicateSelectedElements();
        }
        return;
      }

      // Group: Ctrl+G, Ungroup: Ctrl+Shift+G
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          handleUngroup();
        } else {
          handleGroup();
        }
        return;
      }

      // Copy: Ctrl+C (in crop mode: copy canvas region or image slice, in select mode: copy elements)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (currentTool === 'crop' && activeCanvasCropBoxRef.current && activeCanvasCropBoxRef.current.w >= 5) {
          e.preventDefault();
          handleCopyCanvasRegion(activeCanvasCropBoxRef.current);
          return;
        }
        if (croppingImageId) {
          e.preventDefault();
          const imgElem = elements.find((el) => el.id === croppingImageId && el.type === 'image') as ImageElement;
          if (imgElem && activeImgCropBoxRef.current) {
            handleCopyImagePart(imgElem, activeImgCropBoxRef.current);
          }
          return;
        }
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleCopySelectedElements();
          return;
        }
      }

      // Cut: Ctrl+X (in crop mode: cut canvas region or image slice, in select mode: cut elements)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (currentTool === 'crop' && activeCanvasCropBoxRef.current && activeCanvasCropBoxRef.current.w >= 5) {
          e.preventDefault();
          handleCutCanvasRegion(activeCanvasCropBoxRef.current);
          return;
        }
        if (croppingImageId) {
          e.preventDefault();
          const imgElem = elements.find((el) => el.id === croppingImageId && el.type === 'image') as ImageElement;
          if (imgElem && activeImgCropBoxRef.current) {
            handleCutImagePart(imgElem, activeImgCropBoxRef.current);
          }
          return;
        }
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleCutSelectedElements();
          return;
        }
      }

      // Paste: Ctrl+V is handled by the native 'paste' event so Windows clipboard images work.
      // (Do not preventDefault here — that would block clipboardData from the OS.)

      // Delete: Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleDeleteSelectedElements();
        }
        return;
      }

      // Toggle side panels: [ for left, ] for right
      if (e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleLeftPanel();
        return;
      }
      if (e.key === ']' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleRightPanel();
        return;
      }

      // Tool switches (single key only, without Ctrl/Cmd/Alt)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
            handleSelectTool('select');
            break;
          case 'h':
            handleSelectTool('pan');
            break;
          case 'b':
            handleSelectTool('brush');
            break;
          case 'y':
            handleSelectTool('highlighter');
            break;
          case 'e':
            handleSelectTool('eraser');
            break;
          case 'u':
            handleSelectTool('shape');
            break;
          case 't':
            handleSelectTool('text');
            break;
          case 'k':
            handleSelectTool('eyedropper');
            break;
          case 'g':
            handleSelectTool('fill');
            break;
          case 'c': {
            const currentSelected = elements.find((el) => el.id === selectedElementId);
            if (currentSelected && currentSelected.type === 'image') {
              handleStartCropImage(currentSelected.id);
            } else {
              handleSelectTool('crop');
            }
            break;
          }
          case 'r': {
            // Radial array – needs a selected element to replicate
            const currentSelected = elements.find((el) => el.id === selectedElementId);
            if (currentSelected) {
              handleCreateRadialArray(currentSelected);
            } else {
              handleSelectTool('radial'); // shows the "select an element first" hint
            }
            break;
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        if (nudgeTimerRef.current) {
          clearTimeout(nudgeTimerRef.current);
          nudgeTimerRef.current = null;
        }
        if (isNudgingRef.current) {
          pushHistory(elementsRef.current, layers, config);
          isNudgingRef.current = false;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    elements,
    selectedElementId,
    selectedElementIds,
    croppingImageId,
    handleNudgeSelectedElements,
    layers,
    config,
    pushHistory,
    handleUndo,
    handleRedo,
    handleDuplicateSelectedElements,
    handleDeleteSelectedElements,
    handleCopySelectedElements,
    handleCutSelectedElements,
    handleCopyImagePart,
    handleCutImagePart,
    handlePasteAction,
    handleStartCropImage,
    handleSelectTool,
    toggleLeftPanel,
    toggleRightPanel,
    radialToolState.step,
    handleRadialConfirm,
    handleRadialCancel,
    isAnyModalOpen,
  ]);

  const selectedElement = elements.find((el) => el.id === selectedElementId) || null;

  const fitBounds = useMemo(() => getContentBounds(elements, layers), [elements, layers]);
  const canFitCanvas = !!fitBounds;
  const fitPreview = fitBounds
    ? `${Math.min(4000, Math.max(1, Math.round(fitBounds.w)))}×${Math.min(4000, Math.max(1, Math.round(fitBounds.h)))}px`
    : null;

  return (
    <div
      onMouseEnter={() => window.focus()}
      onClick={() => window.focus()}
      className="flex h-screen w-screen overflow-hidden bg-stone-950 font-sans text-stone-100"
    >
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-visible">
      {/* 1. Header Navigation Bar */}
      <HeaderNavbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClearCanvas}
        zoom={zoom}
        onZoomChange={handleHeaderZoomChange}
        onZoomFit={handleZoomFit}
        onZoom100={handleZoom100}
        config={config}
        onUpdateConfig={handleUpdateConfig}
        onOpenNewCanvas={() => setIsNewCanvasOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        onInsertImage={handleInsertImage}
        onPasteFromClipboard={handlePasteAction}
        onFitCanvasToContent={handleFitCanvasToContent}
        canFitCanvas={canFitCanvas}
        fitPreview={fitPreview}
      />

      {/* 2. Top Tool Palette */}
      <Toolbar
        currentTool={currentTool}
        onSelectTool={handleSelectTool}
        selectedShapeType={selectedShapeType}
        onSelectShapeType={setSelectedShapeType}
        primaryColor={primaryColor}
        onPrimaryColorChange={handlePrimaryColorChange}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={handleStrokeWidthChange}
        onGroup={handleGroup}
        onUngroup={handleUngroup}
        selectedElementIds={selectedElementIds}
        elements={elements}
        onSelectMultipleElements={handleSelectMultipleElements}
      />

      {/* 3. Main Workspace: Layers Panel + Canvas */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Left: Layers Panel */}
        <LayersPanel
          layers={layers}
          activeLayerId={activeLayerId}
          onSelectLayer={setActiveLayerId}
          onAddLayer={handleAddLayer}
          onDeleteLayer={handleDeleteLayer}
          onDuplicateLayer={handleDuplicateLayer}
          onMoveLayerUp={handleMoveLayerUp}
          onMoveLayerDown={handleMoveLayerDown}
          onMoveElementForward={handleMoveElementForward}
          onMoveElementBackward={handleMoveElementBackward}
          onUpdateLayer={handleUpdateLayer}
          elements={elements}
          selectedElementId={selectedElementId}
          onSelectElement={handleSelectElement}
          isOpen={isLeftPanelOpen}
          onToggleCollapse={toggleLeftPanel}
        />

        {/* Center: Canvas Viewport */}
        <CanvasArea
            config={config}
            onUpdateConfig={handleUpdateConfig}
            onCropCanvas={handleCropCanvas}
            onCutCanvasRegion={handleCutCanvasRegion}
            onCopyCanvasRegion={handleCopyCanvasRegion}
            onTriggerPaste={handlePasteAction}
            onMouseMoveCanvas={(pt) => {
              lastMouseCanvasPosRef.current = pt;
            }}
            onCopyImagePart={handleCopyImagePart}
            onCutImagePart={handleCutImagePart}
            onCropBoxChange={handleCropBoxChange}
            layers={layers}
            elements={elements}
            onAddElement={handleAddElement}
            onUpdateElement={handleUpdateElement}
            onUpdateElements={handleUpdateElements}
            onCommitHistory={handleCommitHistory}
            onDeleteElement={handleDeleteElement}
            activeLayerId={activeLayerId}
            selectedElementId={selectedElementId}
            selectedElementIds={selectedElementIds}
            onSelectElement={handleSelectElement}
            onSelectMultipleElements={handleSelectMultipleElements}
            onToggleSelectElement={handleToggleSelectElement}
            currentTool={currentTool}
            onSelectTool={handleSelectTool}
            selectedShapeType={selectedShapeType}
            primaryColor={primaryColor}
            onPrimaryColorChange={handlePrimaryColorChange}
            strokeWidth={strokeWidth}
            zoom={zoom}
            onZoomChange={handleCanvasZoomChange}
            zoomFitActive={zoomFitActive}
            fitNonce={fitNonce}
            documentInputEnabled={!isAnyModalOpen}
            lastShapeStyle={lastShapeStyle}
            croppingImageId={croppingImageId}
            onStartCropImage={handleStartCropImage}
            onFinishCropImage={handleFinishCropImage}
            onInsertImage={handleInsertImage}
            // Radial Tool
            radialToolState={radialToolState}
            onRadialSetCenter={handleRadialSetCenter}
            onRadialUpdateRadius={handleRadialUpdateRadius}
            onRadialConfirm={handleRadialConfirm}
            onRadialCancel={handleRadialCancel}
            onRadialStart={handleRadialStart}
            onRadialSetStep={handleRadialSetStep}
            onGroup={handleGroup}
            onUngroup={handleUngroup}
          />
      </div>
      </div>

      {/* Right: Properties panel spans the full window height */}
      <PropertiesPanel
          selectedElement={selectedElement}
          onUpdateElement={handleUpdateElement}
          onDuplicateElement={handleDuplicateElement}
          onCreateMirrorAxis={handleCreateMirrorElement}
          onDeleteElement={handleDeleteElement}
          isElementLocked={
            selectedElement ? !canEditElement(selectedElement, layers) : false
          }
          isLayerLocked={
            selectedElement ? isLayerLocked(layers, selectedElement.layerId) : false
          }
          onToggleElementLock={() => {
            if (!selectedElement) return;
            if (isLayerLocked(layers, selectedElement.layerId)) return;
            handleUpdateElement({
              ...selectedElement,
              locked: !selectedElement.locked,
            });
          }}
          onBringForward={handleBringForward}
          onSendBackward={handleSendBackward}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onAlign={handleAlign}
          config={config}
          onUpdateConfig={handleUpdateConfig}
          isOpen={isRightPanelOpen}
          onToggleCollapse={toggleRightPanel}
          croppingImageId={croppingImageId}
          onStartCropImage={handleStartCropImage}
          onApplyCropImage={handleApplyCropImage}
          onCancelCropImage={handleFinishCropImage}
          onCutImagePart={handleCutImagePart}
          onCopyImagePart={handleCopyImagePart}
          onRemoveImageBackground={handleRemoveImageBackground}
          activeCropBox={activeImgCropBox}
          onFitCanvasToContent={handleFitCanvasToContent}
          canFitCanvas={canFitCanvas}
          fitPreview={fitPreview}
          // Radial Tool
          radialToolState={radialToolState}
          onRadialUpdateCount={handleRadialUpdateCount}
          onRadialUpdateSweepAngle={handleRadialUpdateSweepAngle}
          onRadialUpdateStartAngle={handleRadialUpdateStartAngle}
          onRadialUpdateRadius={handleRadialUpdateRadiusValue}
          onRadialSetRotateMode={handleRadialSetRotateMode}
          onRadialToggleHideSource={handleRadialToggleHideSource}
          onRadialConfirm={handleRadialConfirm}
          onRadialCancel={handleRadialCancel}
          onCreateRadialArray={handleCreateRadialArray}
      />

      {/* Modals */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        layers={layers}
        elements={elements}
        config={config}
      />

      <ShortcutsGuideModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      <NewCanvasModal
        isOpen={isNewCanvasOpen}
        onClose={() => setIsNewCanvasOpen(false)}
        currentConfig={config}
        onCreate={handleCreateNewCanvas}
      />

      <ClipboardGuideModal
        isOpen={isClipboardGuideOpen}
        onClose={() => setIsClipboardGuideOpen(false)}
        onInsertImage={handleInsertImage}
        onInsertImageSrc={handleInsertImageSrc}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-stone-900/95 text-stone-100 border border-amber-500/60 px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2.5 text-xs font-medium backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
