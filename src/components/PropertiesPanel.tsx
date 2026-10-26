import React, { useEffect, useState } from 'react';
import {
  CanvasElement,
  ShapeElement,
  TextElement,
  ImageElement,
  CanvasConfig,
  RadialToolState,
  RadialRotateMode,
  ArrowType,
  ArrowSize,
  LineCap,
} from '../types';
import { FONT_FAMILIES } from '../utils/colorUtils';
import { finalizeArcGeometry } from '../utils/shapeGenerators';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Sliders,
  Eraser,
  PanelRightClose,
  PanelRightOpen,
  Crop,
  Scissors,
  Lock,
  LockOpen,
} from 'lucide-react';
import { RadialArrayIcon } from './RadialArrayIcon';
import { NumberField } from './NumberField';

/** Visual property section card with clear title bar */
const PropertyGroup: React.FC<{
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, headerRight, children }) => (
  <section className="rounded-lg border border-stone-600/70 bg-stone-950/40 overflow-hidden shadow-sm">
    <div className="flex items-center justify-between gap-2 min-h-[32px] px-2.5 py-1.5 bg-stone-800 border-b border-stone-600/60">
      <h3 className="text-xs font-bold tracking-tight" style={{ color: '#ffd230' }}>{title}</h3>
      {headerRight}
    </div>
    <div className="p-2.5 space-y-2.5">{children}</div>
  </section>
);

/** Keyboard nudge hint styled like [→] 1px / [→]+[SHIFT] 10px */
const NudgeKeyHint: React.FC = () => {
  const keyBox =
    'inline-flex items-center justify-center rounded-[3px] border border-stone-300 bg-transparent text-stone-200 leading-none select-none';
  return (
    <div
      className="flex items-center gap-1 shrink-0 text-[10px] text-stone-300 font-sans"
      title="방향키: 1px 이동 · Shift+방향키: 10px 이동"
    >
      <kbd className={`${keyBox} w-[16px] h-[16px] text-[11px] font-normal`}>→</kbd>
      <span className="text-stone-400 tracking-tight">1px</span>
      <span className="text-stone-500 mx-0.5">/</span>
      <kbd className={`${keyBox} w-[16px] h-[16px] text-[11px] font-normal`}>→</kbd>
      <span className="text-stone-400 mx-px">+</span>
      <kbd className={`${keyBox} h-[16px] px-1 text-[8px] font-semibold tracking-wide`}>
        SHIFT
      </kbd>
      <span className="text-stone-400 tracking-tight">10px</span>
    </div>
  );
};

interface PropertiesPanelProps {
  selectedElement: CanvasElement | null;
  onUpdateElement: (updated: CanvasElement) => void;
  onDuplicateElement: (element: CanvasElement) => void;
  onCreateMirrorAxis?: (axis: 'h' | 'v') => void;
  onDeleteElement: (id: string) => void;
  onBringForward: (id: string) => void;
  onSendBackward: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
  onAlign: (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  config: CanvasConfig;
  onUpdateConfig: (partial: Partial<CanvasConfig>) => void;
  isOpen?: boolean;
  onToggleCollapse?: () => void;
  croppingImageId?: string | null;
  onStartCropImage?: (id: string) => void;
  onApplyCropImage?: () => void;
  onCancelCropImage?: () => void;
  onCutImagePart?: (imgElem: ImageElement, crop: { x: number; y: number; w: number; h: number }) => void;
  onCopyImagePart?: (imgElem: ImageElement, crop: { x: number; y: number; w: number; h: number }) => void;
  onRemoveImageBackground?: (imgElem: ImageElement, tolerance: number) => void;
  activeCropBox?: { x: number; y: number; w: number; h: number } | null;
  onFitCanvasToContent?: () => void;
  canFitCanvas?: boolean;
  fitPreview?: string | null;
  /** Radial array (방사상 배열) tool */
  radialToolState?: RadialToolState;
  onRadialUpdateCount?: (count: number) => void;
  onRadialUpdateSweepAngle?: (angle: number) => void;
  onRadialUpdateStartAngle?: (angle: number) => void;
  onRadialUpdateRadius?: (radius: number) => void;
  onRadialSetRotateMode?: (mode: RadialRotateMode) => void;
  onRadialToggleHideSource?: (hide: boolean) => void;
  onRadialConfirm?: () => void;
  onRadialCancel?: () => void;
  /** Start the radial tool with the currently selected element */
  onCreateRadialArray?: (source: CanvasElement) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedElement,
  onUpdateElement,
  onDuplicateElement,
  onCreateMirrorAxis,
  onDeleteElement,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onAlign,
  config,
  onUpdateConfig,
  isOpen = true,
  onToggleCollapse,
  croppingImageId,
  onStartCropImage,
  onApplyCropImage,
  onCancelCropImage,
  onCutImagePart,
  onCopyImagePart,
  onRemoveImageBackground,
  activeCropBox,
  onFitCanvasToContent,
  canFitCanvas = false,
  fitPreview = null,
  radialToolState,
  onRadialUpdateCount,
  onRadialUpdateSweepAngle,
  onRadialUpdateStartAngle,
  onRadialUpdateRadius,
  onRadialSetRotateMode,
  onRadialToggleHideSource,
  onRadialConfirm,
  onRadialCancel,
  onCreateRadialArray,
}) => {
  const [canvasWidthDraft, setCanvasWidthDraft] = useState(String(config.width));
  const [canvasHeightDraft, setCanvasHeightDraft] = useState(String(config.height));
  // Rotation manipulation mode: flip buttons become 1°/90° rotators
  const [rotateMode, setRotateMode] = useState(false);
  // Background-removal color tolerance (0-100; flood fill threshold)
  const [bgTolerance, setBgTolerance] = useState<number>(30);

  useEffect(() => {
    setCanvasWidthDraft(String(config.width));
  }, [config.width]);

  useEffect(() => {
    setCanvasHeightDraft(String(config.height));
  }, [config.height]);

  const commitCanvasSize = (axis: 'width' | 'height', raw: string) => {
    const parsed = parseInt(raw, 10);
    // Empty / invalid → default 100. Values below 100 are allowed (min 1).
    const next = Number.isFinite(parsed) && parsed >= 1 ? Math.min(4000, parsed) : 100;
    if (axis === 'width') {
      setCanvasWidthDraft(String(next));
      if (next !== config.width) onUpdateConfig({ width: next });
    } else {
      setCanvasHeightDraft(String(next));
      if (next !== config.height) onUpdateConfig({ height: next });
    }
  };

  // Collapsed Rail View
  if (!isOpen) {
    return (
      <aside
        onClick={onToggleCollapse}
        className="w-10 h-full min-h-0 bg-stone-900 border-l border-stone-800 text-stone-200 flex flex-col items-center py-3 select-none text-xs shrink-0 cursor-pointer hover:bg-stone-850 transition-colors group"
        title="속성 패널 펼치기 (단축키: ])"
      >
        <button
          id="btn-expand-properties"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
          className="p-1.5 rounded hover:bg-orange-500/20 text-orange-400 hover:text-orange-300 transition-colors"
          title="속성 패널 펼치기 (단축키: ])"
        >
          <PanelRightOpen className="w-4 h-4 text-orange-400 group-hover:scale-110 transition-transform" />
        </button>

        <Sliders className="w-4 h-4 text-amber-400 mt-3" />

        <span className="text-[11px] text-stone-400 group-hover:text-stone-200 font-medium tracking-wider mt-4 [writing-mode:vertical-lr]">
          {selectedElement ? '개체 속성' : '캔버스 설정'}
        </span>
      </aside>
    );
  }

  if (!selectedElement) {
    // Canvas settings when nothing is selected
    return (
      <aside className="w-72 h-full min-h-0 bg-stone-900 border-l border-stone-800 text-stone-200 p-4 flex flex-col space-y-5 overflow-y-auto overscroll-contain text-xs shrink-0 select-none *:shrink-0">
        <div className="flex items-center justify-between pb-2 border-b border-stone-800">
          <div>
            <h2 className="font-semibold text-sm text-stone-100 mb-0.5">캔버스 속성</h2>
            <p className="text-[11px] text-stone-400">작업 영역 크기 및 배경 설정</p>
          </div>
          {onToggleCollapse && (
            <button
              id="btn-collapse-properties"
              onClick={onToggleCollapse}
              className="p-1.5 rounded text-orange-400 hover:text-orange-300 hover:bg-orange-500/20 transition-colors"
              title="속성 패널 접기 (단축키: ])"
            >
              <PanelRightClose className="w-4 h-4 text-orange-400" />
            </button>
          )}
        </div>

        {/* Canvas Dimension Presets */}
        <div className="space-y-2">
          <label className="text-stone-300 font-medium block">규격 프리셋</label>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: 'FHD (1920×1080)', w: 1920, h: 1080 },
              { label: 'HD (1280×720)', w: 1280, h: 720 },
              { label: '정사각형 (1080×1080)', w: 1080, h: 1080 },
              { label: '그림판 (800×600)', w: 800, h: 600 },
              { label: 'A4 세로 (794×1123)', w: 794, h: 1123 },
              { label: '배너 (1200×630)', w: 1200, h: 630 },
            ].map((preset) => (
              <button
                key={preset.label}
                id={`preset-${preset.w}x${preset.h}`}
                onClick={() => onUpdateConfig({ width: preset.w, height: preset.h })}
                className={`px-2 py-1.5 rounded border text-[11px] text-left transition-colors ${
                  config.width === preset.w && config.height === preset.h
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300 font-medium'
                    : 'border-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Width / Height */}
        <div className="space-y-2">
          <label className="text-stone-300 font-medium block">직접 크기 입력 (px)</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-stone-500 block mb-1">가로 (너비)</span>
              <input
                id="input-canvas-width"
                type="number"
                min="1"
                max="4000"
                value={canvasWidthDraft}
                onChange={(e) => {
                  const raw = e.target.value;
                  setCanvasWidthDraft(raw);
                  if (raw === '' || raw === '-') return;
                  const parsed = parseInt(raw, 10);
                  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 4000) {
                    onUpdateConfig({ width: parsed });
                  }
                }}
                onBlur={() => commitCanvasSize('width', canvasWidthDraft)}
                className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
            <div>
              <span className="text-[10px] text-stone-500 block mb-1">세로 (높이)</span>
              <input
                id="input-canvas-height"
                type="number"
                min="1"
                max="4000"
                value={canvasHeightDraft}
                onChange={(e) => {
                  const raw = e.target.value;
                  setCanvasHeightDraft(raw);
                  if (raw === '' || raw === '-') return;
                  const parsed = parseInt(raw, 10);
                  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 4000) {
                    onUpdateConfig({ height: parsed });
                  }
                }}
                onBlur={() => commitCanvasSize('height', canvasHeightDraft)}
                className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Fit Canvas To Content */}
        <div className="space-y-2">
          <label className="text-stone-300 font-medium block">콘텐츠에 맞추기</label>
          <button
            id="btn-fit-canvas-panel"
            type="button"
            onClick={onFitCanvasToContent}
            disabled={!canFitCanvas}
            className={`w-full py-2 rounded-md border text-xs font-medium transition-colors ${
              canFitCanvas
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                : 'border-stone-800 text-stone-600 cursor-not-allowed'
            }`}
            title={
              canFitCanvas
                ? `이미지와 객체 최대 범위에 맞춰 캔버스를 한 번에 줄입니다${fitPreview ? ` (${fitPreview})` : ''}`
                : '맞춰줄 객체가 없습니다'
            }
          >
            {canFitCanvas
              ? `콘텐츠 크기로 줄이기${fitPreview ? ` (${fitPreview})` : ''}`
              : '맞춰줄 객체가 없습니다'}
          </button>
          <p className="text-[10px] text-stone-500 leading-snug">
            숨김 레이어·숨김 객체는 제외하고, 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.
          </p>
        </div>

        {/* Background Color */}
        <div className="space-y-2 pt-2 border-t border-stone-800">
          <label className="text-stone-300 font-medium block">캔버스 배경색</label>
          <div className="flex items-center space-x-2">
            <input
              id="input-canvas-bg"
              type="color"
              value={config.backgroundColor === 'transparent' ? '#ffffff' : config.backgroundColor}
              onChange={(e) => onUpdateConfig({ backgroundColor: e.target.value })}
              className="w-8 h-8 rounded border border-stone-700 cursor-pointer bg-transparent"
            />
            <div className="flex space-x-1">
              <button
                onClick={() => onUpdateConfig({ backgroundColor: '#FFFFFF' })}
                className={`px-2 py-1 rounded border text-[11px] ${
                  config.backgroundColor === '#FFFFFF' ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                }`}
              >
                흰색
              </button>
              <button
                onClick={() => onUpdateConfig({ backgroundColor: '#18181B' })}
                className={`px-2 py-1 rounded border text-[11px] ${
                  config.backgroundColor === '#18181B' ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                }`}
              >
                다크
              </button>
              <button
                onClick={() => onUpdateConfig({ backgroundColor: 'transparent' })}
                className={`px-2 py-1 rounded border text-[11px] ${
                  config.backgroundColor === 'transparent' ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                }`}
              >
                투명
              </button>
            </div>
          </div>
        </div>

        {/* Grid Setting */}
        <div className="space-y-2 pt-2 border-t border-stone-800">
          <div className="flex justify-between items-center">
            <label className="text-stone-300 font-medium">격자 크기</label>
            <span className="font-mono text-stone-400">{config.gridSize}px</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={config.gridSize}
            onChange={(e) => onUpdateConfig({ gridSize: parseInt(e.target.value) })}
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>
      </aside>
    );
  }

  // Element is selected! Contextual PPT & Paint property panels
  const isShape = selectedElement.type === 'shape';
  const shape = isShape ? (selectedElement as ShapeElement) : null;
  const isLine =
    isShape &&
    (shape?.shapeType === 'line' ||
      shape?.shapeType.startsWith('line-arrow') ||
      shape?.shapeType === 'polyline' ||
      shape?.shapeType === 'arc');
  const isStraightLine = isShape && (shape?.shapeType === 'line' || shape?.shapeType.startsWith('line-arrow'));
  const isArc = isShape && shape?.shapeType === 'arc';
  const isText = selectedElement.type === 'text';
  const isImage = selectedElement.type === 'image';
  const isBrush = selectedElement.type === 'brush';

  const text = isText ? (selectedElement as TextElement) : null;
  const img = isImage ? (selectedElement as ImageElement) : null;

  return (
    <aside className="w-72 h-full min-h-0 bg-stone-900 border-l border-stone-800 text-stone-200 p-4 flex flex-col space-y-4 overflow-y-auto overscroll-contain text-xs shrink-0 select-none *:shrink-0">
      {/* Header with Title and Quick Actions */}
      <div className="flex items-center justify-between pb-3 border-b border-stone-800">
        <div>
          <h2 className="font-semibold text-sm text-stone-100 capitalize">
            {isShape && (isLine ? '선 속성 (라인 서식)' : '도형 속성 (PPT 서식)')}
            {isText && '텍스트 서식'}
            {isImage && '이미지 및 필터 조정'}
            {isBrush && '브러시 획 속성'}
          </h2>
          <span className="text-[11px] text-stone-400">{selectedElement.name || selectedElement.type}</span>
        </div>
        <div className="flex items-center space-x-1">
          {onCreateRadialArray && (
            <button
              id="btn-radial-array"
              onClick={() => onCreateRadialArray(selectedElement)}
              className="p-1.5 rounded text-stone-400 hover:text-amber-300 hover:bg-stone-800"
              title="방사상 복제 — 이 개체를 원형으로 반복 배치 (R)"
            >
              <RadialArrayIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            id="btn-duplicate-elem"
            onClick={() => onDuplicateElement(selectedElement)}
            className="p-1.5 rounded text-stone-400 hover:text-white hover:bg-stone-800"
            title="복제 (Ctrl+D)"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            id="btn-delete-elem"
            onClick={() => onDeleteElement(selectedElement.id)}
            className="p-1.5 rounded text-stone-400 hover:text-rose-400 hover:bg-stone-800"
            title="삭제 (Del)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {onToggleCollapse && (
            <button
              id="btn-collapse-properties-elem"
              onClick={onToggleCollapse}
              className="p-1.5 rounded text-orange-400 hover:text-orange-300 hover:bg-orange-500/20 ml-1 border-l border-stone-800 transition-colors"
              title="속성 패널 접기 (단축키: ])"
            >
              <PanelRightClose className="w-3.5 h-3.5 text-orange-400" />
            </button>
          )}
        </div>
      </div>

      {/* Radial Array (방사상 배열) controls */}
      {radialToolState && radialToolState.step !== 'idle' && (
        <div className="space-y-2.5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/30">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-300">방사상 배열</span>
            <span className="text-[10px] text-stone-400">
              {radialToolState.step === 'placing_center'
                ? '중심점을 클릭하세요'
                : radialToolState.step === 'preview'
                ? '반지름 고정됨 (클릭해 해제)'
                : '반지름 조절 중'}
            </span>
          </div>

          {radialToolState.sourceElement && (
            <div className="text-[10px] text-stone-400 truncate">
              원본: {radialToolState.sourceElement.name}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-400 w-14 shrink-0">개수</span>
            <NumberField
              value={radialToolState.count}
              min={2}
              max={50}
              onChange={(v) => onRadialUpdateCount?.(v)}
              className="flex-1 min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-400 w-14 shrink-0">반지름</span>
            <NumberField
              value={radialToolState.radius}
              min={1}
              onChange={(v) => onRadialUpdateRadius?.(v)}
              className="flex-1 min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
            />
            <span className="text-[10px] text-stone-500 shrink-0">px</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-400 w-14 shrink-0">시작 각도</span>
            <NumberField
              value={radialToolState.startAngle}
              min={0}
              max={360}
              onChange={(v) => onRadialUpdateStartAngle?.(v)}
              className="flex-1 min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
            />
            <span className="text-[10px] text-stone-500 shrink-0">°</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-400 w-14 shrink-0">범위</span>
            <NumberField
              value={radialToolState.sweepAngle}
              min={0}
              max={360}
              onChange={(v) => onRadialUpdateSweepAngle?.(v)}
              className="flex-1 min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
            />
            <span className="text-[10px] text-stone-500 shrink-0">°</span>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] text-stone-400">복사본 방향</span>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { mode: 'none' as RadialRotateMode, label: '고정', hint: '모든 복사본이 원래 방향 유지' },
                  { mode: 'tangential' as RadialRotateMode, label: '원주', hint: '원을 따라 순서대로 회전 (연속)' },
                  { mode: 'radial' as RadialRotateMode, label: '방사', hint: '중심에서 바깥쪽을 향함 (태양살)' },
                ]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  onClick={() => onRadialSetRotateMode?.(opt.mode)}
                  title={opt.hint}
                  className={`px-1 py-1 rounded text-[10px] font-medium border transition-colors ${
                    radialToolState.rotateMode === opt.mode
                      ? 'bg-amber-500 text-stone-950 border-amber-500 font-bold'
                      : 'bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-500 leading-tight">
              {radialToolState.rotateMode === 'radial'
                ? '복사본이 중심에서 바깥쪽을 향합니다 (태양살 모양).'
                : radialToolState.rotateMode === 'tangential'
                ? '복사본이 원을 따라 순서대로 회전합니다.'
                : '모든 복사본이 원래 방향을 유지합니다.'}
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-stone-300">
            <input
              type="checkbox"
              checked={!!radialToolState.hideSource}
              onChange={(e) => onRadialToggleHideSource?.(e.target.checked)}
              className="accent-amber-500 w-3.5 h-3.5"
            />
            <span>확정 후 원본 숨기기 (완전한 고리만 남김)</span>
          </label>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => onRadialConfirm?.()}
              disabled={radialToolState.previewElements.length === 0}
              className="px-2 py-1.5 rounded bg-amber-500 text-stone-950 text-[11px] font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              확인 (Enter)
            </button>
            <button
              onClick={() => onRadialCancel?.()}
              className="px-2 py-1.5 rounded border border-stone-700 text-stone-300 text-[11px] hover:bg-stone-800"
            >
              취소 (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Geometry / Transform */}
      <PropertyGroup
        title={isStraightLine ? '위치 및 길이' : '위치 및 크기'}
        headerRight={<NudgeKeyHint />}
      >
        {isImage && img && (
          <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-stone-300">
            <input
              type="checkbox"
              checked={!!img.lockAspectRatio}
              onChange={(e) =>
                onUpdateElement({ ...img, lockAspectRatio: e.target.checked })
              }
              className="accent-amber-500 w-3.5 h-3.5"
            />
            {img.lockAspectRatio ? (
              <Lock className="w-3 h-3 text-amber-400 shrink-0" />
            ) : (
              <LockOpen className="w-3 h-3 text-stone-500 shrink-0" />
            )}
            <span>비율 고정 (Lock)</span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-stone-500 shrink-0 w-10">X</span>
            <NumberField
              value={Math.round(selectedElement.x)}
              onChange={(v) => onUpdateElement({ ...selectedElement, x: v })}
              className="w-full min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
            />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-stone-500 shrink-0 w-10">Y</span>
            <NumberField
              value={Math.round(selectedElement.y)}
              onChange={(v) => onUpdateElement({ ...selectedElement, y: v })}
              className="w-full min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
            />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-stone-500 shrink-0 w-10">
              {isStraightLine ? '길이' : 'W'}
            </span>
            <NumberField
              value={Math.round(selectedElement.width)}
              min={5}
              onChange={(w) => {
                if (isImage && img?.lockAspectRatio && selectedElement.height > 0) {
                  const ratio = selectedElement.width / selectedElement.height;
                  onUpdateElement({
                    ...img,
                    width: w,
                    height: Math.max(5, Math.round(w / ratio)),
                  });
                } else {
                  onUpdateElement({ ...selectedElement, width: w });
                }
              }}
              className="w-full min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
            />
          </div>
          {isStraightLine ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-stone-500 shrink-0 w-10">굵기</span>
              <NumberField
                value={shape?.strokeWidth || 2}
                min={1}
                max={50}
                onChange={(sw) => {
                  onUpdateElement({
                    ...shape!,
                    strokeWidth: sw,
                    height: Math.max(sw * 4, 16),
                  });
                }}
                className="w-full min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-stone-500 shrink-0 w-10">H</span>
              <NumberField
                value={Math.round(selectedElement.height)}
                min={5}
                onChange={(h) => {
                  if (isImage && img?.lockAspectRatio && selectedElement.width > 0) {
                    const ratio = selectedElement.width / selectedElement.height;
                    onUpdateElement({
                      ...img,
                      height: h,
                      width: Math.max(5, Math.round(h * ratio)),
                    });
                  } else {
                    onUpdateElement({ ...selectedElement, height: h });
                  }
                }}
                className="w-full min-w-0 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs focus:border-amber-500"
              />
            </div>
          )}
        </div>

        {/* Rotation mode checkbox */}
        <label className="flex items-center gap-1.5 text-[11px] text-stone-300 cursor-pointer select-none pt-0.5">
          <input
            id="chk-rotate-mode"
            type="checkbox"
            checked={rotateMode}
            onChange={(e) => setRotateMode(e.target.checked)}
            className="accent-amber-500 w-3.5 h-3.5"
          />
          <span>회전 조작 모드 {rotateMode ? '(버튼 = 각도 조절 중)' : ''}</span>
        </label>

        {/* Rotation */}
        <div className="flex items-center space-x-2 pt-0.5">
          <RotateCw className="w-3.5 h-3.5 text-stone-400" />
          <span className="text-[10px] text-stone-400 shrink-0">회전:</span>
          <input
            type="range"
            min="0"
            max="360"
            value={selectedElement.rotation || 0}
            onChange={(e) => {
              // Moving the slider with the mouse implies the user is fine-tuning
              // the angle — opt into rotation manipulation mode automatically.
              if (!rotateMode) setRotateMode(true);
              const v = parseInt(e.target.value) || 0;
              onUpdateElement({ ...selectedElement, rotation: v });
            }}
            className="flex-1 accent-amber-500"
          />
          <NumberField
            id="rotation-degrees-input"
            value={selectedElement.rotation || 0}
            onChange={(parsed) => {
              const normalized = ((parsed % 360) + 360) % 360;
              if (!rotateMode) setRotateMode(true);
              onUpdateElement({ ...selectedElement, rotation: normalized });
            }}
            className="w-14 bg-stone-800 border border-stone-700 rounded px-1.5 py-1 font-mono text-stone-100 text-xs text-right focus:border-amber-500"
            title="각도 직접 입력 (0~359°)"
          />
          <span className="font-mono text-stone-300 text-xs">°</span>
        </div>

        {/* Flip buttons — or 1°/90° angle steppers in rotation mode */}
        <div className="flex items-center space-x-2">
          {rotateMode ? (
            <>
              <button
                id="prop-rotate--1"
                onClick={() =>
                  onUpdateElement({
                    ...selectedElement,
                    rotation: (((selectedElement.rotation || 0) - 1) % 360 + 360) % 360,
                  })
                }
                className="flex-1 flex items-center justify-center space-x-0.5 py-1 rounded border border-stone-800 text-[11px] text-stone-300 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
                title="반시계 방향 1° 회전"
              >
                <RotateCcw className="w-3 h-3" />
                <span>1°</span>
              </button>
              <button
                id="prop-rotate-1"
                onClick={() =>
                  onUpdateElement({
                    ...selectedElement,
                    rotation: (((selectedElement.rotation || 0) + 1) % 360 + 360) % 360,
                  })
                }
                className="flex-1 flex items-center justify-center space-x-0.5 py-1 rounded border border-stone-800 text-[11px] text-stone-300 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
                title="시계 방향 1° 회전"
              >
                <span>1°</span>
                <RotateCw className="w-3 h-3" />
              </button>
              <button
                id="prop-rotate--90"
                onClick={() =>
                  onUpdateElement({
                    ...selectedElement,
                    rotation: (((selectedElement.rotation || 0) - 90) % 360 + 360) % 360,
                  })
                }
                className="flex-1 flex items-center justify-center space-x-0.5 py-1 rounded border border-stone-800 text-[11px] text-stone-300 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
                title="반시계 방향 90° 회전"
              >
                <RotateCcw className="w-3 h-3" />
                <span>90°</span>
              </button>
              <button
                id="prop-rotate-90"
                onClick={() =>
                  onUpdateElement({
                    ...selectedElement,
                    rotation: (((selectedElement.rotation || 0) + 90) % 360 + 360) % 360,
                  })
                }
                className="flex-1 flex items-center justify-center space-x-0.5 py-1 rounded border border-stone-800 text-[11px] text-stone-300 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
                title="시계 방향 90° 회전"
              >
                <span>90°</span>
                <RotateCw className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <span className="text-[10px] text-stone-400 shrink-0">뒤집기:</span>
              <button
                id="prop-flip-h"
                onClick={() =>
                  onUpdateElement({ ...selectedElement, flipH: !selectedElement.flipH })
                }
                className={`flex-1 flex items-center justify-center space-x-1 py-1 rounded border text-[11px] transition-colors ${
                  selectedElement.flipH
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                }`}
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
                <span>좌우</span>
              </button>
              <button
                id="prop-flip-v"
                onClick={() =>
                  onUpdateElement({ ...selectedElement, flipV: !selectedElement.flipV })
                }
                className={`flex-1 flex items-center justify-center space-x-1 py-1 rounded border text-[11px] transition-colors ${
                  selectedElement.flipV
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                }`}
              >
                <FlipVertical className="w-3.5 h-3.5" />
                <span>상하</span>
              </button>
            </>
          )}
        </div>

        {/* Mirror duplicate */}
        {onCreateMirrorAxis && (
          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-stone-400 shrink-0">거울상:</span>
            <button
              id="prop-mirror-h"
              onClick={() => onCreateMirrorAxis('h')}
              className="flex-1 flex items-center justify-center space-x-1 py-1 rounded border border-stone-800 text-[11px] text-stone-300 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
              title="뒤집힌 복제를 원본 바로 오른쪽에 붙여 만듭니다"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
              <span>좌우 거울상</span>
            </button>
            <button
              id="prop-mirror-v"
              onClick={() => onCreateMirrorAxis('v')}
              className="flex-1 flex items-center justify-center space-x-1 py-1 rounded border border-stone-800 text-[11px] text-stone-300 hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-amber-300 transition-colors"
              title="뒤집힌 복제를 원본 바로 아래에 붙여 만듭니다"
            >
              <FlipVertical className="w-3.5 h-3.5" />
              <span>상하 거울상</span>
            </button>
          </div>
        )}

        {/* Opacity */}
        <div className="flex items-center space-x-2">
          <span className="text-[10px] text-stone-400">불투명도:</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(selectedElement.opacity * 100)}
            onChange={(e) =>
              onUpdateElement({ ...selectedElement, opacity: parseInt(e.target.value) / 100 })
            }
            className="flex-1 accent-amber-500"
          />
          <span className="font-mono text-stone-300 text-xs w-8 text-right">
            {Math.round(selectedElement.opacity * 100)}%
          </span>
        </div>
      </PropertyGroup>

      {/* SHAPE SPECIFIC PROPERTIES: Stroke first, then Fill */}
      {isShape && shape && (
        <PropertyGroup title={isLine ? (isArc ? '아크 스타일' : '선 스타일 및 화살표') : '채우기 및 테두리'}>
          {/* Line Type Toggle if straight Line */}
          {isStraightLine && (
            <div className="space-y-1.5">
              <span className="text-[11px] text-stone-400">선 종류 (다음 그리기에도 유지)</span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  id="prop-line-type-straight"
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      shapeType: 'line',
                      name: '직선',
                    })
                  }
                  className={`py-1.5 rounded border text-xs font-medium transition-colors ${
                    shape.shapeType === 'line'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs'
                      : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                  }`}
                >
                  ─ 직선
                </button>
                <button
                  id="prop-line-type-arrow-end"
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      shapeType: 'line-arrow',
                      name: '끝 화살표',
                    })
                  }
                  className={`py-1.5 rounded border text-xs font-medium transition-colors ${
                    shape.shapeType === 'line-arrow'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs'
                      : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                  }`}
                >
                  ↗ 끝 화살표
                </button>
                <button
                  id="prop-line-type-arrow-both"
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      shapeType: 'line-arrow-both',
                      name: '양끝 화살표',
                    })
                  }
                  className={`py-1.5 rounded border text-xs font-medium transition-colors ${
                    shape.shapeType === 'line-arrow-both'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs'
                      : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                  }`}
                >
                  ↔ 양끝 화살표
                </button>
                <button
                  id="prop-line-type-arrow-start"
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      shapeType: 'line-arrow-start',
                      name: '시작 화살표',
                    })
                  }
                  className={`py-1.5 rounded border text-xs font-medium transition-colors ${
                    shape.shapeType === 'line-arrow-start'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs'
                      : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                  }`}
                >
                  ↖ 시작 화살표
                </button>
                <button
                  id="prop-line-type-arrow-open"
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      shapeType: 'line-arrow-open',
                      name: '열린 화살표',
                    })
                  }
                  className={`py-1.5 rounded border text-xs font-medium transition-colors ${
                    shape.shapeType === 'line-arrow-open'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs'
                      : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                  }`}
                >
                  &gt; 열린 화살표
                </button>
                <button
                  id="prop-line-type-arrow-dot"
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      shapeType: 'line-arrow-dot',
                      name: '끝 점 화살표',
                    })
                  }
                  className={`py-1.5 rounded border text-xs font-medium transition-colors ${
                    shape.shapeType === 'line-arrow-dot'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs'
                      : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                  }`}
                >
                  · 끝 점
                </button>
                <button
                  id="prop-line-type-arrow-diamond"
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      shapeType: 'line-arrow-diamond',
                      name: '마름모 화살표',
                    })
                  }
                  className={`py-1.5 rounded border text-xs font-medium transition-colors ${
                    shape.shapeType === 'line-arrow-diamond'
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-xs'
                      : 'border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
                  }`}
                >
                  ◆ 마름모
                </button>
              </div>
            </div>
          )}

          {/* Stroke / Outline — above fill */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-stone-400 font-medium">
              {isLine ? (isArc ? '아크 색상 및 굵기' : '선 색상 및 굵기') : '윤곽선'}
            </span>
            <div className="flex items-center space-x-2">
              <input
                type="color"
                value={shape.stroke === 'none' ? '#000000' : shape.stroke}
                onChange={(e) => onUpdateElement({ ...shape, stroke: e.target.value })}
                className="w-7 h-7 rounded border border-stone-700 bg-transparent cursor-pointer"
              />
              {!isLine && (
                <button
                  onClick={() => onUpdateElement({ ...shape, stroke: 'none' })}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    shape.stroke === 'none' ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                  }`}
                >
                  선 없음
                </button>
              )}
              <div className="flex items-center space-x-1 flex-1">
                <NumberField
                  value={shape.strokeWidth}
                  min={1}
                  max={50}
                  onChange={(sw) => {
                    onUpdateElement({
                      ...shape,
                      strokeWidth: sw,
                      height: isStraightLine ? Math.max(sw * 4, 16) : shape.height,
                    });
                  }}
                  className="w-14 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono text-xs"
                />
                <span className="text-[10px] text-stone-500">px</span>
              </div>
            </div>

            <div className="flex items-center space-x-1 pt-1 overflow-x-auto py-0.5">
              {[
                '#000000',
                '#FFFFFF',
                '#EF4444',
                '#F97316',
                '#F59E0B',
                '#10B981',
                '#06B6D4',
                '#3B82F6',
                '#4F46E5',
                '#8B5CF6',
                '#EC4899',
                '#64748B',
              ].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateElement({ ...shape, stroke: c })}
                  className={`w-4 h-4 rounded-sm border shrink-0 transition-transform ${
                    shape.stroke.toLowerCase() === c.toLowerCase()
                      ? 'border-amber-400 ring-1 ring-amber-400 scale-110'
                      : 'border-stone-700 hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>

            <div className="flex items-center space-x-1 mt-1">
              {(['solid', 'dashed', 'dotted'] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => onUpdateElement({ ...shape, strokeDash: style })}
                  className={`flex-1 py-1 rounded border text-[11px] capitalize ${
                    shape.strokeDash === style
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                      : 'border-stone-800 text-stone-400'
                  }`}
                >
                  {style === 'solid' ? '실선' : style === 'dashed' ? '파선' : '점선'}
                </button>
              ))}
            </div>

            {/* Arrow Line Caps (for line/arrow types) */}
            {isStraightLine && (
              <div className="space-y-1.5 pt-2 border-t border-stone-800/50">
                <span className="text-[11px] text-stone-400 font-medium">선 끝 모양 (Line Cap)</span>
                <div className="flex items-center space-x-1">
                  {(['round', 'flat', 'square'] as LineCap[]).map((cap) => (
                    <button
                      key={cap}
                      onClick={() => onUpdateElement({ ...shape, lineCap: cap })}
                      className={`flex-1 py-1 rounded border text-[11px] capitalize ${
                        (shape.lineCap || 'round') === cap
                          ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                          : 'border-stone-800 text-stone-400'
                      }`}
                    >
                      {cap === 'round' ? '둥근' : cap === 'flat' ? '평평' : '사각'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* PowerPoint-style Arrow Head Configuration */}
            {isStraightLine && (
              <div className="space-y-2 pt-2 border-t border-stone-800/50">
                <span className="text-[11px] text-stone-400 font-medium">화살표 머리 (PowerPoint 스타일)</span>
                
                {/* Begin Arrow */}
                <div className="space-y-1">
                  <span className="text-[10px] text-stone-500">시작 화살표</span>
                  <div className="grid grid-cols-6 gap-1">
                    {(['none', 'triangle', 'open', 'stealth', 'oval', 'diamond'] as ArrowType[]).map((type) => {
                      const icons = {
                        none: '—',
                        triangle: '◀',
                        open: '⟨',
                        stealth: '◂',
                        oval: '●',
                        diamond: '◆'
                      };
                      const isActive = (shape.beginArrow?.type || 'none') === type;
                      return (
                        <button
                          key={type}
                          onClick={() => onUpdateElement({
                            ...shape,
                            beginArrow: { type, size: shape.beginArrow?.size || 'medium' }
                          })}
                          className={`px-1 py-1.5 rounded border text-xs font-medium transition-colors ${
                            isActive
                              ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                              : 'border-stone-800 text-stone-400 hover:bg-stone-800'
                          }`}
                          title={type}
                        >
                          {icons[type]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-stone-500 w-8 shrink-0">크기:</span>
                    {(['small', 'medium', 'large'] as ArrowSize[]).map((size) => (
                      <button
                        key={size}
                        onClick={() => onUpdateElement({
                          ...shape,
                          beginArrow: { type: shape.beginArrow?.type || 'none', size }
                        })}
                        className={`flex-1 py-0.5 rounded border text-[10px] ${
                          (shape.beginArrow?.size || 'medium') === size
                            ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                            : 'border-stone-800 text-stone-400'
                        }`}
                      >
                        {size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* End Arrow */}
                <div className="space-y-1">
                  <span className="text-[10px] text-stone-500">끝 화살표</span>
                  <div className="grid grid-cols-6 gap-1">
                    {(['none', 'triangle', 'open', 'stealth', 'oval', 'diamond'] as ArrowType[]).map((type) => {
                      const icons = {
                        none: '—',
                        triangle: '▶',
                        open: '⟩',
                        stealth: '▸',
                        oval: '●',
                        diamond: '◆'
                      };
                      const isActive = (shape.endArrow?.type || 'none') === type;
                      return (
                        <button
                          key={type}
                          onClick={() => onUpdateElement({
                            ...shape,
                            endArrow: { type, size: shape.endArrow?.size || 'medium' }
                          })}
                          className={`px-1 py-1.5 rounded border text-xs font-medium transition-colors ${
                            isActive
                              ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                              : 'border-stone-800 text-stone-400 hover:bg-stone-800'
                          }`}
                          title={type}
                        >
                          {icons[type]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-stone-500 w-8 shrink-0">크기:</span>
                    {(['small', 'medium', 'large'] as ArrowSize[]).map((size) => (
                      <button
                        key={size}
                        onClick={() => onUpdateElement({
                          ...shape,
                          endArrow: { type: shape.endArrow?.type || 'none', size }
                        })}
                        className={`flex-1 py-0.5 rounded border text-[10px] ${
                          (shape.endArrow?.size || 'medium') === size
                            ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                            : 'border-stone-800 text-stone-400'
                        }`}
                      >
                        {size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {isArc && shape.points && shape.points.length >= 2 && (
              <div className="space-y-1.5 pt-2 border-t border-stone-700/50">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-stone-400 font-medium">반지름 (휘어짐)</span>
                  <span className="font-mono text-stone-300 text-[11px]">
                    {Math.round(shape.arcRadius || 0)} px
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={(() => {
                      const L = Math.hypot(
                        shape.points[1].x - shape.points[0].x,
                        shape.points[1].y - shape.points[0].y
                      );
                      return Math.max(1, Math.ceil(L / 2 + 1));
                    })()}
                    max={5000}
                    value={Math.round(shape.arcRadius || 0)}
                    onChange={(e) => {
                      const absStart = {
                        x: shape.x + shape.points![0].x,
                        y: shape.y + shape.points![0].y,
                      };
                      const absEnd = {
                        x: shape.x + shape.points![1].x,
                        y: shape.y + shape.points![1].y,
                      };
                      const L = Math.hypot(absEnd.x - absStart.x, absEnd.y - absStart.y);
                      const minR = L / 2 + 0.5;
                      const r = Math.max(minR, parseFloat(e.target.value) || minR);
                      const geom = finalizeArcGeometry(
                        absStart,
                        absEnd,
                        r,
                        !!shape.arcLarge,
                        !!shape.arcSweep
                      );
                      onUpdateElement({
                        ...shape,
                        x: geom.x,
                        y: geom.y,
                        width: geom.width,
                        height: geom.height,
                        points: geom.points,
                        arcRadius: geom.arcRadius,
                        arcLarge: geom.arcLarge,
                        arcSweep: geom.arcSweep,
                      });
                    }}
                    className="flex-1 accent-amber-500"
                  />
                  <NumberField
                    value={Math.round(shape.arcRadius || 0)}
                    onChange={(radius) => {
                      const absStart = {
                        x: shape.x + shape.points![0].x,
                        y: shape.y + shape.points![0].y,
                      };
                      const absEnd = {
                        x: shape.x + shape.points![1].x,
                        y: shape.y + shape.points![1].y,
                      };
                      const L = Math.hypot(absEnd.x - absStart.x, absEnd.y - absStart.y);
                      const minR = L / 2 + 0.5;
                      const r = Math.max(minR, radius);
                      const geom = finalizeArcGeometry(
                        absStart,
                        absEnd,
                        r,
                        !!shape.arcLarge,
                        !!shape.arcSweep
                      );
                      onUpdateElement({
                        ...shape,
                        x: geom.x,
                        y: geom.y,
                        width: geom.width,
                        height: geom.height,
                        points: geom.points,
                        arcRadius: geom.arcRadius,
                        arcLarge: geom.arcLarge,
                        arcSweep: geom.arcSweep,
                      });
                    }}
                    className="w-16 bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-stone-100 font-mono text-xs"
                  />
                </div>
                <p className="text-[10px] text-stone-500">
                  값이 작을수록 더 굽고, 클수록 직선에 가까워집니다. (최소 = 현 길이/2)
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!shape.points || shape.points.length < 2 || shape.arcRadius == null) return;
                    const absStart = {
                      x: shape.x + shape.points[0].x,
                      y: shape.y + shape.points[0].y,
                    };
                    const absEnd = {
                      x: shape.x + shape.points[1].x,
                      y: shape.y + shape.points[1].y,
                    };
                    const geom = finalizeArcGeometry(
                      absStart,
                      absEnd,
                      shape.arcRadius,
                      !!shape.arcLarge,
                      !shape.arcSweep
                    );
                    onUpdateElement({
                      ...shape,
                      x: geom.x,
                      y: geom.y,
                      width: geom.width,
                      height: geom.height,
                      points: geom.points,
                      arcRadius: geom.arcRadius,
                      arcLarge: geom.arcLarge,
                      arcSweep: geom.arcSweep,
                    });
                  }}
                  className="w-full py-1 rounded border border-stone-700 text-[11px] text-stone-300 hover:bg-stone-800"
                >
                  휘는 방향 반전
                </button>
              </div>
            )}
          </div>

          {/* Fill Type: Solid vs None vs Gradient (for non-lines) — below stroke */}
          {!isLine && (
            <div className="space-y-1.5 pt-1 border-t border-stone-700/50">
              <span className="text-[11px] text-stone-400 font-medium">면 채우기</span>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={shape.fill === 'none' ? '#ffffff' : shape.fill}
                  onChange={(e) =>
                    onUpdateElement({
                      ...shape,
                      fill: e.target.value,
                      gradient: shape.gradient ? { ...shape.gradient, enabled: false } : undefined,
                    })
                  }
                  className="w-7 h-7 rounded border border-stone-700 bg-transparent cursor-pointer"
                />
                <button
                  onClick={() =>
                    onUpdateElement({
                      ...shape,
                      fill: 'none',
                      gradient: shape.gradient ? { ...shape.gradient, enabled: false } : undefined,
                    })
                  }
                  className={`px-2 py-1 rounded border text-[11px] ${
                    shape.fill === 'none' && !shape.gradient?.enabled
                      ? 'border-amber-500 text-amber-300'
                      : 'border-stone-800 text-stone-400'
                  }`}
                >
                  투명 채우기
                </button>

                <button
                  onClick={() => {
                    const enabled = !shape.gradient?.enabled;
                    onUpdateElement({
                      ...shape,
                      gradient: {
                        enabled,
                        type: 'linear',
                        startColor: shape.fill === 'none' ? '#3B82F6' : shape.fill,
                        endColor: '#9333EA',
                        angle: 90,
                      },
                    });
                  }}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    shape.gradient?.enabled
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                      : 'border-stone-800 text-stone-400'
                  }`}
                >
                  그라데이션
                </button>
              </div>

              {shape.gradient?.enabled && (
                <div className="bg-stone-800/60 p-2 rounded border border-stone-700 space-y-2 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-stone-400">시작 / 끝 색상</span>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={shape.gradient.startColor}
                        onChange={(e) =>
                          onUpdateElement({
                            ...shape,
                            gradient: { ...shape.gradient!, startColor: e.target.value },
                          })
                        }
                        className="w-5 h-5 rounded cursor-pointer bg-transparent"
                      />
                      <input
                        type="color"
                        value={shape.gradient.endColor}
                        onChange={(e) =>
                          onUpdateElement({
                            ...shape,
                            gradient: { ...shape.gradient!, endColor: e.target.value },
                          })
                        }
                        className="w-5 h-5 rounded cursor-pointer bg-transparent"
                      />
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-stone-400">각도</span>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={shape.gradient.angle}
                      onChange={(e) =>
                        onUpdateElement({
                          ...shape,
                          gradient: { ...shape.gradient!, angle: parseInt(e.target.value) || 0 },
                        })
                      }
                      className="flex-1 accent-amber-500"
                    />
                    <span className="text-[10px] font-mono text-stone-300">{shape.gradient.angle}°</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Corner Radius for Rect */}
          {!isLine && (shape.shapeType === 'rect' || shape.shapeType === 'rounded-rect') && (
            <div className="space-y-1 pt-1 border-t border-stone-700/50">
              <div className="flex justify-between">
                <span className="text-[11px] text-stone-400">모서리 둥글기 (Radius)</span>
                <span className="font-mono text-stone-300">{shape.cornerRadius || 0}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                value={shape.cornerRadius || 0}
                onChange={(e) =>
                  onUpdateElement({ ...shape, cornerRadius: parseInt(e.target.value) || 0 })
                }
                className="w-full accent-amber-500"
              />
            </div>
          )}
        </PropertyGroup>
      )}

      {/* TEXT SPECIFIC PROPERTIES */}
      {isText && text && (
        <div className="space-y-3 pt-3 border-t border-stone-800">
          <label className="text-stone-300 font-medium block">텍스트 내용 및 서식</label>

          <div>
            <span className="text-[10px] text-stone-500 block mb-1">내용</span>
            <textarea
              value={text.text}
              onChange={(e) => onUpdateElement({ ...text, text: e.target.value })}
              rows={2}
              className="w-full h-14 max-h-24 min-h-[2.25rem] resize-y bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-stone-100 text-xs leading-snug focus:border-amber-500 outline-none"
            />
          </div>

          {/* Font Family */}
          <div>
            <span className="text-[10px] text-stone-500 block mb-1">글꼴 (Font)</span>
            <select
              value={text.fontFamily}
              onChange={(e) => onUpdateElement({ ...text, fontFamily: e.target.value })}
              className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-stone-100 text-xs focus:border-amber-500"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.name} value={f.value}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size & Color */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-stone-500 block mb-1">글자 크기 (px)</span>
              <NumberField
                value={text.fontSize}
                min={8}
                max={180}
                onChange={(v) => onUpdateElement({ ...text, fontSize: v })}
                className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 font-mono text-stone-100"
              />
            </div>
            <div>
              <span className="text-[10px] text-stone-500 block mb-1">글자 색상</span>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={text.color}
                  onChange={(e) => onUpdateElement({ ...text, color: e.target.value })}
                  className="w-7 h-7 rounded border border-stone-700 bg-transparent cursor-pointer"
                />
                <span className="font-mono text-stone-300 text-[11px]">{text.color}</span>
              </div>
            </div>
          </div>

          {/* Formatting: Bold, Italic, Underline, Align */}
          <div className="flex items-center space-x-1 pt-1">
            <button
              onClick={() => onUpdateElement({ ...text, bold: !text.bold })}
              className={`px-2.5 py-1.5 rounded border text-xs font-bold ${
                text.bold ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-stone-800 text-stone-400'
              }`}
            >
              B
            </button>
            <button
              onClick={() => onUpdateElement({ ...text, italic: !text.italic })}
              className={`px-2.5 py-1.5 rounded border text-xs italic ${
                text.italic ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-stone-800 text-stone-400'
              }`}
            >
              I
            </button>
            <button
              onClick={() => onUpdateElement({ ...text, underline: !text.underline })}
              className={`px-2.5 py-1.5 rounded border text-xs underline ${
                text.underline ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-stone-800 text-stone-400'
              }`}
            >
              U
            </button>

            <div className="w-[1px] h-6 bg-stone-800 mx-1" />

            <button
              onClick={() => onUpdateElement({ ...text, align: 'left' })}
              className={`p-1.5 rounded border ${
                text.align === 'left' ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-stone-800 text-stone-400'
              }`}
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onUpdateElement({ ...text, align: 'center' })}
              className={`p-1.5 rounded border ${
                text.align === 'center' ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-stone-800 text-stone-400'
              }`}
            >
              <AlignCenter className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onUpdateElement({ ...text, align: 'right' })}
              className={`p-1.5 rounded border ${
                text.align === 'right' ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-stone-800 text-stone-400'
              }`}
            >
              <AlignRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* IMAGE SPECIFIC PROPERTIES: Crop, Border, Corner Radius, Flip, Filters */}
      {isImage && img && (
        <div className="space-y-4 pt-3 border-t border-stone-800">
          {/* 1. Picture Crop — compact controls only */}
          <div className="space-y-1.5">
            {croppingImageId === img.id ? (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const crop =
                      activeCropBox && activeCropBox.w >= 5
                        ? activeCropBox
                        : { x: 0, y: 0, w: img.width, h: img.height };
                    onCutImagePart?.(img, crop);
                  }}
                  className="py-1.5 px-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1"
                  title="오려내기 (Ctrl+X)"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>오려내기</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const crop =
                      activeCropBox && activeCropBox.w >= 5
                        ? activeCropBox
                        : { x: 0, y: 0, w: img.width, h: img.height };
                    onCopyImagePart?.(img, crop);
                  }}
                  className="py-1.5 px-2 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1"
                  title="복사 (Ctrl+C)"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>복사</span>
                </button>
                <button
                  type="button"
                  onClick={() => onApplyCropImage?.()}
                  className="py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold text-xs rounded transition-colors"
                  title="남기기 (Enter)"
                >
                  남기기
                </button>
                <button
                  type="button"
                  onClick={() => onCancelCropImage?.()}
                  className="py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs rounded transition-colors"
                  title="취소 (Esc)"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onStartCropImage?.(img.id)}
                className="w-full py-2 bg-stone-800 hover:bg-stone-700 border border-stone-700 hover:border-amber-500/50 text-stone-200 hover:text-amber-300 font-medium text-xs rounded-md transition-all flex items-center justify-center gap-1.5"
                title="그림 자르기 (C)"
              >
                <Crop className="w-3.5 h-3.5 text-amber-400" />
                <span>그림 자르기</span>
              </button>
            )}
          </div>

          {/* 2. Picture Border & Corner Radius (PowerPoint Style) */}
          <div className="space-y-3 pt-1">
            <label className="text-stone-300 font-medium block text-xs">그림 스타일 (테두리 및 모서리)</label>

            {/* Corner Radius */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-stone-400">모서리 둥글기 (Radius)</span>
                <span className="font-mono text-stone-300">{img.cornerRadius || 0}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="120"
                value={img.cornerRadius || 0}
                onChange={(e) =>
                  onUpdateElement({ ...img, cornerRadius: parseInt(e.target.value) || 0 })
                }
                className="w-full accent-amber-500"
              />
              <div className="flex items-center space-x-1 pt-0.5">
                <button
                  onClick={() => onUpdateElement({ ...img, cornerRadius: 0 })}
                  className={`flex-1 py-0.5 rounded border text-[10px] ${
                    !img.cornerRadius ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                  }`}
                >
                  각진 모서리 (0px)
                </button>
                <button
                  onClick={() => onUpdateElement({ ...img, cornerRadius: 24 })}
                  className={`flex-1 py-0.5 rounded border text-[10px] ${
                    img.cornerRadius === 24 ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                  }`}
                >
                  둥근 모서리 (24px)
                </button>
                <button
                  onClick={() => onUpdateElement({ ...img, cornerRadius: Math.min(img.width, img.height) / 2 })}
                  className={`flex-1 py-0.5 rounded border text-[10px] ${
                    img.cornerRadius && img.cornerRadius >= Math.min(img.width, img.height) / 2 - 2
                      ? 'border-amber-500 text-amber-300'
                      : 'border-stone-800 text-stone-400'
                  }`}
                >
                  원형 / 알약
                </button>
              </div>
            </div>

            {/* Border Width & Color */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-stone-400">그림 외곽 테두리 (Border)</span>
                <span className="font-mono text-stone-300">{img.borderWidth || 0}px</span>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={img.borderColor || '#000000'}
                  onChange={(e) => onUpdateElement({ ...img, borderColor: e.target.value })}
                  className="w-7 h-7 rounded border border-stone-700 bg-transparent cursor-pointer"
                />
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={img.borderWidth || 0}
                  onChange={(e) =>
                    onUpdateElement({ ...img, borderWidth: parseInt(e.target.value) || 0 })
                  }
                  className="flex-1 accent-amber-500"
                />
                <span className="text-xs font-mono text-stone-400 w-8 text-right">{img.borderWidth || 0}px</span>
              </div>
            </div>
          </div>

          {/* 3. Image Correction & Filters */}
          <div className="space-y-3 pt-2 border-t border-stone-800">
            <div className="flex items-center justify-between">
              <label className="text-stone-300 font-medium flex items-center space-x-1">
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>이미지 보정 및 필터</span>
              </label>
              <button
                onClick={() =>
                  onUpdateElement({
                    ...img,
                    filters: {
                      brightness: 100,
                      contrast: 100,
                      saturation: 100,
                      blur: 0,
                      grayscale: 0,
                      invert: 0,
                    },
                  })
                }
                className="text-[10px] text-amber-400 hover:underline"
              >
                필터 초기화
              </button>
            </div>

          {/* Background Removal */}
          {onRemoveImageBackground && (
            <div className="space-y-1.5 rounded border border-stone-800 p-2">
              <div className="flex items-center justify-between">
                <label className="text-stone-300 font-medium text-[11px] flex items-center space-x-1">
                  <Eraser className="w-3.5 h-3.5 text-amber-400" />
                  <span>배경 제거</span>
                </label>
                <button
                  id="btn-remove-bg"
                  onClick={() => onRemoveImageBackground(img, bgTolerance)}
                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold transition-colors"
                  title="단색·균일한 배경을 투명하게 지웁니다"
                >
                  적용
                </button>
              </div>
              <div className="flex items-center space-x-2 text-[11px]">
                <span className="text-[10px] text-stone-400 shrink-0">
                  허용치 <span className="text-amber-400 font-semibold">{bgTolerance}%</span>
                </span>
                <input
                  id="bg-removal-tolerance"
                  type="range"
                  min="5"
                  max="80"
                  step="1"
                  value={bgTolerance}
                  onChange={(e) => setBgTolerance(Number(e.target.value))}
                  className="flex-1 accent-amber-500 cursor-pointer"
                />
              </div>
              <p className="text-[10px] text-stone-500 leading-snug">
                가장자리에서 안쪽으로 배경색을 채워 지웁니다. 배경과 색이 비슷한 부분도 함께 지워질 수 있습니다.
              </p>
            </div>
          )}

          {/* Filter sliders — compact single-row: short label | slider | value */}
          <div className="space-y-1 pt-1 text-[11px]">
            {(
              [
                { key: 'brightness' as const, label: '밝기', min: 0, max: 200, unit: '%' },
                { key: 'contrast' as const, label: '대비', min: 0, max: 200, unit: '%' },
                { key: 'saturation' as const, label: '채도', min: 0, max: 200, unit: '%' },
                { key: 'blur' as const, label: '흐림', min: 0, max: 20, unit: 'px' },
                { key: 'grayscale' as const, label: '흑백', min: 0, max: 100, unit: '%' },
                { key: 'invert' as const, label: '반전', min: 0, max: 100, unit: '%' },
              ] as const
            ).map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <span className="w-7 shrink-0 text-stone-400 text-[11px]">{row.label}</span>
                <input
                  type="range"
                  min={row.min}
                  max={row.max}
                  value={img.filters[row.key]}
                  onChange={(e) =>
                    onUpdateElement({
                      ...img,
                      filters: {
                        ...img.filters,
                        [row.key]: parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="flex-1 min-w-0 accent-amber-500 h-1.5"
                  title={`${row.label} ${img.filters[row.key]}${row.unit}`}
                />
                <span className="w-9 shrink-0 text-right font-mono text-[10px] text-stone-400 tabular-nums">
                  {img.filters[row.key]}
                  {row.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
        </div>
      )}

      {/* DROP SHADOW (Supports all elements) */}
      <PropertyGroup
        title="그림자 효과"
        headerRight={
          <input
            type="checkbox"
            checked={!!selectedElement.shadow?.enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              onUpdateElement({
                ...selectedElement,
                shadow: {
                  enabled,
                  color: selectedElement.shadow?.color || '#000000',
                  blur: selectedElement.shadow?.blur || 8,
                  offsetX: selectedElement.shadow?.offsetX || 4,
                  offsetY: selectedElement.shadow?.offsetY || 4,
                },
              });
            }}
            className="rounded border-stone-600 text-amber-500 focus:ring-0 cursor-pointer"
            title="그림자 켜기/끄기"
          />
        }
      >
        {selectedElement.shadow?.enabled ? (
          <div className="bg-stone-800/60 p-2.5 rounded border border-stone-700 space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-stone-400">그림자 색상</span>
              <input
                type="color"
                value={selectedElement.shadow.color}
                onChange={(e) =>
                  onUpdateElement({
                    ...selectedElement,
                    shadow: { ...selectedElement.shadow!, color: e.target.value },
                  })
                }
                className="w-5 h-5 rounded cursor-pointer bg-transparent"
              />
            </div>
            <div>
              <div className="flex justify-between text-stone-400">
                <span>흐림 반경 (Blur)</span>
                <span className="font-mono">{selectedElement.shadow.blur}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={selectedElement.shadow.blur}
                onChange={(e) =>
                  onUpdateElement({
                    ...selectedElement,
                    shadow: { ...selectedElement.shadow!, blur: parseInt(e.target.value) },
                  })
                }
                className="w-full accent-amber-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-stone-500 block mb-0.5">X 오프셋</span>
                <NumberField
                  value={selectedElement.shadow.offsetX}
                  onChange={(v) =>
                    onUpdateElement({
                      ...selectedElement,
                      shadow: { ...selectedElement.shadow!, offsetX: v },
                    })
                  }
                  className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono"
                />
              </div>
              <div>
                <span className="text-[10px] text-stone-500 block mb-0.5">Y 오프셋</span>
                <NumberField
                  value={selectedElement.shadow.offsetY}
                  onChange={(v) =>
                    onUpdateElement({
                      ...selectedElement,
                      shadow: { ...selectedElement.shadow!, offsetY: v },
                    })
                  }
                  className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 font-mono"
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-stone-500">그림자를 사용하려면 우측 체크박스를 켜세요.</p>
        )}
      </PropertyGroup>

      {/* ARRANGE / Z-ORDER & ALIGNMENT (PowerPoint style) */}
      <PropertyGroup title="정렬 및 순서">
        {/* Z-order controls */}
        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={() => onBringToFront(selectedElement.id)}
            className="flex flex-col items-center p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-[10px] text-stone-300 hover:text-white"
            title="맨 앞으로 가져오기"
          >
            <BringToFront className="w-3.5 h-3.5 mb-1 text-amber-400" />
            <span>맨 앞</span>
          </button>
          <button
            onClick={() => onBringForward(selectedElement.id)}
            className="flex flex-col items-center p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-[10px] text-stone-300 hover:text-white"
            title="앞으로 가져오기"
          >
            <ArrowUp className="w-3.5 h-3.5 mb-1 text-stone-400" />
            <span>앞으로</span>
          </button>
          <button
            onClick={() => onSendBackward(selectedElement.id)}
            className="flex flex-col items-center p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-[10px] text-stone-300 hover:text-white"
            title="뒤로 보내기"
          >
            <ArrowDown className="w-3.5 h-3.5 mb-1 text-stone-400" />
            <span>뒤로</span>
          </button>
          <button
            onClick={() => onSendToBack(selectedElement.id)}
            className="flex flex-col items-center p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-[10px] text-stone-300 hover:text-white"
            title="맨 뒤로 보내기"
          >
            <SendToBack className="w-3.5 h-3.5 mb-1 text-amber-400" />
            <span>맨 뒤</span>
          </button>
        </div>

        {/* Alignment relative to canvas */}
        <div className="grid grid-cols-6 gap-1 pt-1">
          <button
            onClick={() => onAlign('left')}
            className="p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-stone-400 hover:text-stone-200 flex justify-center"
            title="왼쪽 맞춤"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onAlign('center')}
            className="p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-stone-400 hover:text-stone-200 flex justify-center"
            title="가운데 맞춤"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onAlign('right')}
            className="p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-stone-400 hover:text-stone-200 flex justify-center"
            title="오른쪽 맞춤"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onAlign('top')}
            className="p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-stone-400 hover:text-stone-200 flex justify-center"
            title="위쪽 맞춤"
          >
            <AlignVerticalJustifyStart className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onAlign('middle')}
            className="p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-stone-400 hover:text-stone-200 flex justify-center"
            title="중간 맞춤"
          >
            <AlignVerticalJustifyCenter className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onAlign('bottom')}
            className="p-1.5 rounded border border-stone-800 hover:bg-stone-800 text-stone-400 hover:text-stone-200 flex justify-center"
            title="아래쪽 맞춤"
          >
            <AlignVerticalJustifyEnd className="w-3.5 h-3.5" />
          </button>
        </div>
      </PropertyGroup>
    </aside>
  );
};
