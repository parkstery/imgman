import React, { useRef, useState } from 'react';
import {
  Layer,
  CanvasElement,
} from '../types';
import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Layers,
  Square,
  Type,
  Image as ImageIcon,
  Paintbrush,
  Edit2,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  History,
} from 'lucide-react';

interface LayersPanelProps {
  layers: Layer[];
  activeLayerId: string;
  onSelectLayer: (layerId: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (layerId: string) => void;
  onDuplicateLayer: (layerId: string) => void;
  onMoveLayerUp: (layerId: string) => void;
  onMoveLayerDown: (layerId: string) => void;
  onMoveElementForward?: (elementId: string) => void;
  onMoveElementBackward?: (elementId: string) => void;
  onUpdateLayer: (updated: Layer) => void;
  elements: CanvasElement[];
  selectedElementId: string | null;
  selectedElementIds: string[];
  onSelectElement: (id: string | null) => void;
  onSelectMultipleElements: (ids: string[]) => void;
  isOpen?: boolean;
  onToggleCollapse?: () => void;
  /** Rendered in the "History" tab */
  historyPanel?: React.ReactNode;
  historyCount?: number;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({
  layers,
  activeLayerId,
  onSelectLayer,
  onAddLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onMoveLayerUp,
  onMoveLayerDown,
  onMoveElementForward,
  onMoveElementBackward,
  onUpdateLayer,
  elements,
  selectedElementId,
  selectedElementIds,
  onSelectElement,
  onSelectMultipleElements,
  isOpen = true,
  onToggleCollapse,
  historyPanel,
  historyCount,
}) => {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [tab, setTab] = useState<'layers' | 'history'>('layers');
  const [editingName, setEditingName] = useState('');
  const selectionAnchor = useRef<string | null>(null);

  const selectObject = (id: string, orderedIds: string[], toggle: boolean, range: boolean) => {
    const anchorIndex = orderedIds.indexOf(selectionAnchor.current ?? selectedElementId ?? '');
    const targetIndex = orderedIds.indexOf(id);
    if (range && anchorIndex >= 0 && targetIndex >= 0) {
      const rangeIds = orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1);
      const next = toggle ? [...new Set([...selectedElementIds, ...rangeIds])] : rangeIds;
      // The clicked object remains the primary selection in the properties panel.
      onSelectMultipleElements([...next.filter((item) => item !== id), id]);
    } else if (toggle) {
      onSelectMultipleElements(selectedElementIds.includes(id)
        ? selectedElementIds.filter((item) => item !== id)
        : [...selectedElementIds, id]);
      selectionAnchor.current = id;
    } else {
      onSelectElement(id);
      selectionAnchor.current = id;
    }
  };

  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0];
  // layers[]: index 0 = backmost, last = frontmost. Panel lists reverse (top = front).
  const activeLayerIndex = layers.findIndex((l) => l.id === activeLayerId);
  const canMoveLayerUp =
    activeLayerIndex >= 0 && activeLayerIndex < layers.length - 1;
  const canMoveLayerDown = activeLayerIndex > 0;

  // Selected object's z-order within its layer (array index 0 = back, last = front)
  const selectedElement = selectedElementId
    ? elements.find((el) => el.id === selectedElementId) || null
    : null;
  const siblingElements = selectedElement
    ? elements.filter((el) => el.layerId === selectedElement.layerId)
    : [];
  const selectedSiblingIndex = selectedElement
    ? siblingElements.findIndex((el) => el.id === selectedElement.id)
    : -1;
  const canMoveElementUp =
    !!selectedElement &&
    !!onMoveElementForward &&
    selectedSiblingIndex >= 0 &&
    selectedSiblingIndex < siblingElements.length - 1;
  const canMoveElementDown =
    !!selectedElement &&
    !!onMoveElementBackward &&
    selectedSiblingIndex > 0;

  const handleStartRename = (layer: Layer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  };

  const handleSaveRename = (layer: Layer) => {
    if (editingName.trim()) {
      onUpdateLayer({ ...layer, name: editingName.trim() });
    }
    setEditingLayerId(null);
  };

  const getElementIcon = (type: CanvasElement['type']) => {
    switch (type) {
      case 'shape':
        return <Square className="w-3 h-3 text-amber-400" />;
      case 'text':
        return <Type className="w-3 h-3 text-blue-400" />;
      case 'image':
        return <ImageIcon className="w-3 h-3 text-emerald-400" />;
      case 'brush':
        return <Paintbrush className="w-3 h-3 text-rose-400" />;
    }
  };

  // Collapsed Rail View
  if (!isOpen) {
    return (
      <aside
        onClick={onToggleCollapse}
        className="w-10 bg-stone-900 border-r border-stone-800 text-stone-200 hidden md:flex flex-col items-center py-3 select-none text-xs shrink-0 cursor-pointer hover:bg-stone-850 transition-colors group"
        title="레이어 패널 펼치기 (단축키: [)"
      >
        <button
          id="btn-expand-layers"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
          className="p-1.5 rounded hover:bg-orange-500/20 text-orange-400 hover:text-orange-300 transition-colors"
          title="레이어 패널 펼치기 (단축키: [)"
        >
          <PanelLeftOpen className="w-4 h-4 text-orange-400 group-hover:scale-110 transition-transform" />
        </button>

        <Layers className="w-4 h-4 text-amber-400 mt-3" />
        <span className="mt-1 text-[10px] font-semibold bg-stone-800 text-stone-300 rounded px-1.5 py-0.5">
          {layers.length}
        </span>

        <span className="text-[11px] text-stone-400 group-hover:text-stone-200 font-medium tracking-wider mt-4 [writing-mode:vertical-lr]">
          Layer
        </span>
      </aside>
    );
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] h-full min-h-0 bg-stone-900 border-r border-stone-800 text-stone-200 flex flex-col shrink-0 select-none text-xs shadow-2xl pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:w-64 md:max-w-none md:shadow-none md:pb-0">
      {/* Title row — always a single horizontal line */}
      <div className="px-3 pt-3 pb-1.5 border-b border-stone-800/80 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 min-w-0 font-semibold whitespace-nowrap" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'layers'}
            onClick={() => setTab('layers')}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${
              tab === 'layers' ? 'text-stone-100' : 'text-stone-500 hover:text-stone-300'
            }`}
          >
            <Layers className={`w-4 h-4 shrink-0 ${tab === 'layers' ? 'text-amber-400' : ''}`} />
            <span className="text-sm tracking-wide">Layer</span>
            <span className="text-[10px] text-stone-400 font-normal">({layers.length})</span>
          </button>
          {historyPanel && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              onClick={() => setTab('history')}
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${
                tab === 'history' ? 'text-stone-100' : 'text-stone-500 hover:text-stone-300'
              }`}
              title="작업 내역 — 클릭해서 원하는 단계로 돌아가기"
            >
              <History className={`w-4 h-4 shrink-0 ${tab === 'history' ? 'text-amber-400' : ''}`} />
              <span className="text-sm tracking-wide">History</span>
              {historyCount != null && (
                <span className="text-[10px] text-stone-400 font-normal">({historyCount})</span>
              )}
            </button>
          )}
        </div>
        {onToggleCollapse && (
          <button
            id="btn-collapse-layers"
            onClick={onToggleCollapse}
            className="p-1.5 rounded hover:bg-orange-500/20 text-orange-400 hover:text-orange-300 transition-colors shrink-0"
            title="레이어 패널 접기 (단축키: [)"
          >
            <PanelLeftClose className="w-3.5 h-3.5 text-orange-400" />
          </button>
        )}
      </div>

      {tab === 'history' && historyPanel ? (
        historyPanel
      ) : (
      <>
      {/* Action controls on their own row so the title never wraps vertically */}
      <div className="px-2 py-1.5 border-b border-stone-800 flex items-center justify-end flex-wrap gap-0.5 shrink-0">
          {/* Single reorder pair for the active (selected) layer */}
          <button
            id="btn-move-layer-up"
            type="button"
            onClick={() => onMoveLayerUp(activeLayerId)}
            disabled={!canMoveLayerUp}
            className={`p-1.5 rounded transition-colors ${
              canMoveLayerUp
                ? 'hover:bg-stone-800 text-stone-300 hover:text-white'
                : 'text-stone-700 cursor-not-allowed'
            }`}
            title="선택한 레이어를 위로 (앞으로)"
            aria-label="선택한 레이어를 위로 이동"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            id="btn-move-layer-down"
            type="button"
            onClick={() => onMoveLayerDown(activeLayerId)}
            disabled={!canMoveLayerDown}
            className={`p-1.5 rounded transition-colors ${
              canMoveLayerDown
                ? 'hover:bg-stone-800 text-stone-300 hover:text-white'
                : 'text-stone-700 cursor-not-allowed'
            }`}
            title="선택한 레이어를 아래로 (뒤로)"
            aria-label="선택한 레이어를 아래로 이동"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-4 bg-stone-700 mx-0.5" aria-hidden title="레이어 / 개체" />
          {/* Single reorder pair for the selected object within its layer */}
          <button
            id="btn-move-element-up"
            type="button"
            onClick={() => {
              if (selectedElementId) onMoveElementForward?.(selectedElementId);
            }}
            disabled={!canMoveElementUp}
            className={`p-1.5 rounded transition-colors ${
              canMoveElementUp
                ? 'hover:bg-stone-800 text-amber-400 hover:text-amber-300'
                : 'text-stone-700 cursor-not-allowed'
            }`}
            title="선택한 개체를 위로 (앞으로)"
            aria-label="선택한 개체를 위로 이동"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            id="btn-move-element-down"
            type="button"
            onClick={() => {
              if (selectedElementId) onMoveElementBackward?.(selectedElementId);
            }}
            disabled={!canMoveElementDown}
            className={`p-1.5 rounded transition-colors ${
              canMoveElementDown
                ? 'hover:bg-stone-800 text-amber-400 hover:text-amber-300'
                : 'text-stone-700 cursor-not-allowed'
            }`}
            title="선택한 개체를 아래로 (뒤로)"
            aria-label="선택한 개체를 아래로 이동"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-4 bg-stone-700 mx-0.5" aria-hidden />
          <button
            id="btn-add-layer"
            onClick={onAddLayer}
            className="p-1.5 rounded hover:bg-stone-800 text-stone-300 hover:text-white transition-colors"
            title="새 레이어 추가"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
          </button>
          <button
            id="btn-duplicate-layer"
            onClick={() => onDuplicateLayer(activeLayerId)}
            className="p-1.5 rounded hover:bg-stone-800 text-stone-400 hover:text-white transition-colors"
            title="현재 레이어 복제"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            id="btn-delete-layer"
            disabled={
              layers.length <= 1 ||
              !!activeLayer?.locked ||
              elements.some((el) => el.layerId === activeLayerId && el.locked)
            }
            onClick={() => onDeleteLayer(activeLayerId)}
            className={`p-1.5 rounded transition-colors ${
              layers.length > 1 &&
              !activeLayer?.locked &&
              !elements.some((el) => el.layerId === activeLayerId && el.locked)
                ? 'hover:bg-stone-800 text-stone-400 hover:text-rose-400'
                : 'text-stone-700 cursor-not-allowed'
            }`}
            title={
              activeLayer?.locked
                ? '잠긴 레이어는 삭제할 수 없습니다'
                : elements.some((el) => el.layerId === activeLayerId && el.locked)
                  ? '잠긴 객체가 있는 레이어는 삭제할 수 없습니다'
                  : '현재 레이어 삭제'
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
      </div>

      <div className="px-3 py-2 border-b border-stone-800 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              aria-label="전체 객체 선택"
              checked={elements.length > 0 && elements.every((el) => selectedElementIds.includes(el.id))}
              ref={(node) => {
                if (node) node.indeterminate = selectedElementIds.length > 0 && !elements.every((el) => selectedElementIds.includes(el.id));
              }}
              disabled={elements.length === 0}
              onChange={(e) => {
                selectionAnchor.current = null;
                onSelectMultipleElements(e.target.checked ? elements.map((el) => el.id) : []);
              }}
              className="accent-amber-500"
              title="모든 레이어의 객체를 한 번에 선택 / 해제"
            />
            전체 선택
          </label>
          <span className="text-[10px] text-amber-400" aria-live="polite">{selectedElementIds.length}개 선택</span>
          <button
            type="button"
            onClick={() => { selectionAnchor.current = null; onSelectMultipleElements([]); }}
            disabled={selectedElementIds.length === 0}
            className="text-[10px] text-stone-400 hover:text-white disabled:opacity-40"
          >선택 해제</button>
        </div>
        <p className="text-[10px] text-stone-500">체크박스·Ctrl/⌘: 다중 선택 · Shift: 범위 선택</p>
      </div>

      {/* Layer Stack (Rendered in reverse order: top layer on top) */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {[...layers].reverse().map((layer) => {
          const isActive = layer.id === activeLayerId;
          const layerElements = elements.filter((el) => el.layerId === layer.id);

          return (
            <div
              key={layer.id}
              className={`group rounded-md border transition-all ${
                isActive
                  ? 'border-amber-500/50 bg-stone-800/80 shadow-sm'
                  : 'border-transparent hover:bg-stone-800/40 text-stone-400 hover:text-stone-200'
              }`}
            >
              {/* Layer Header Row */}
              <div
                onClick={() => onSelectLayer(layer.id)}
                className="p-2 flex items-center justify-between cursor-pointer space-x-1"
              >
                {/* Visibility Toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateLayer({ ...layer, visible: !layer.visible });
                  }}
                  className={`p-1 rounded hover:bg-stone-700/50 ${
                    layer.visible ? 'text-stone-300' : 'text-stone-600'
                  }`}
                  title={layer.visible ? '레이어 숨기기' : '레이어 표시'}
                >
                  {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>

                {/* Lock Toggle — closed padlock when locked, open padlock when unlocked */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateLayer({ ...layer, locked: !layer.locked });
                  }}
                  className={`p-1 rounded hover:bg-stone-700/50 ${
                    layer.locked ? 'text-amber-400' : 'text-stone-600 hover:text-stone-400'
                  }`}
                  title={layer.locked ? '레이어 잠금 해제' : '레이어 잠금'}
                  aria-label={layer.locked ? '레이어 잠금 해제' : '레이어 잠금'}
                >
                  {layer.locked ? (
                    <Lock className="w-3.5 h-3.5" strokeWidth={2} />
                  ) : (
                    <LockOpen className="w-3.5 h-3.5" strokeWidth={2} />
                  )}
                </button>

                {/* Layer Name or Edit Input */}
                <div className="flex-1 px-1 min-w-0">
                  {editingLayerId === layer.id ? (
                    <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(layer);
                          if (e.key === 'Escape') setEditingLayerId(null);
                        }}
                        autoFocus
                        className="w-full bg-stone-900 border border-amber-500 rounded px-1.5 py-0.5 text-xs text-white"
                      />
                      <button
                        onClick={() => handleSaveRename(layer)}
                        className="p-1 text-emerald-400 hover:bg-stone-700 rounded"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleStartRename(layer);
                      }}
                      className="flex items-center space-x-1 truncate"
                    >
                      <span className={`truncate text-xs font-medium ${isActive ? 'text-white' : 'text-stone-300'}`}>
                        {layer.name}
                      </span>
                      <span className="text-[10px] text-stone-500">({layerElements.length})</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartRename(layer);
                  }}
                  className="p-0.5 rounded hover:bg-stone-700/60 hover:text-amber-400 shrink-0 text-stone-500"
                  title="이름 바꾸기"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>

              {/* Elements within active layer (front-most first); reorder via header ↑↓ */}
              {isActive && layerElements.length > 0 && (
                <div className="px-2 pb-2 pt-0.5 space-y-0.5">
                  {[...layerElements].reverse().map((el) => {
                    const isSelected = selectedElementIds.includes(el.id);
                    return (
                      <div
                        key={el.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectObject(el.id, [...layerElements].reverse().map((item) => item.id), e.ctrlKey || e.metaKey, e.shiftKey);
                        }}
                        className={`flex items-center space-x-1.5 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-amber-500/20 text-amber-300 font-medium'
                            : 'hover:bg-stone-700/50 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          aria-label={`${el.name || el.type} 선택`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => selectObject(el.id, [], true, false)}
                          className="accent-amber-500 shrink-0"
                        />
                        {getElementIcon(el.type)}
                        <span className="truncate flex-1 min-w-0">
                          {el.name || (el.type === 'shape' ? (el as any).shapeType : el.type)}
                        </span>
                        {(el.locked || layer.locked) && (
                          <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Layer Opacity Controller */}
      {activeLayer && (
        <div className="p-3 border-t border-stone-800 space-y-1.5 bg-stone-900/90">
          <div className="flex items-center justify-between text-[11px] text-stone-400">
            <span>선택 레이어 불투명도</span>
            <span className="font-mono text-stone-200">{Math.round(activeLayer.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(activeLayer.opacity * 100)}
            onChange={(e) =>
              onUpdateLayer({ ...activeLayer, opacity: parseInt(e.target.value) / 100 })
            }
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>
      )}
      </>
      )}
    </aside>
  );
};
