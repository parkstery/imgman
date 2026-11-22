export type ShapeType =
  | 'rect'
  | 'rounded-rect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'arrow-right'
  | 'arrow-bidirectional'
  | 'speech-bubble'
  | 'heart'
  | 'hexagon'
  | 'line'
  | 'line-arrow'
  | 'line-arrow-both'
  | 'line-arrow-start'
  | 'line-arrow-open'
  | 'line-arrow-dot'
  | 'line-arrow-diamond'
  | 'polyline'
  | 'arc'
  | 'path';

export type ElementType = 'shape' | 'brush' | 'text' | 'image';

export interface ShadowSettings {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface BaseElement {
  id: string;
  layerId: string;
  name: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0 to 1
  locked?: boolean;
  visible?: boolean;
  shadow?: ShadowSettings;
  /** Mirror the element about its own center (any element type) */
  flipH?: boolean;
  flipV?: boolean;
  /** Group ID for grouped elements. Elements with the same groupId are treated as a single unit. */
  groupId?: string;
}

export interface GradientSettings {
  enabled: boolean;
  type: 'linear' | 'radial';
  startColor: string;
  endColor: string;
  angle: number; // 0-360 for linear
}

export interface ShapeStylePreset {
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDash: 'solid' | 'dashed' | 'dotted';
  cornerRadius: number;
  opacity: number;
  gradient?: GradientSettings;
  shadow?: ShadowSettings;
}

// PowerPoint-style arrow configuration
export type ArrowType = 'none' | 'triangle' | 'open' | 'stealth' | 'oval' | 'diamond';
export type ArrowSize = 'small' | 'medium' | 'large';
export type LineCap = 'flat' | 'round' | 'square';

export interface ArrowConfig {
  type: ArrowType;
  size: ArrowSize;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  fill: string; // color or 'none'
  gradient?: GradientSettings;
  stroke: string;
  strokeWidth: number;
  strokeDash: 'solid' | 'dashed' | 'dotted';
  cornerRadius?: number;
  /** Relative nodes for polyline / arc start–end (coords relative to element x/y) */
  points?: Point[];
  /** Circular arc radius (px, in element local space) */
  arcRadius?: number;
  /** SVG large-arc-flag */
  arcLarge?: boolean;
  /** SVG sweep-flag (direction) */
  arcSweep?: boolean;
  /** Bezier anchors for shapeType 'path' (coords relative to element x/y) */
  pathNodes?: PathNode[];
  /** Closed paths get a Z and are filled */
  pathClosed?: boolean;
  
  // PowerPoint-style arrow line properties (for line/arrow types)
  /** Line cap style for arrow lines */
  lineCap?: LineCap;
  /** Begin arrow configuration */
  beginArrow?: ArrowConfig;
  /** End arrow configuration */
  endArrow?: ArrowConfig;
}

export interface Point {
  x: number;
  y: number;
}

/** One anchor of a pen path. Handles are absolute positions in the same space as x/y. */
export interface PathNode {
  x: number;
  y: number;
  handleIn?: Point;
  handleOut?: Point;
}

export interface BrushStrokeElement extends BaseElement {
  type: 'brush';
  points: Point[];
  color: string;
  strokeWidth: number;
  isHighlighter?: boolean;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  backgroundColor?: string;
}

/**
 * 표(테이블) 격자 설정 — 캔버스를 규격 수의 칸으로 균등 분할한다.
 * 셀 좌표는 캔버스 크기에 따라 계산되므로 캔버스를 바꾸면 자동 갱신된다.
 */
export interface TableGridSpec {
  /** 가로 칸 수 (열) */
  columns: number;
  /** 세로 칸 수 (행) */
  rows: number;
  /** 칸 사이 여백 (px) */
  gap: number;
  /** 칸 경계 가이드선 표시 여부 */
  showGuides: boolean;
}

/** 이미지 맞춤 방식 — 'none'은 기존 늘이기(stretch) 동작 */
export type ImageAspectFit = 'none' | 'cover' | 'contain';

export interface ImageFilters {
  brightness: number; // 0 to 200, 100 is normal
  contrast: number; // 0 to 200, 100 is normal
  saturation: number; // 0 to 200, 100 is normal
  blur: number; // 0 to 20 px
  grayscale: number; // 0 to 100%
  invert: number; // 0 to 100%
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string; // base64 or URL
  naturalWidth: number;
  naturalHeight: number;
  filters: ImageFilters;
  /** When true, mouse/numeric resize keeps width:height ratio */
  lockAspectRatio?: boolean;
  cornerRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  /**
   * 이미지 맞춤 방식.
   * 'none'(기본): 셀/박스를 그대로 늘려 distorted될 수 있음(기존 동작).
   * 'cover': 비율을 유지한 채 빈틈 없이 채움(중앙 기준, 잘림 발생).
   * 'contain': 비율을 유지한 채 전체가 보이도록 맞춤(여백 발생).
   */
  aspectFit?: ImageAspectFit;
  /** 맞춤 모드에서 확대 비율 (1 = 기본) */
  aspectZoom?: number;
  /** 맞춤 모드에서 초점 X (0 = 좌측, 0.5 = 중앙, 1 = 우측) */
  aspectFocusX?: number;
  /** 맞춤 모드에서 초점 Y (0 = 상단, 0.5 = 중앙, 1 = 하단) */
  aspectFocusY?: number;
}

export type CanvasElement =
  | ShapeElement
  | BrushStrokeElement
  | TextElement
  | ImageElement;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export type ToolType =
  | 'select'
  | 'pan'
  | 'brush'
  | 'highlighter'
  | 'eraser'
  | 'shape'
  | 'text'
  | 'eyedropper'
  | 'fill'
  | 'crop'
  | 'radial'
  | 'pen'
  | 'lasso';

export interface CanvasConfig {
  width: number;
  height: number;
  backgroundColor: string;
  showGrid: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  gridSize: number;
  /** 표(테이블) 격자 설정 — 없으면 격자 기능이 꺼져 있음 */
  tableGrid?: TableGridSpec;
}

export interface HistorySnapshot {
  elements: CanvasElement[];
  layers: Layer[];
  activeLayerId: string;
  canvasConfig: CanvasConfig;
}

/** Radial array (방사상 배열) tool – workflow stage */
export type RadialStep =
  | 'idle' // tool not active
  | 'placing_center' // waiting for the first click (center point)
  | 'adjusting_radius' // dragging to set the radius
  | 'preview'; // preview shown, waiting for confirm / cancel

/** How the copies of a radial array are oriented */
export type RadialRotateMode =
  | 'none' // every copy keeps the original orientation
  | 'tangential' // copies follow the circle (pinwheel / swirl)
  | 'radial'; // copies point away from the center (sunburst)

export interface RadialToolState {
  step: RadialStep;
  /** Center of the array in canvas coordinates */
  center?: Point;
  /** Distance from the center to each copy */
  radius: number;
  /** Number of copies (2-50) */
  count: number;
  /** Angle of the first copy, in degrees */
  startAngle: number;
  /** Angular span covered by the array, in degrees (0-360) */
  sweepAngle: number;
  /** Orientation of the copies */
  rotateMode: RadialRotateMode;
  /** Hide the source element once the array is created (keeps only the ring) */
  hideSource?: boolean;
  /** Element that gets replicated (the primary/reference element) */
  sourceElement?: CanvasElement;
  /** All elements to be replicated (includes group members if source is grouped) */
  sourceElements?: CanvasElement[];
  /** Live preview of the copies */
  previewElements: CanvasElement[];
}

export type HandleType =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate'
  | 'line-start'
  | 'line-end';
