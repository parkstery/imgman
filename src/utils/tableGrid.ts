/**
 * 표(테이블) 격자 계산 유틸.
 *
 * 격자는 캔버스 크기(가로 × 세로 px)를 지정된 열/행 수로 균등 분할한다.
 * 셀 좌표는 항상 캔버스 크기에서 파생되므로 캔버스를 resize 하면
 * 별도 재생성 없이 자동으로 다시 맞춰진다.
 */

import type { TableGridSpec } from '../types';

/** 가로/세로 각각 허용되는 최대 칸 수 */
export const TABLE_GRID_MAX_COLUMNS = 50;
export const TABLE_GRID_MAX_ROWS = 50;
/** 가로 × 세로 합산 최대 칸 수 (성능 보호) */
export const TABLE_GRID_MAX_TOTAL_CELLS = 400;
/** 칸 사이 여백 최대값 (px) */
export const TABLE_GRID_GAP_MAX = 200;

export const DEFAULT_TABLE_GRID: TableGridSpec = {
  columns: 2,
  rows: 2,
  gap: 0,
  showGuides: true,
};

export interface TableGridCell {
  /** 행 우선 순서 인덱스 (0 = 좌상단) */
  index: number;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 셀 좌표는 반올림하지 않는다 — 반올림하면 인접 셀이 미세하게 겹칠 수 있다. */
function precise(value: number): number {
  return value;
}

export function clampTableGridColumns(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TABLE_GRID.columns;
  return Math.min(TABLE_GRID_MAX_COLUMNS, Math.max(1, Math.round(value)));
}

export function clampTableGridRows(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TABLE_GRID.rows;
  return Math.min(TABLE_GRID_MAX_ROWS, Math.max(1, Math.round(value)));
}

export function clampTableGridGap(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TABLE_GRID.gap;
  return Math.min(TABLE_GRID_GAP_MAX, Math.max(0, Math.round(value)));
}

/** 격자 설정을 안전한 범위로 정규화한다. */
export function clampTableGridSpec(spec: Partial<TableGridSpec> | null | undefined): TableGridSpec {
  const base = spec ?? DEFAULT_TABLE_GRID;
  let columns = clampTableGridColumns(base.columns ?? DEFAULT_TABLE_GRID.columns);
  let rows = clampTableGridRows(base.rows ?? DEFAULT_TABLE_GRID.rows);

  // 칸 수가 너무 많으면 축소 (한 칸에 최소 1px는 남긴다)
  while (columns * rows > TABLE_GRID_MAX_TOTAL_CELLS && rows > 1) {
    rows = Math.floor(rows / 2);
  }
  while (columns * rows > TABLE_GRID_MAX_TOTAL_CELLS && columns > 1) {
    columns = Math.floor(columns / 2);
  }

  return {
    columns,
    rows,
    gap: clampTableGridGap(base.gap ?? DEFAULT_TABLE_GRID.gap),
    showGuides: base.showGuides ?? DEFAULT_TABLE_GRID.showGuides,
  };
}

/** 전체 칸 수 (행 우선) */
export function countTableGridCells(spec: TableGridSpec | null | undefined): number {
  if (!spec) return 0;
  const { columns, rows } = clampTableGridSpec(spec);
  return columns * rows;
}

/**
 * 여백이 너무 커서 셀이 사라지는 것을 막기 위해 실제로 적용할 여백을 줄인다.
 * 각 칸에 최소 1px는 남긴다.
 */
function fitGap(total: number, count: number, gap: number): number {
  if (count <= 1) return 0;
  const maxGap = Math.max(0, (total - count) / (count - 1));
  return Math.min(gap, maxGap);
}

/**
 * 캔버스를 균등 분할한 셀 목록을 반환한다 (행 우선: 좌상단 → 우하단).
 * 셀은 캔버스 경계까지 빈틈없이 채운다.
 */
export function computeTableGridCells(
  canvasWidth: number,
  canvasHeight: number,
  spec: TableGridSpec | null | undefined
): TableGridCell[] {
  if (!spec) return [];
  const { columns, rows, gap } = clampTableGridSpec(spec);
  const width = Number.isFinite(canvasWidth) ? Math.max(1, canvasWidth) : 1;
  const height = Number.isFinite(canvasHeight) ? Math.max(1, canvasHeight) : 1;

  const gapX = fitGap(width, columns, gap);
  const gapY = fitGap(height, rows, gap);
  const cellWidth = (width - gapX * (columns - 1)) / columns;
  const cellHeight = (height - gapY * (rows - 1)) / rows;

  const cells: TableGridCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      cells.push({
        index,
        row,
        column,
        // 인접 셀이 겹치거나 틈이 생기지 않도록 이전 셀 끝에 정확히 이어 붙인다.
        x: precise(column * (cellWidth + gapX)),
        y: precise(row * (cellHeight + gapY)),
        width: precise(cellWidth),
        height: precise(cellHeight),
      });
    }
  }
  return cells;
}
