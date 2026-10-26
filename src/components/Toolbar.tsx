import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer,
  Hand,
  Paintbrush,
  Highlighter,
  Eraser,
  Shapes,
  Type,
  Pipette,
  PaintBucket,
  Camera,
  Square,
  Circle,
  Triangle,
  Star,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  MoveHorizontal,
  MessageSquare,
  Heart,
  Hexagon,
  Diamond,
  Minus,
  ArrowUpRight,
  Waypoints,
  Spline,
  ChevronDown,
  X,
  Group,
  Ungroup,
} from 'lucide-react';
import { ToolType, ShapeType, CanvasElement } from '../types';
import { OFFICE_THEME_PALETTES, PAINT_COLORS } from '../utils/colorUtils';
import { RadialArrayIcon } from './RadialArrayIcon';

interface ToolbarProps {
  currentTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  selectedShapeType: ShapeType;
  onSelectShapeType: (shape: ShapeType) => void;
  primaryColor: string;
  onPrimaryColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  // Group / Ungroup
  onGroup?: () => void;
  onUngroup?: () => void;
  selectedElementIds: string[];
  elements: CanvasElement[];
  onSelectMultipleElements?: (ids: string[]) => void;
}

const SHAPE_ITEMS: { type: ShapeType; label: string; icon: React.ReactNode }[] = [
  { type: 'rect', label: '직사각형', icon: <Square className="w-4 h-4" /> },
  { type: 'rounded-rect', label: '둥근 모서리 사각형', icon: <Square className="w-4 h-4 rounded-sm" /> },
  { type: 'ellipse', label: '타원 / 원', icon: <Circle className="w-4 h-4" /> },
  { type: 'triangle', label: '삼각형', icon: <Triangle className="w-4 h-4" /> },
  { type: 'diamond', label: '다이아몬드 (마름모)', icon: <span className="text-xs font-bold">◇</span> },
  { type: 'star', label: '오각별', icon: <Star className="w-4 h-4" /> },
  { type: 'arrow-right', label: '블록 오른쪽 화살표', icon: <ArrowRight className="w-4 h-4" /> },
  { type: 'arrow-bidirectional', label: '양방향 화살표', icon: <MoveHorizontal className="w-4 h-4" /> },
  { type: 'speech-bubble', label: '말풍선 (Callout)', icon: <MessageSquare className="w-4 h-4" /> },
  { type: 'heart', label: '하트 도형', icon: <Heart className="w-4 h-4" /> },
  { type: 'hexagon', label: '육각형', icon: <Hexagon className="w-4 h-4" /> },
  { type: 'line', label: '직선', icon: <Minus className="w-4 h-4" /> },
  { type: 'line-arrow', label: '화살표 선', icon: <ArrowUpRight className="w-4 h-4" /> },
  { type: 'polyline', label: '연속 선그리기', icon: <Waypoints className="w-4 h-4" /> },
  { type: 'arc', label: '아크 (호)', icon: <Spline className="w-4 h-4" /> },
];

const ARROW_LINE_TYPES: { type: ShapeType; label: string; icon: React.ReactNode }[] = [
  { type: 'line-arrow', label: '끝 화살표 (기본)', icon: <ArrowUpRight className="w-4 h-4" /> },
  { type: 'line-arrow-both', label: '양끝 화살표', icon: <ArrowLeftRight className="w-4 h-4" /> },
  { type: 'line-arrow-start', label: '시작 화살표', icon: <ArrowLeft className="w-4 h-4" /> },
  { type: 'line-arrow-open', label: '열린 화살표', icon: <ArrowRight className="w-4 h-4" /> },
  { type: 'line-arrow-dot', label: '끝 점', icon: <Circle className="w-4 h-4" /> },
  { type: 'line-arrow-diamond', label: '끝 마름모', icon: <Diamond className="w-4 h-4" /> },
];

const STROKE_WIDTHS = [1, 2, 4, 8, 12, 20];

export const Toolbar: React.FC<ToolbarProps> = ({
  currentTool,
  onSelectTool,
  selectedShapeType,
  onSelectShapeType,
  primaryColor,
  onPrimaryColorChange,
  strokeWidth,
  onStrokeWidthChange,
  onGroup,
  onUngroup,
  selectedElementIds,
  elements,
  onSelectMultipleElements,
}) => {
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showArrowMenu, setShowArrowMenu] = useState(false);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const arrowMenuRef = useRef<HTMLDivElement>(null);
  const eyedropperBtnRef = useRef<HTMLButtonElement>(null);
  const colorPaletteRef = useRef<HTMLDivElement>(null);
  const selectClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Close shape / arrow / color menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (shapeMenuRef.current && !shapeMenuRef.current.contains(target)) {
        setShowShapeMenu(false);
      }
      if (arrowMenuRef.current && !arrowMenuRef.current.contains(target)) {
        setShowArrowMenu(false);
      }
      const onEyedropper =
        eyedropperBtnRef.current?.contains(target) ||
        colorPaletteRef.current?.contains(target);
      if (!onEyedropper) {
        setShowColorPalette(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (selectClickTimerRef.current) {
        clearTimeout(selectClickTimerRef.current);
      }
    };
  }, []);

  // Keyboard shortcut (K) also opens the color palette
  useEffect(() => {
    if (currentTool === 'eyedropper') {
      setShowColorPalette(true);
    }
  }, [currentTool]);

  const currentShape = SHAPE_ITEMS.find((s) => s.type === selectedShapeType) || SHAPE_ITEMS[0];
  const displayColor = primaryColor.startsWith('#')
    ? primaryColor.toUpperCase()
    : primaryColor;

  // Handle single-click on Select tool
  const handleSelectClick = () => {
    if (selectClickTimerRef.current) {
      clearTimeout(selectClickTimerRef.current);
      selectClickTimerRef.current = null;
    }
    
    selectClickTimerRef.current = setTimeout(() => {
      onSelectTool('select');
      selectClickTimerRef.current = null;
    }, 250);
  };

  // Handle double-click on Select tool - select all objects
  const handleSelectDoubleClick = () => {
    if (selectClickTimerRef.current) {
      clearTimeout(selectClickTimerRef.current);
      selectClickTimerRef.current = null;
    }
    
    // Select all visible and unlocked elements
    if (onSelectMultipleElements) {
      const allSelectableIds = elements
        .filter((el) => el.visible !== false && el.locked !== true)
        .map((el) => el.id);
      onSelectMultipleElements(allSelectableIds);
    }
    
    // Keep select tool active
    onSelectTool('select');
  };

  return (
    <div className="h-12 bg-stone-900/95 border-b border-stone-800 text-stone-200 px-4 flex items-center justify-between select-none z-20 shrink-0 overflow-visible">
      {/* Left: Tools List */}
      <div className="flex items-center space-x-1">
        {/* Select Tool */}
        <button
          id="tool-select"
          onClick={handleSelectClick}
          onDoubleClick={handleSelectDoubleClick}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'select'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="선택 / 이동 도구 (V) — 더블클릭: 전체 선택"
        >
          <MousePointer className="w-4 h-4" />
        </button>

        {/* Pan Tool */}
        <button
          id="tool-pan"
          onClick={() => onSelectTool('pan')}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'pan'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="손 / 화면 이동 도구 (H, Space+드래그)"
        >
          <Hand className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-6 bg-stone-800 mx-1" />

        {/* Brush */}
        <button
          id="tool-brush"
          onClick={() => onSelectTool('brush')}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'brush'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="브러시 / 펜 도구 (B)"
        >
          <Paintbrush className="w-4 h-4" />
        </button>

        {/* Highlighter */}
        <button
          id="tool-highlighter"
          onClick={() => onSelectTool('highlighter')}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'highlighter'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="형광펜 도구 (Y)"
        >
          <Highlighter className="w-4 h-4" />
        </button>

        {/* Eraser */}
        <button
          id="tool-eraser"
          onClick={() => onSelectTool('eraser')}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'eraser'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="지우개 도구 (E)"
        >
          <Eraser className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-6 bg-stone-800 mx-1" />

        {/* Quick Shape Buttons: Straight Line, Arrow Line, Rectangle, Circle */}
        <button
          id="tool-quick-line"
          onClick={() => {
            onSelectShapeType('line');
            onSelectTool('shape');
          }}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'shape' && selectedShapeType === 'line'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="직선 그리기"
        >
          <Minus className="w-4 h-4" />
        </button>

        {/* Arrow Line Dropdown — PowerPoint-style arrow variants */}
        <div className="relative" ref={arrowMenuRef}>
          <button
            id="tool-quick-line-arrow"
            onClick={() => {
              onSelectTool('shape');
              setShowArrowMenu(!showArrowMenu);
            }}
            className={`flex items-center gap-0.5 p-2 rounded-md transition-colors ${
              currentTool === 'shape' &&
              [
                'line-arrow',
                'line-arrow-both',
                'line-arrow-start',
                'line-arrow-open',
                'line-arrow-dot',
                'line-arrow-diamond',
              ].includes(selectedShapeType)
                ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                : 'text-stone-300 hover:text-white hover:bg-stone-800'
            }`}
            title="화살표 선 그리기 (길게 눌러 종류 선택)"
            aria-label="화살표 선 종류"
          >
            {selectedShapeType === 'line-arrow-both' && (
              <>
                <ArrowLeftRight className="w-4 h-4" />
              </>
            )}
            {selectedShapeType === 'line-arrow-start' && (
              <>
                <ArrowLeft className="w-4 h-4" />
              </>
            )}
            {selectedShapeType === 'line-arrow-open' && (
              <>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
            {selectedShapeType === 'line-arrow-dot' && (
              <>
                <Circle className="w-4 h-4" strokeWidth={2} />
              </>
            )}
            {selectedShapeType === 'line-arrow-diamond' && (
              <>
                <Diamond className="w-4 h-4" />
              </>
            )}
            {(selectedShapeType === 'line-arrow' ||
              (selectedShapeType !== 'line-arrow-both' &&
                selectedShapeType !== 'line-arrow-start' &&
                selectedShapeType !== 'line-arrow-open' &&
                selectedShapeType !== 'line-arrow-dot' &&
                selectedShapeType !== 'line-arrow-diamond')) && (
              <ArrowUpRight className="w-4 h-4" />
            )}
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </button>

          {showArrowMenu && (
            <div className="absolute left-0 top-full mt-1.5 w-52 bg-stone-900 border border-stone-700 rounded-lg shadow-2xl p-2 z-50">
              <div className="text-[11px] font-semibold text-stone-400 px-2 py-1">
                화살표 선 종류 (파워포인트 스타일)
              </div>
              {ARROW_LINE_TYPES.map((item) => (
                <button
                  key={item.type}
                  id={`arrow-option-${item.type}`}
                  onClick={() => {
                    onSelectShapeType(item.type);
                    onSelectTool('shape');
                    setShowArrowMenu(false);
                  }}
                  className={`flex items-center space-x-2 px-2 py-2 rounded text-xs text-left transition-colors ${
                    selectedShapeType === item.type && currentTool === 'shape'
                      ? 'bg-amber-500/20 text-amber-400 font-medium'
                      : 'text-stone-300 hover:bg-stone-800 hover:text-white'
                  }`}
                >
                  <span className="text-stone-400 flex items-center justify-center w-6 h-6">
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          id="tool-quick-polyline"
          onClick={() => {
            onSelectShapeType('polyline');
            onSelectTool('shape');
          }}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'shape' && selectedShapeType === 'polyline'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="연속 선그리기 — 클릭으로 노드 연결, 더블클릭/Enter로 완료, Esc 취소 (Shift=각도 스냅)"
        >
          <Waypoints className="w-4 h-4" />
        </button>

        <button
          id="tool-quick-arc"
          onClick={() => {
            onSelectShapeType('arc');
            onSelectTool('shape');
          }}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'shape' && selectedShapeType === 'arc'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="아크 그리기 — 시작점 → 끝점 → 드래그로 반지름(휘어짐) 지정 후 클릭 완료"
        >
          <Spline className="w-4 h-4" />
        </button>

        <button
          id="tool-quick-rect"
          onClick={() => {
            onSelectShapeType('rect');
            onSelectTool('shape');
          }}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'shape' && selectedShapeType === 'rect'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="직사각형 그리기"
        >
          <Square className="w-4 h-4" />
        </button>

        <button
          id="tool-quick-circle"
          onClick={() => {
            onSelectShapeType('ellipse');
            onSelectTool('shape');
          }}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'shape' && selectedShapeType === 'ellipse'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="원 / 타원 그리기"
        >
          <Circle className="w-4 h-4" />
        </button>

        {/* Shapes Menu Dropdown for Other PPT Shapes */}
        <div className="relative" ref={shapeMenuRef}>
          <button
            id="tool-shape"
            onClick={() => {
              onSelectTool('shape');
              setShowShapeMenu(!showShapeMenu);
            }}
            className={`flex items-center gap-0.5 p-2 rounded-md transition-colors ${
              currentTool === 'shape' &&
              selectedShapeType !== 'line' &&
              selectedShapeType !== 'line-arrow' &&
              selectedShapeType !== 'line-arrow-both' &&
              selectedShapeType !== 'line-arrow-start' &&
              selectedShapeType !== 'line-arrow-open' &&
              selectedShapeType !== 'line-arrow-dot' &&
              selectedShapeType !== 'line-arrow-diamond' &&
              selectedShapeType !== 'polyline' &&
              selectedShapeType !== 'arc' &&
              selectedShapeType !== 'rect' &&
              selectedShapeType !== 'ellipse'
                ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                : 'text-stone-300 hover:text-white hover:bg-stone-800'
            }`}
            title={
              selectedShapeType !== 'line' &&
              selectedShapeType !== 'line-arrow' &&
              selectedShapeType !== 'line-arrow-both' &&
              selectedShapeType !== 'line-arrow-start' &&
              selectedShapeType !== 'line-arrow-open' &&
              selectedShapeType !== 'line-arrow-dot' &&
              selectedShapeType !== 'line-arrow-diamond' &&
              selectedShapeType !== 'polyline' &&
              selectedShapeType !== 'arc' &&
              selectedShapeType !== 'rect' &&
              selectedShapeType !== 'ellipse'
                ? `${currentShape.label} (U)`
                : '기타 도형 모음 (U)'
            }
            aria-label="기타 도형 모음"
          >
            {selectedShapeType !== 'line' &&
            selectedShapeType !== 'line-arrow' &&
            selectedShapeType !== 'polyline' &&
            selectedShapeType !== 'arc' &&
            selectedShapeType !== 'rect' &&
            selectedShapeType !== 'ellipse' ? (
              <span className="flex items-center justify-center w-5 h-5 [&>svg]:w-5 [&>svg]:h-5">
                {currentShape.icon}
              </span>
            ) : (
              <Shapes className="w-5 h-5" />
            )}
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </button>

          {showShapeMenu && (
            <div className="absolute left-0 top-full mt-1.5 w-60 bg-stone-900 border border-stone-700 rounded-lg shadow-2xl p-2 z-50 grid grid-cols-2 gap-1 max-h-80 overflow-y-auto">
              <div className="col-span-2 text-[11px] font-semibold text-stone-400 px-2 py-1">
                MS 파워포인트 도형 모음 (13종)
              </div>
              {SHAPE_ITEMS.map((item) => (
                <button
                  key={item.type}
                  id={`shape-option-${item.type}`}
                  onClick={() => {
                    onSelectShapeType(item.type);
                    onSelectTool('shape');
                    setShowShapeMenu(false);
                  }}
                  className={`flex items-center space-x-2 px-2 py-2 rounded text-xs text-left transition-colors ${
                    selectedShapeType === item.type && currentTool === 'shape'
                      ? 'bg-amber-500/20 text-amber-400 font-medium'
                      : 'text-stone-300 hover:bg-stone-800 hover:text-white'
                  }`}
                >
                  <span className="text-stone-400">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Text */}
        <button
          id="tool-text"
          onClick={() => onSelectTool('text')}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'text'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="텍스트 상자 도구 (T)"
        >
          <Type className="w-4 h-4" />
        </button>

        {/* Eyedropper — opens color palette at canvas top-right */}
        <button
          ref={eyedropperBtnRef}
          id="tool-eyedropper"
          onClick={() => {
            onSelectTool('eyedropper');
            setShowColorPalette(true);
            setShowShapeMenu(false);
          }}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'eyedropper' || showColorPalette
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="색상 팔레트 / 스포이트 (K)"
        >
          <Pipette className="w-4 h-4" />
        </button>

        {showColorPalette &&
          createPortal(
            <div
              ref={colorPaletteRef}
              id="color-palette-panel"
              className="fixed z-[60] top-[6.75rem] right-[18.75rem] w-[12.6rem] bg-stone-900/95 border border-stone-700 rounded-lg shadow-2xl overflow-hidden backdrop-blur-sm"
            >
              <div className="flex items-center justify-between px-2 py-1.5 border-b border-stone-800">
                <div className="flex items-center gap-1 text-[10px] font-semibold text-stone-200">
                  <Pipette className="w-3 h-3 text-amber-400" />
                  <span>컬러 팔레트</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowColorPalette(false)}
                  className="p-0.5 rounded text-stone-400 hover:text-white hover:bg-stone-800"
                  title="닫기"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              <div className="p-2 space-y-1.5 max-h-[calc(100vh-11rem)] overflow-y-auto">
                {OFFICE_THEME_PALETTES.map((palette) => (
                  <div key={palette.name}>
                    <div className="text-[9px] text-stone-400 font-medium mb-1 truncate">
                      {palette.name}
                    </div>
                    <div className="flex gap-0.5">
                      {palette.colors.map((c) => (
                        <button
                          key={`${palette.name}-${c}`}
                          type="button"
                          onClick={() => onPrimaryColorChange(c)}
                          className={`w-5 h-5 rounded border transition-transform hover:scale-105 ${
                            primaryColor.toLowerCase() === c.toLowerCase()
                              ? 'border-amber-400 ring-1 ring-amber-400 z-10'
                              : 'border-stone-700/70'
                          }`}
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between gap-2 border-t border-stone-800 pt-1">
                  <span className="text-[9px] text-stone-400 shrink-0">사용자 지정</span>
                  <label className="flex-1 flex justify-end cursor-pointer min-w-0" title="사용자 지정 색 선택">
                    <span
                      className="block w-12 h-4 rounded border border-stone-600 shadow-inner"
                      style={{
                        backgroundColor: primaryColor.startsWith('#') ? primaryColor : '#000000',
                      }}
                    />
                    <input
                      type="color"
                      value={primaryColor.startsWith('#') ? primaryColor : '#000000'}
                      onChange={(e) => onPrimaryColorChange(e.target.value)}
                      className="w-0 h-0 opacity-0 absolute"
                    />
                  </label>
                </div>
              </div>

              <div className="px-2 py-1.5 border-t border-stone-700 bg-stone-950/80 flex items-center gap-1.5">
                <div
                  className="w-5 h-5 rounded border border-stone-600 shadow-inner shrink-0"
                  style={{
                    backgroundColor: primaryColor.startsWith('#') ? primaryColor : '#000000',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-amber-300 tracking-wide truncate">
                    {displayColor}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* Paint Bucket */}
        <button
          id="tool-fill"
          onClick={() => onSelectTool('fill')}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'fill'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="페인트통 / 채우기 도구 (G)"
        >
          <PaintBucket className="w-4 h-4" />
        </button>

        {/* Crop Tool — always emphasized (frequently used) + reserved space on its right */}
        <button
          id="tool-crop"
          onClick={() => onSelectTool('crop')}
          className={`p-2 rounded-md border transition-colors ${
            currentTool === 'crop'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-md border-amber-400 ring-2 ring-amber-400/60'
              : 'text-amber-300 bg-amber-500/15 border-amber-500/50 hover:bg-amber-500/30 hover:text-amber-100'
          }`}
          title="화면 캡처 (Crop) - 드래그 후 Ctrl+C로 캡처 복사, Ctrl+V로 붙여넣기 (C)"
        >
          <Camera className="w-4 h-4" />
        </button>

        {/* Radial Object Tool — create radial arrays of objects */}
        <button
          id="tool-radial"
          onClick={() => onSelectTool('radial')}
          className={`p-2 rounded-md transition-colors ${
            currentTool === 'radial'
              ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
              : 'text-stone-300 hover:text-white hover:bg-stone-800'
          }`}
          title="방사상 배열 (R) — 선택한 개체를 원형으로 반복 배치. 캔버스 클릭(중심) → 반지름 조절 → Enter 확정"
        >
          <RadialArrayIcon className="w-4 h-4" />
        </button>

        {/* Group / Ungroup Tools */}
        <div className="flex items-center space-x-1 px-2 border-l border-stone-800">
          <button
            id="tool-group"
            onClick={onGroup}
            className={`p-2 rounded-md transition-colors ${
              selectedElementIds.length < 2
                ? 'text-stone-600 cursor-not-allowed'
                : 'text-stone-400 hover:text-white hover:bg-stone-800'
            }`}
            title="그룹화 (Ctrl+G) — 선택한 개체들을 하나의 그룹으로 묶기"
            disabled={selectedElementIds.length < 2}
          >
            <Group className="w-4 h-4" />
          </button>
          <button
            id="tool-ungroup"
            onClick={onUngroup}
            className={`p-2 rounded-md transition-colors ${
              !selectedElementIds.some((id) => elements.some((el) => el.id === id && el.groupId))
                ? 'text-stone-600 cursor-not-allowed'
                : 'text-stone-400 hover:text-white hover:bg-stone-800'
            }`}
            title="그룹 해제 (Ctrl+Shift+G) — 선택된 그룹을 개별 개체로 풀기"
            disabled={!selectedElementIds.some((id) => elements.some((el) => el.id === id && el.groupId))}
          >
            <Ungroup className="w-4 h-4" />
          </button>
        </div>

        {/* Empty spacer (~1 button width) so the crop button stands out */}
        <div className="w-9 shrink-0" aria-hidden="true" />
      </div>

      {/* Center/Right: Stroke Width & Quick Color Palette */}
      <div className="flex items-center space-x-3">
        {/* Stroke Width Selector */}
        <div className="flex items-center space-x-1.5 px-2 border-l border-stone-800">
          <span className="text-xs text-stone-400 mr-1 hidden sm:inline">두께:</span>
          <div className="flex items-center space-x-1">
            {STROKE_WIDTHS.map((width) => (
              <button
                key={width}
                id={`stroke-width-${width}`}
                onClick={() => onStrokeWidthChange(width)}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                  strokeWidth === width
                    ? 'bg-stone-700 text-amber-400 font-bold'
                    : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                }`}
                title={`선 두께 ${width}px`}
              >
                <div
                  className="rounded-full bg-current"
                  style={{ width: Math.min(width + 2, 14), height: Math.min(width + 2, 14) }}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Primary Color Selector */}
        <div className="flex items-center space-x-2 pl-2 border-l border-stone-800">
          {/* Active color preview button with native color input */}
          <div className="relative group">
            <label
              htmlFor="primary-color-input"
              className="w-7 h-7 rounded border-2 border-stone-600 block shadow-inner cursor-pointer"
              style={{ backgroundColor: primaryColor }}
              title="색상 선택 (클릭하여 팔레트 열기)"
            />
            <input
              id="primary-color-input"
              type="color"
              value={primaryColor.startsWith('#') ? primaryColor : '#000000'}
              onChange={(e) => onPrimaryColorChange(e.target.value)}
              className="opacity-0 absolute -top-1 -left-1 w-0 h-0"
            />
          </div>

          {/* Quick Palette (Classic 20 Paint colors in 2 rows) */}
          <div className="grid grid-cols-10 gap-0.5">
            {PAINT_COLORS.map((c, i) => (
              <button
                key={`${c}-${i}`}
                id={`palette-color-${i}`}
                onClick={() => onPrimaryColorChange(c)}
                className={`w-4 h-4 rounded-sm border ${
                  primaryColor.toLowerCase() === c.toLowerCase()
                    ? 'border-amber-400 ring-1 ring-amber-400 scale-110 z-10'
                    : 'border-stone-700/60 hover:scale-110'
                } transition-transform`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
