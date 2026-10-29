import React, { useRef } from 'react';
import {
  FolderOpen,
  Save,
  Download,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Frame,
  Grid,
  Ruler,
  Image as ImageIcon,
  FilePlus2,
  Keyboard,
  Magnet,
  ClipboardPaste,
} from 'lucide-react';
import { CanvasConfig } from '../types';
import { clampManualZoom } from '../utils/viewportFit';

interface HeaderNavbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  zoom: number;
  onZoomChange: (newZoom: number) => void;
  onZoomFit: () => void;
  onZoom100: () => void;
  config: CanvasConfig;
  onUpdateConfig: (partial: Partial<CanvasConfig>) => void;
  onOpenNewCanvas: () => void;
  onOpenExport: () => void;
  onOpenShortcuts: () => void;
  onSaveProject: () => void;
  onLoadProject: (file: File) => void;
  onInsertImage: (file: File) => void;
  onPasteFromClipboard?: () => void;
  onFitCanvasToContent?: () => void;
  canFitCanvas?: boolean;
  fitPreview?: string | null;
}

export const HeaderNavbar: React.FC<HeaderNavbarProps> = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  zoom,
  onZoomChange,
  onZoomFit,
  onZoom100,
  config,
  onUpdateConfig,
  onOpenNewCanvas,
  onOpenExport,
  onOpenShortcuts,
  onSaveProject,
  onLoadProject,
  onInsertImage,
  onPasteFromClipboard,
  onFitCanvasToContent,
  canFitCanvas = false,
  fitPreview = null,
}) => {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onLoadProject(file);
      e.target.value = '';
    }
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onInsertImage(file);
      e.target.value = '';
    }
  };

  return (
    <header className="h-14 bg-stone-900 border-b border-stone-800 text-stone-200 px-3 flex items-center gap-2 select-none z-30 shrink-0 overflow-x-auto">
      {/* Hidden file inputs */}
      <input
        ref={projectInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleProjectFileChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />

      {/* Brand & File Operations */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-2 mr-3 pr-3 border-r border-stone-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center shadow-sm">
            <span className="font-bold text-white text-sm tracking-tighter">IM</span>
          </div>
          <div>
            <h1 className="font-semibold text-sm text-stone-100 leading-tight">imgman</h1>
            <p className="text-[11px] text-stone-400">Image & Vector Studio</p>
          </div>
        </div>

        <button
          id="btn-new-canvas"
          onClick={onOpenNewCanvas}
          className="p-2 rounded-md text-stone-300 hover:text-white hover:bg-stone-800 transition-colors"
          title="새로 만들기"
          aria-label="새로 만들기"
        >
          <FilePlus2 className="w-5 h-5" />
        </button>

        <button
          id="btn-open-project"
          onClick={() => projectInputRef.current?.click()}
          className="p-2 rounded-md text-stone-300 hover:text-white hover:bg-stone-800 transition-colors"
          title="프로젝트 열기 (.json)"
          aria-label="프로젝트 열기"
        >
          <FolderOpen className="w-5 h-5" />
        </button>

        <button
          id="btn-save-project"
          onClick={onSaveProject}
          className="p-2 rounded-md text-stone-300 hover:text-white hover:bg-stone-800 transition-colors"
          title="저장 (.json)"
          aria-label="저장"
        >
          <Save className="w-5 h-5" />
        </button>

        <button
          id="btn-insert-image"
          onClick={() => imageInputRef.current?.click()}
          className="p-2 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-stone-800 transition-colors"
          title="이미지 삽입 (.png, .jpg 등)"
          aria-label="이미지 삽입"
        >
          <ImageIcon className="w-5 h-5" />
        </button>

        <button
          id="btn-clipboard-paste"
          onClick={onPasteFromClipboard}
          className="p-2 rounded-md text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
          title="클립보드 붙여넣기 (Ctrl+V)"
          aria-label="클립보드 붙여넣기"
        >
          <ClipboardPaste className="w-5 h-5" />
        </button>

        <button
          id="btn-open-export"
          onClick={onOpenExport}
          className="p-2 rounded-md bg-amber-600 hover:bg-amber-500 text-white shadow-sm transition-all hover:shadow"
          title="내보내기 (SVG / PNG / JPG)"
          aria-label="내보내기"
        >
          <Download className="w-5 h-5" />
        </button>
      </div>

      {/* Center: History & View Controls */}
      <div className="flex items-center space-x-1">
        {/* Undo / Redo */}
        <div className="flex items-center space-x-1 px-2 border-r border-stone-800">
          <button
            id="btn-undo"
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 rounded ${
              canUndo
                ? 'text-stone-200 hover:bg-stone-800 hover:text-white'
                : 'text-stone-600 cursor-not-allowed'
            } transition-colors`}
            title="실행 취소 (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            id="btn-redo"
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 rounded ${
              canRedo
                ? 'text-stone-200 hover:bg-stone-800 hover:text-white'
                : 'text-stone-600 cursor-not-allowed'
            } transition-colors`}
            title="다시 실행 (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            id="btn-clear-canvas"
            onClick={onClear}
            className="p-1.5 rounded text-stone-400 hover:text-rose-400 hover:bg-stone-800 transition-colors"
            title="캔버스 비우기"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* View toggles: Grid, Ruler, Snap */}
        <div className="flex items-center space-x-1 px-2 border-r border-stone-800">
          <button
            id="btn-toggle-ruler"
            onClick={() => onUpdateConfig({ showRulers: !config.showRulers })}
            className={`p-1.5 rounded transition-colors ${
              config.showRulers
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
            }`}
            title="눈금자 표시/숨기기"
          >
            <Ruler className="w-4 h-4" />
          </button>
          <button
            id="btn-toggle-grid"
            onClick={() => onUpdateConfig({ showGrid: !config.showGrid })}
            className={`p-1.5 rounded transition-colors ${
              config.showGrid
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
            }`}
            title="그리드 격자 표시/숨기기"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            id="btn-toggle-snap"
            onClick={() => onUpdateConfig({ snapToGrid: !config.snapToGrid })}
            className={`p-1.5 rounded transition-colors ${
              config.snapToGrid
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
            }`}
            title="그리드 스냅 고정"
          >
            <Magnet className="w-4 h-4" />
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center space-x-1.5 px-2">
          <button
            id="btn-zoom-out"
            onClick={() => onZoomChange(clampManualZoom(zoom - 0.1, zoom))}
            className="p-1 rounded text-stone-400 hover:text-white hover:bg-stone-800"
            title="축소"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          
          <button
            id="btn-zoom-reset"
            onClick={onZoom100}
            className="text-xs font-mono text-stone-300 hover:text-white px-1.5 py-0.5 rounded hover:bg-stone-800"
            title="100% 기본 배율"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            id="btn-zoom-in"
            onClick={() => onZoomChange(clampManualZoom(zoom + 0.1, zoom))}
            className="p-1 rounded text-stone-400 hover:text-white hover:bg-stone-800"
            title="확대"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            id="btn-zoom-fit"
            onClick={onZoomFit}
            className="p-1 rounded text-stone-400 hover:text-white hover:bg-stone-800 ml-1"
            title="화면에 맞추기"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            id="btn-fit-canvas"
            onClick={onFitCanvasToContent}
            disabled={!canFitCanvas}
            className={`p-1 rounded ml-1 transition-colors ${
              canFitCanvas
                ? 'text-stone-400 hover:text-white hover:bg-stone-800'
                : 'text-stone-600 cursor-not-allowed'
            }`}
            title={
              canFitCanvas
                ? `캔버스를 콘텐츠 크기에 맞추기${fitPreview ? ` (${fitPreview})` : ''}`
                : '맞춰줄 객체가 없습니다'
            }
            aria-label="캔버스를 콘텐츠 크기에 맞추기"
          >
            <Frame className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Shortcuts — separated, pinned to the right end of the header line */}
      <button
        id="btn-shortcuts"
        onClick={onOpenShortcuts}
        className="ml-auto p-1.5 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors"
        title="단축키 안내"
      >
        <Keyboard className="w-4 h-4" />
      </button>
    </header>
  );
};
