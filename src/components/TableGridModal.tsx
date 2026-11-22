import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns3,
  FolderOpen,
  Grid3x3,
  Image as ImageIcon,
  Rows3,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { CanvasConfig, TableGridSpec } from '../types';
import { ModalDialog } from './ModalDialog';
import { NumberField } from './NumberField';
import type { LoadedGridImage } from '../utils/gridImageLoader';
import {
  DEFAULT_TABLE_GRID,
  TABLE_GRID_GAP_MAX,
  TABLE_GRID_MAX_COLUMNS,
  TABLE_GRID_MAX_ROWS,
  clampTableGridSpec,
  computeTableGridCells,
} from '../utils/tableGrid';
import { isImageFile, readImageFile } from '../utils/gridImageLoader';
import type { ImageAspectFit } from '../types';

/** 모달에서 다루는 이미지 한 장 */
export type GridImageInput = LoadedGridImage;

interface TableGridModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: CanvasConfig;
  /** 현재 적용된 격자 설정 (없으면 null) */
  grid: TableGridSpec | null;
  /** 격자 설정 적용 (캔버스 크기에 맞춰 셀 재생성) */
  onApplyGrid: (spec: TableGridSpec) => void;
  /** 격자 해제 */
  onClearGrid: () => void;
  /** 이미지를 격자 셀에 순서대로 배치 */
  onPlaceImages: (
    images: GridImageInput[],
    fit: ImageAspectFit,
    /** 격자를 함께 확장할 때 사용할 새 설정 (선택) */
    specOverride?: TableGridSpec
  ) => void;
  /** 대상 레이어가 잠겨 있으면 배치 불가 */
  isTargetLayerLocked?: boolean;
}

/** 내부 드래그 시 사용하는 MIME 타입 */
const DRAG_MIME = 'application/x-imgman-grid-image';

export const TableGridModal: React.FC<TableGridModalProps> = ({
  isOpen,
  onClose,
  config,
  grid,
  onApplyGrid,
  onClearGrid,
  onPlaceImages,
  isTargetLayerLocked = false,
}) => {
  const [columnsText, setColumnsText] = useState(String(grid?.columns ?? DEFAULT_TABLE_GRID.columns));
  const [rowsText, setRowsText] = useState(String(grid?.rows ?? DEFAULT_TABLE_GRID.rows));
  const [gapText, setGapText] = useState(String(grid?.gap ?? DEFAULT_TABLE_GRID.gap));
  const [showGuides, setShowGuides] = useState(grid?.showGuides ?? DEFAULT_TABLE_GRID.showGuides);
  const [fitMode, setFitMode] = useState<ImageAspectFit>('cover');
  const [images, setImages] = useState<GridImageInput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragImageId, setDragImageId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** 칸이 부족해서 "칸을 늘릴까요?" 를 묻는 상태 */
  const [overflowPrompt, setOverflowPrompt] = useState<{
    missing: number;
    list: GridImageInput[];
  } | null>(null);
  /** 확장할 행 수 (기본 +1) */
  const [rowAdd, setRowAdd] = useState(1);
  /** 확장할 열 수 (기본 +0) */
  const [colAdd, setColAdd] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달이 열릴 때마다 현재 격자 설정을 불러온다.
  useEffect(() => {
    if (!isOpen) return;
    const spec = clampTableGridSpec(grid ?? DEFAULT_TABLE_GRID);
    setColumnsText(String(spec.columns));
    setRowsText(String(spec.rows));
    setGapText(String(spec.gap));
    setShowGuides(spec.showGuides);
    setMessage(null);
  }, [isOpen, grid]);

  const draftSpec = useMemo(
    () =>
      clampTableGridSpec({
        columns: parseInt(columnsText, 10) || DEFAULT_TABLE_GRID.columns,
        rows: parseInt(rowsText, 10) || DEFAULT_TABLE_GRID.rows,
        gap: parseInt(gapText, 10) || 0,
        showGuides,
      }),
    [columnsText, rowsText, gapText, showGuides]
  );

  const cells = useMemo(
    () => computeTableGridCells(config.width, config.height, draftSpec),
    [config.width, config.height, draftSpec]
  );

  const capacity = cells.length;
  const overflowCount = Math.max(0, images.length - capacity);
  const isDirty =
    !grid ||
    grid.columns !== draftSpec.columns ||
    grid.rows !== draftSpec.rows ||
    grid.gap !== draftSpec.gap ||
    grid.showGuides !== draftSpec.showGuides;

  /** 파일 목록을 읽어 이미지 목록에 추가한다. */
  const addFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) {
      setMessage('이미지 파일만 불러올 수 있습니다.');
      return [];
    }
    setIsLoading(true);
    try {
      const loaded: GridImageInput[] = [];
      for (const file of imageFiles) {
        try {
          loaded.push(await readImageFile(file));
        } catch {
          /* 개별 파일 실패는 건너뛴다 */
        }
      }
      if (loaded.length > 0) {
        setImages((prev) => [...prev, ...loaded]);
      }
      if (loaded.length < imageFiles.length) {
        setMessage(`${loaded.length}장을 불러왔고, 일부 파일은 읽지 못했습니다.`);
      } else {
        setMessage(`${loaded.length}장을 불러왔습니다.`);
      }
      return loaded;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) await addFiles(files);
  };

  /**
   * 목록 순서대로 격자 셀에 배치.
   * 칸이 부족하면 바로 배치하지 않고 "칸을 늘릴까요?" 를 먼저 묻는다.
   */
  const placeImages = useCallback(
    (list: GridImageInput[]) => {
      if (list.length === 0) {
        setMessage('배치할 이미지가 없습니다. 먼저 이미지를 불러오세요.');
        return;
      }
      if (!grid) {
        setMessage('먼저 "격자 적용"으로 격자를 생성하세요.');
        return;
      }
      if (isTargetLayerLocked) {
        setMessage('선택된 레이어가 잠겨 있어 배치할 수 없습니다.');
        return;
      }
      if (list.length > capacity) {
        // 부족한 칸 수를 알리고 행/열 확장을 선택받는다.
        setOverflowPrompt({ missing: list.length - capacity, list });
        setMessage(null);
        return;
      }
      setOverflowPrompt(null);
      onPlaceImages(list, fitMode);
      setMessage(`${list.length}개를 격자에 배치했습니다.`);
    },
    [capacity, fitMode, grid, isTargetLayerLocked, onPlaceImages]
  );

  /** 칸을 늘린 뒤 배치 — 확장은 현재 입력된 격자 설정을 기준으로 계산한다 */
  const handleExpandAndPlace = useCallback(() => {
    if (!overflowPrompt) return;
    const expanded: TableGridSpec = {
      ...draftSpec,
      rows: draftSpec.rows + rowAdd,
      columns: draftSpec.columns + colAdd,
    };
    setColumnsText(String(expanded.columns));
    setRowsText(String(expanded.rows));
    onPlaceImages(overflowPrompt.list, fitMode, expanded);
    setOverflowPrompt(null);
    setMessage(
      `격자를 ${expanded.columns}열 × ${expanded.rows}행으로 늘려 ${overflowPrompt.list.length}개를 배치했습니다.`
    );
  }, [draftSpec, fitMode, onPlaceImages, overflowPrompt, rowAdd, colAdd]);

  /** 늘리지 않고 배치 — 들어갈 수 있는 만큼만 넣는다 */
  const handlePlaceWithoutExpanding = useCallback(() => {
    if (!overflowPrompt) return;
    const list = overflowPrompt.list;
    setOverflowPrompt(null);
    onPlaceImages(list, fitMode);
    setMessage(
      `이미지 ${capacity}개를 배치했습니다. 칸(${capacity}개)을 초과한 ${list.length - capacity}장은 배치되지 않았습니다.`
    );
  }, [capacity, fitMode, onPlaceImages, overflowPrompt]);

  // 썸네일 목록 → 드롭존: 목록 순서대로 배치
  const handleDropZoneDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []).filter(isImageFile);
    if (files.length > 0) {
      const loaded = await addFiles(files);
      if (loaded.length > 0) placeImages(loaded);
      return;
    }
    const id = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
    if (id) {
      placeImages(images);
    }
  };

  // 썸네일 위 드롭 → 순서 재배치
  const handleThumbnailDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    const id = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
    if (!id || id === targetId) return;
    setImages((prev) => {
      const from = prev.findIndex((img) => img.id === id);
      const to = prev.findIndex((img) => img.id === targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const moveImage = (id: string, direction: -1 | 1) => {
    setImages((prev) => {
      const index = prev.findIndex((img) => img.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  if (!isOpen) return null;

  const canvasRatio = config.width / Math.max(1, config.height);

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="table-grid-dialog-title"
      closeOnBackdrop
      initialFocusRef={fileInputRef}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      panelClassName="bg-stone-900 border border-stone-700 rounded-xl shadow-2xl max-w-3xl w-full max-md:max-w-[calc(100vw-16px)] max-md:max-h-[calc(100dvh-16px)] max-md:overflow-y-auto p-5 text-stone-200 select-none"
    >
      <div className="flex items-center justify-between pb-3 border-b border-stone-800">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
            <Table2 className="w-5 h-5" />
          </div>
          <div>
            <h2 id="table-grid-dialog-title" className="text-base font-semibold text-stone-100">
              격자(테이블) 이미지 배치
            </h2>
            <p className="text-xs text-stone-400">
              캔버스 {config.width}×{config.height}px 를 칸으로 나눠 이미지를 순서대로 채웁니다
            </p>
          </div>
        </div>
        <button
          id="btn-close-table-grid"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-white"
          aria-label="닫기"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 왼쪽: 격자 설정 */}
        <div className="space-y-3">
          <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-stone-300 font-medium text-xs">
              <Grid3x3 className="w-3.5 h-3.5 text-amber-400" />
              <span>격자 설정</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-stone-400 flex items-center gap-1 mb-1">
                  <Columns3 className="w-3 h-3" /> 가로 칸 수 (열)
                </span>
                <input
                  id="input-grid-columns"
                  type="number"
                  min={1}
                  max={TABLE_GRID_MAX_COLUMNS}
                  value={columnsText}
                  onChange={(e) => setColumnsText(e.target.value)}
                  onBlur={() => setColumnsText(String(draftSpec.columns))}
                  className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 font-mono text-xs"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-stone-400 flex items-center gap-1 mb-1">
                  <Rows3 className="w-3 h-3" /> 세로 칸 수 (행)
                </span>
                <input
                  id="input-grid-rows"
                  type="number"
                  min={1}
                  max={TABLE_GRID_MAX_ROWS}
                  value={rowsText}
                  onChange={(e) => setRowsText(e.target.value)}
                  onBlur={() => setRowsText(String(draftSpec.rows))}
                  className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 font-mono text-xs"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] text-stone-400 block mb-1">
                칸 사이 여백 (Gap, 0–{TABLE_GRID_GAP_MAX}px)
              </span>
              <input
                id="input-grid-gap"
                type="number"
                min={0}
                max={TABLE_GRID_GAP_MAX}
                value={gapText}
                onChange={(e) => setGapText(e.target.value)}
                onBlur={() => setGapText(String(draftSpec.gap))}
                className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 font-mono text-xs"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-stone-300 cursor-pointer">
              <input
                id="input-grid-show-guides"
                type="checkbox"
                checked={showGuides}
                onChange={(e) => setShowGuides(e.target.checked)}
                className="accent-amber-500"
              />
              <span>캔버스에 칸 경계 가이드선 표시</span>
            </label>

            <div>
              <span className="text-[11px] text-stone-400 block mb-1">이미지 맞춤</span>
              <div className="flex gap-1">
                {(
                  [
                    { value: 'cover', label: '꽉 채우기' },
                    { value: 'contain', label: '전체 보기' },
                  ] as { value: ImageAspectFit; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    id={`btn-grid-fit-${opt.value}`}
                    onClick={() => setFitMode(opt.value)}
                    className={`flex-1 py-1 rounded border text-[11px] ${
                      fitMode === opt.value
                        ? 'border-amber-500 text-amber-300 bg-amber-500/10'
                        : 'border-stone-800 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-stone-500 mt-1">
                꽉 채우기 = 비율 유지 후 중앙 기준 잘림 / 전체 보기 = 비율 유지 후 여백
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-stone-800">
              <button
                id="btn-apply-grid"
                type="button"
                onClick={() => onApplyGrid(draftSpec)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  isDirty
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-400'
                }`}
                title="캔버스 크기에 맞춰 격자를 다시 계산해 적용합니다"
              >
                {grid ? '격자 적용(갱신)' : '격자 적용(생성)'}
              </button>
              <button
                id="btn-clear-grid"
                type="button"
                onClick={onClearGrid}
                disabled={!grid}
                className="px-3 py-1.5 rounded-lg text-xs text-stone-400 hover:text-white hover:bg-stone-800 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                격자 해제
              </button>
              <span className="text-[10px] text-stone-500 ml-auto">
                칸 {capacity}개 · {draftSpec.columns}열 × {draftSpec.rows}행
              </span>
            </div>
            <p className="text-[10px] text-stone-500 leading-snug">
              격자는 캔버스 크기에 맞춰 계산되므로 캔버스 크기를 바꾸면 자동으로 다시 맞춰집니다.
            </p>
          </div>

          {/* 이미지 불러오기 */}
          <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-stone-300 font-medium text-xs flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                불러온 이미지 ({images.length})
              </span>
              <button
                id="btn-load-images"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 text-[11px] font-medium disabled:opacity-50"
              >
                <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                {isLoading ? '읽는 중...' : '이미지 불러오기(다중)'}
              </button>
            </div>

            <input
              ref={fileInputRef}
              id="input-grid-images"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />

            {images.length === 0 ? (
              <p className="text-[11px] text-stone-500 py-3 text-center border border-dashed border-stone-800 rounded">
                아직 불러온 이미지가 없습니다.
                <br />
                파일 탐색기에서 여러 장을 한 번에 선택하세요.
              </p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {images.map((img, index) => (
                  <li
                    key={img.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, img.id);
                      e.dataTransfer.setData('text/plain', img.id);
                      e.dataTransfer.effectAllowed = 'copyMove';
                      setDragImageId(img.id);
                    }}
                    onDragEnd={() => {
                      setDragImageId(null);
                      setDropTargetId(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropTargetId(img.id);
                    }}
                    onDragLeave={() => setDropTargetId((prev) => (prev === img.id ? null : prev))}
                    onDrop={(e) => handleThumbnailDrop(e, img.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-grab active:cursor-grabbing ${
                      dropTargetId === img.id
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-stone-800 bg-stone-900/60'
                    } ${dragImageId === img.id ? 'opacity-50' : ''}`}
                    title="드래그해서 순서를 바꾸거나, 오른쪽 드롭존으로 옮겨 배치하세요"
                  >
                    <span className="w-5 h-5 shrink-0 rounded bg-stone-800 text-stone-400 font-mono text-[10px] flex items-center justify-center">
                      {index + 1}
                    </span>
                    <img
                      src={img.src}
                      alt=""
                      className="w-8 h-8 object-cover rounded bg-stone-800 shrink-0"
                    />
                    <span className="flex-1 min-w-0 truncate text-[11px] text-stone-300">
                      {img.name}
                    </span>
                    <span className="text-[10px] text-stone-500 font-mono shrink-0">
                      {img.naturalWidth}×{img.naturalHeight}
                    </span>
                    <button
                      type="button"
                      onClick={() => moveImage(img.id, -1)}
                      disabled={index === 0}
                      className="px-1 text-stone-500 hover:text-stone-200 disabled:opacity-30"
                      aria-label="앞으로 이동"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(img.id, 1)}
                      disabled={index === images.length - 1}
                      className="px-1 text-stone-500 hover:text-stone-200 disabled:opacity-30"
                      aria-label="뒤로 이동"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="px-1 text-stone-600 hover:text-rose-400"
                      aria-label="이미지 제거"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 오른쪽: 드롭존 + 미리보기 */}
        <div className="space-y-3">
          <div
            id="grid-drop-zone"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDropZoneDrop}
            className={`rounded-lg border-2 border-dashed p-3 transition-colors ${
              isDragOver
                ? 'border-emerald-500 bg-emerald-500/10'
                : 'border-stone-700 bg-stone-950/40 hover:border-stone-600'
            }`}
          >
            <div className="text-center text-[11px] text-stone-400 mb-2">
              이미지를 여기로 끌어놓으면 <span className="text-stone-200">목록 순서대로</span> 칸에
              배치됩니다 (좌상단 → 우하단)
            </div>

            {/* 격자 미리보기 */}
            <div
              className="relative w-full mx-auto bg-stone-900 border border-stone-700 rounded overflow-hidden"
              style={{ aspectRatio: String(canvasRatio) }}
            >
              {cells.map((cell) => {
                const image = images[cell.index];
                return (
                  <div
                    key={cell.index}
                    className="absolute border border-amber-500/50 overflow-hidden"
                    style={{
                      left: `${(cell.x / config.width) * 100}%`,
                      top: `${(cell.y / config.height) * 100}%`,
                      width: `${(cell.width / config.width) * 100}%`,
                      height: `${(cell.height / config.height) * 100}%`,
                    }}
                    title={`${cell.row + 1}행 ${cell.column + 1}열`}
                  >
                    {image ? (
                      <img
                        src={image.src}
                        alt=""
                        className="w-full h-full object-cover"
                        style={
                          fitMode === 'contain' ? { objectFit: 'contain' } : { objectFit: 'cover' }
                        }
                      />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-[9px] text-stone-600">
                        {cell.row + 1}·{cell.column + 1}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {overflowPrompt && (
            <div
              id="grid-overflow-prompt"
              className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-3 space-y-2"
            >
              <p className="text-xs font-semibold text-amber-100">
                {overflowPrompt.missing}칸이 부족합니다. 칸을 늘릴까요?
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1 text-[11px] text-amber-100/90">
                  행 +
                  <NumberField
                    id="input-grid-add-rows"
                    value={rowAdd}
                    min={0}
                    max={TABLE_GRID_MAX_ROWS}
                    step={1}
                    onChange={(v) => setRowAdd(Math.max(0, v))}
                    className="w-14 bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-100 font-mono text-[11px] focus:border-amber-500 outline-none"
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-amber-100/90">
                  열 +
                  <NumberField
                    id="input-grid-add-columns"
                    value={colAdd}
                    min={0}
                    max={TABLE_GRID_MAX_COLUMNS}
                    step={1}
                    onChange={(v) => setColAdd(Math.max(0, v))}
                    className="w-14 bg-stone-800 border border-stone-700 rounded px-1.5 py-0.5 text-stone-100 font-mono text-[11px] focus:border-amber-500 outline-none"
                  />
                </label>
                <span className="text-[10px] text-amber-200/80">
                  → {draftSpec.columns + colAdd}열 × {draftSpec.rows + rowAdd}행 (
                  {(draftSpec.columns + colAdd) * (draftSpec.rows + rowAdd)}칸)
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  id="btn-expand-grid-and-place"
                  type="button"
                  onClick={handleExpandAndPlace}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                >
                  칸 늘리고 배치
                </button>
                <button
                  id="btn-place-without-expanding"
                  type="button"
                  onClick={handlePlaceWithoutExpanding}
                  className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs"
                >
                  늘리지 않고 배치 (앞 {capacity}장만)
                </button>
                <button
                  id="btn-cancel-overflow-prompt"
                  type="button"
                  onClick={() => {
                    setOverflowPrompt(null);
                    setMessage('배치를 취소했습니다.');
                  }}
                  className="px-3 py-1.5 rounded-lg text-stone-400 hover:text-white text-xs"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {overflowCount > 0 && !overflowPrompt && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              이미지가 칸 수({capacity}개)보다 {overflowCount}장 많습니다. 배치 시 앞 {capacity}장만
              들어가고 나머지는 배치되지 않습니다 — 가로/세로 칸 수를 늘리세요.
            </div>
          )}

          {isTargetLayerLocked && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              현재 선택된 레이어가 잠겨 있어 이미지를 배치할 수 없습니다.
            </div>
          )}

          {message && (
            <div className="rounded-lg border border-stone-700 bg-stone-950/60 px-3 py-2 text-[11px] text-stone-300">
              {message}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              id="btn-place-grid-images"
              type="button"
              onClick={() => placeImages(images)}
              disabled={images.length === 0 || !grid || isTargetLayerLocked}
              className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white text-xs font-semibold"
            >
              캔버스에 배치 ({Math.min(images.length, capacity)}/{images.length})
            </button>
            <button
              type="button"
              onClick={() => setImages([])}
              disabled={images.length === 0}
              className="px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs disabled:opacity-40"
            >
              목록 비우기
            </button>
          </div>
          <p className="text-[10px] text-stone-500 leading-snug">
            배치된 이미지는 일반 레이어 객체로 추가됩니다 — 레이어 패널에서 선택/이동/삭제할 수 있고
            실행 취소(Undo)로 되돌릴 수 있습니다.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-800">
        <button
          onClick={onClose}
          className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-stone-400 hover:text-white"
        >
          닫기
        </button>
      </div>
    </ModalDialog>
  );
};
