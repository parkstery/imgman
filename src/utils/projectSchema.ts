import {
  CanvasConfig,
  CanvasElement,
  ElementType,
  ImageFilters,
  Layer,
  ShapeType,
} from '../types';

const ELEMENT_TYPES: ElementType[] = ['shape', 'brush', 'text', 'image'];

const SHAPE_TYPES: ShapeType[] = [
  'rect',
  'rounded-rect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'arrow-right',
  'arrow-bidirectional',
  'speech-bubble',
  'heart',
  'hexagon',
  'line',
  'line-arrow',
  'line-arrow-both',
  'line-arrow-start',
  'line-arrow-open',
  'line-arrow-dot',
  'line-arrow-diamond',
  'polyline',
  'arc',
  'path',
];

const STROKE_DASH = ['solid', 'dashed', 'dotted'] as const;
const TEXT_ALIGN = ['left', 'center', 'right'] as const;
const ARROW_TYPES = ['none', 'triangle', 'open', 'stealth', 'oval', 'diamond'] as const;
const ARROW_SIZES = ['small', 'medium', 'large'] as const;
const LINE_CAPS = ['flat', 'round', 'square'] as const;
const GRADIENT_TYPES = ['linear', 'radial'] as const;

export interface ValidatedProject {
  version: string;
  config: CanvasConfig;
  layers: Layer[];
  elements: CanvasElement[];
}

export type ProjectValidationResult =
  | { ok: true; data: ValidatedProject }
  | { ok: false; errors: string[] };

const MAX_CANVAS = 8000;
const MAX_GEOM = 100000;

function isObj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSupportedVersion(version: unknown): version is string {
  if (version == null) return true;
  if (typeof version !== 'string') return false;
  if (version === '1' || version === '1.0' || version === '1.0.0') return true;
  return /^1(\.\d+){0,2}$/.test(version);
}

function validateConfig(raw: unknown, errors: string[]): CanvasConfig | null {
  if (!isObj(raw)) {
    errors.push('config가 객체가 아닙니다.');
    return null;
  }
  if (!isFiniteNumber(raw.width) || !inRange(raw.width, 1, MAX_CANVAS)) {
    errors.push('config.width가 유효한 캔버스 너비가 아닙니다.');
  }
  if (!isFiniteNumber(raw.height) || !inRange(raw.height, 1, MAX_CANVAS)) {
    errors.push('config.height가 유효한 캔버스 높이가 아닙니다.');
  }
  if (typeof raw.backgroundColor !== 'string') {
    errors.push('config.backgroundColor가 문자열이 아닙니다.');
  }
  if (typeof raw.showGrid !== 'boolean') {
    errors.push('config.showGrid가 boolean이 아닙니다.');
  }
  if (typeof raw.showRulers !== 'boolean') {
    errors.push('config.showRulers가 boolean이 아닙니다.');
  }
  if (typeof raw.snapToGrid !== 'boolean') {
    errors.push('config.snapToGrid가 boolean이 아닙니다.');
  }
  if (!isFiniteNumber(raw.gridSize) || !inRange(raw.gridSize, 1, 1000)) {
    errors.push('config.gridSize가 유효하지 않습니다.');
  }
  if (errors.length > 0) return null;
  return {
    width: raw.width as number,
    height: raw.height as number,
    backgroundColor: raw.backgroundColor as string,
    showGrid: raw.showGrid as boolean,
    showRulers: raw.showRulers as boolean,
    snapToGrid: raw.snapToGrid as boolean,
    gridSize: raw.gridSize as number,
  };
}

function validateLayer(raw: unknown, index: number, errors: string[]): Layer | null {
  if (!isObj(raw)) {
    errors.push(`layers[${index}]가 객체가 아닙니다.`);
    return null;
  }
  if (!isNonEmptyString(raw.id)) errors.push(`layers[${index}].id가 없습니다.`);
  if (typeof raw.name !== 'string') errors.push(`layers[${index}].name이 문자열이 아닙니다.`);
  if (typeof raw.visible !== 'boolean') errors.push(`layers[${index}].visible이 boolean이 아닙니다.`);
  if (typeof raw.locked !== 'boolean') errors.push(`layers[${index}].locked가 boolean이 아닙니다.`);
  if (!isFiniteNumber(raw.opacity) || !inRange(raw.opacity, 0, 1)) {
    errors.push(`layers[${index}].opacity가 0–1 범위의 수가 아닙니다.`);
  }
  if (errors.some((e) => e.startsWith(`layers[${index}]`))) return null;
  return {
    id: raw.id as string,
    name: raw.name as string,
    visible: raw.visible as boolean,
    locked: raw.locked as boolean,
    opacity: raw.opacity as number,
  };
}

function validateGeom(raw: Record<string, unknown>, label: string, errors: string[]): void {
  for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    if (!isFiniteNumber(raw[key]) || !inRange(raw[key] as number, -MAX_GEOM, MAX_GEOM)) {
      errors.push(`${label}.${key}가 유한한 좌표/크기가 아닙니다.`);
    }
  }
  if (isFiniteNumber(raw.width) && raw.width < 0) {
    errors.push(`${label}.width가 음수입니다.`);
  }
  if (isFiniteNumber(raw.height) && raw.height < 0) {
    errors.push(`${label}.height가 음수입니다.`);
  }
  if (!isFiniteNumber(raw.opacity) || !inRange(raw.opacity, 0, 1)) {
    errors.push(`${label}.opacity가 0–1 범위의 수가 아닙니다.`);
  }
}

function optionalBoolean(
  raw: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[]
): void {
  if (raw[key] !== undefined && typeof raw[key] !== 'boolean') {
    errors.push(`${label}.${key}가 boolean이 아닙니다.`);
  }
}

function validatePoints(
  raw: unknown,
  label: string,
  errors: string[],
  requiredMin?: number
): void {
  if (raw === undefined) {
    if (requiredMin) errors.push(`${label}.points가 필요합니다.`);
    return;
  }
  if (!Array.isArray(raw)) {
    errors.push(`${label}.points가 배열이 아닙니다.`);
    return;
  }
  if (requiredMin && raw.length < requiredMin) {
    errors.push(`${label}.points가 ${requiredMin}개 이상이어야 합니다.`);
  }
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!isObj(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
      errors.push(`${label}.points[${i}]가 유효한 좌표가 아닙니다.`);
      break;
    }
  }
}

function isFinitePoint(p: unknown): boolean {
  return isObj(p) && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

function validatePathNodes(raw: unknown, label: string, errors: string[], required: boolean): void {
  if (raw === undefined) {
    if (required) errors.push(`${label}.pathNodes가 필요합니다.`);
    return;
  }
  if (!Array.isArray(raw)) {
    errors.push(`${label}.pathNodes가 배열이 아닙니다.`);
    return;
  }
  if (raw.length < 2) {
    errors.push(`${label}.pathNodes가 2개 이상이어야 합니다.`);
    return;
  }
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i];
    if (
      !isFinitePoint(n) ||
      ((n as Record<string, unknown>).handleIn !== undefined && !isFinitePoint((n as Record<string, unknown>).handleIn)) ||
      ((n as Record<string, unknown>).handleOut !== undefined && !isFinitePoint((n as Record<string, unknown>).handleOut))
    ) {
      errors.push(`${label}.pathNodes[${i}]가 유효한 노드가 아닙니다.`);
      break;
    }
  }
}

function validateShadow(raw: unknown, label: string, errors: string[]): void {
  if (raw === undefined) return;
  if (!isObj(raw)) {
    errors.push(`${label}.shadow가 객체가 아닙니다.`);
    return;
  }
  if (typeof raw.enabled !== 'boolean') errors.push(`${label}.shadow.enabled가 boolean이 아닙니다.`);
  if (typeof raw.color !== 'string') errors.push(`${label}.shadow.color가 문자열이 아닙니다.`);
  for (const key of ['blur', 'offsetX', 'offsetY'] as const) {
    if (!isFiniteNumber(raw[key])) {
      errors.push(`${label}.shadow.${key}가 유한한 수가 아닙니다.`);
    }
  }
}

function validateGradient(raw: unknown, label: string, errors: string[]): void {
  if (raw === undefined) return;
  if (!isObj(raw)) {
    errors.push(`${label}.gradient가 객체가 아닙니다.`);
    return;
  }
  if (typeof raw.enabled !== 'boolean') errors.push(`${label}.gradient.enabled가 boolean이 아닙니다.`);
  if (!GRADIENT_TYPES.includes(raw.type as (typeof GRADIENT_TYPES)[number])) {
    errors.push(`${label}.gradient.type이 유효하지 않습니다.`);
  }
  if (typeof raw.startColor !== 'string') {
    errors.push(`${label}.gradient.startColor가 문자열이 아닙니다.`);
  }
  if (typeof raw.endColor !== 'string') {
    errors.push(`${label}.gradient.endColor가 문자열이 아닙니다.`);
  }
  if (!isFiniteNumber(raw.angle)) {
    errors.push(`${label}.gradient.angle이 유한한 수가 아닙니다.`);
  }
}

function validateArrow(raw: unknown, label: string, field: string, errors: string[]): void {
  if (raw === undefined) return;
  if (!isObj(raw)) {
    errors.push(`${label}.${field}가 객체가 아닙니다.`);
    return;
  }
  if (!ARROW_TYPES.includes(raw.type as (typeof ARROW_TYPES)[number])) {
    errors.push(`${label}.${field}.type이 유효하지 않습니다.`);
  }
  if (!ARROW_SIZES.includes(raw.size as (typeof ARROW_SIZES)[number])) {
    errors.push(`${label}.${field}.size가 유효하지 않습니다.`);
  }
}

function validateFilters(raw: unknown, label: string, errors: string[]): ImageFilters | null {
  if (!isObj(raw)) {
    errors.push(`${label}.filters가 객체가 아닙니다.`);
    return null;
  }
  const keys = ['brightness', 'contrast', 'saturation', 'blur', 'grayscale', 'invert'] as const;
  for (const key of keys) {
    if (!isFiniteNumber(raw[key])) {
      errors.push(`${label}.filters.${key}가 유한한 수가 아닙니다.`);
    }
  }
  if (errors.some((e) => e.startsWith(`${label}.filters`))) return null;
  return {
    brightness: raw.brightness as number,
    contrast: raw.contrast as number,
    saturation: raw.saturation as number,
    blur: raw.blur as number,
    grayscale: raw.grayscale as number,
    invert: raw.invert as number,
  };
}

function validateElement(
  raw: unknown,
  index: number,
  layerIds: Set<string>,
  errors: string[]
): CanvasElement | null {
  const label = `elements[${index}]`;
  if (!isObj(raw)) {
    errors.push(`${label}가 객체가 아닙니다.`);
    return null;
  }
  if (!isNonEmptyString(raw.id)) errors.push(`${label}.id가 없습니다.`);
  if (!isNonEmptyString(raw.layerId)) errors.push(`${label}.layerId가 없습니다.`);
  else if (!layerIds.has(raw.layerId)) {
    errors.push(`${label}.layerId '${raw.layerId}'가 레이어 목록에 없습니다.`);
  }
  if (typeof raw.name !== 'string') errors.push(`${label}.name이 문자열이 아닙니다.`);
  if (!ELEMENT_TYPES.includes(raw.type as ElementType)) {
    errors.push(`${label}.type '${String(raw.type)}'을 지원하지 않습니다.`);
    return null;
  }
  validateGeom(raw, label, errors);

  optionalBoolean(raw, 'locked', label, errors);
  optionalBoolean(raw, 'visible', label, errors);
  optionalBoolean(raw, 'flipH', label, errors);
  optionalBoolean(raw, 'flipV', label, errors);
  if (raw.groupId !== undefined && typeof raw.groupId !== 'string') {
    errors.push(`${label}.groupId가 문자열이 아닙니다.`);
  }
  validateShadow(raw.shadow, label, errors);

  const type = raw.type as ElementType;
  if (type === 'shape') {
    if (!SHAPE_TYPES.includes(raw.shapeType as ShapeType)) {
      errors.push(`${label}.shapeType '${String(raw.shapeType)}'을 지원하지 않습니다.`);
    }
    if (typeof raw.fill !== 'string') errors.push(`${label}.fill이 문자열이 아닙니다.`);
    if (typeof raw.stroke !== 'string') errors.push(`${label}.stroke가 문자열이 아닙니다.`);
    if (!isFiniteNumber(raw.strokeWidth) || raw.strokeWidth < 0) {
      errors.push(`${label}.strokeWidth가 유효하지 않습니다.`);
    }
    if (!STROKE_DASH.includes(raw.strokeDash as (typeof STROKE_DASH)[number])) {
      errors.push(`${label}.strokeDash가 유효하지 않습니다.`);
    }
    const needsPoints = raw.shapeType === 'polyline' || raw.shapeType === 'arc';
    validatePoints(raw.points, label, errors, needsPoints ? 2 : undefined);
    validatePathNodes(raw.pathNodes, label, errors, raw.shapeType === 'path');
    optionalBoolean(raw, 'pathClosed', label, errors);
    validateGradient(raw.gradient, label, errors);
    if (raw.cornerRadius !== undefined && !isFiniteNumber(raw.cornerRadius)) {
      errors.push(`${label}.cornerRadius가 유한한 수가 아닙니다.`);
    }
    if (raw.arcRadius !== undefined && !isFiniteNumber(raw.arcRadius)) {
      errors.push(`${label}.arcRadius가 유한한 수가 아닙니다.`);
    }
    optionalBoolean(raw, 'arcLarge', label, errors);
    optionalBoolean(raw, 'arcSweep', label, errors);
    if (raw.lineCap !== undefined && !LINE_CAPS.includes(raw.lineCap as (typeof LINE_CAPS)[number])) {
      errors.push(`${label}.lineCap이 유효하지 않습니다.`);
    }
    validateArrow(raw.beginArrow, label, 'beginArrow', errors);
    validateArrow(raw.endArrow, label, 'endArrow', errors);
  } else if (type === 'brush') {
    validatePoints(raw.points, label, errors, 1);
    if (typeof raw.color !== 'string') errors.push(`${label}.color가 문자열이 아닙니다.`);
    if (!isFiniteNumber(raw.strokeWidth) || raw.strokeWidth < 0) {
      errors.push(`${label}.strokeWidth가 유효하지 않습니다.`);
    }
    optionalBoolean(raw, 'isHighlighter', label, errors);
  } else if (type === 'text') {
    if (typeof raw.text !== 'string') errors.push(`${label}.text가 문자열이 아닙니다.`);
    if (typeof raw.fontFamily !== 'string') errors.push(`${label}.fontFamily가 문자열이 아닙니다.`);
    if (!isFiniteNumber(raw.fontSize) || raw.fontSize <= 0) {
      errors.push(`${label}.fontSize가 유효하지 않습니다.`);
    }
    if (typeof raw.color !== 'string') errors.push(`${label}.color가 문자열이 아닙니다.`);
    if (typeof raw.bold !== 'boolean') errors.push(`${label}.bold가 boolean이 아닙니다.`);
    if (typeof raw.italic !== 'boolean') errors.push(`${label}.italic가 boolean이 아닙니다.`);
    if (typeof raw.underline !== 'boolean') errors.push(`${label}.underline이 boolean이 아닙니다.`);
    if (!TEXT_ALIGN.includes(raw.align as (typeof TEXT_ALIGN)[number])) {
      errors.push(`${label}.align이 유효하지 않습니다.`);
    }
  } else if (type === 'image') {
    if (typeof raw.src !== 'string' || raw.src.length === 0) {
      errors.push(`${label}.src가 없습니다.`);
    }
    if (!isFiniteNumber(raw.naturalWidth) || raw.naturalWidth <= 0) {
      errors.push(`${label}.naturalWidth가 유효하지 않습니다.`);
    }
    if (!isFiniteNumber(raw.naturalHeight) || raw.naturalHeight <= 0) {
      errors.push(`${label}.naturalHeight가 유효하지 않습니다.`);
    }
    const filters = validateFilters(raw.filters, label, errors);
    if (!filters) {
      /* counted in errors */
    }
    optionalBoolean(raw, 'lockAspectRatio', label, errors);
    if (raw.cornerRadius !== undefined && !isFiniteNumber(raw.cornerRadius)) {
      errors.push(`${label}.cornerRadius가 유한한 수가 아닙니다.`);
    }
    if (raw.borderWidth !== undefined && !isFiniteNumber(raw.borderWidth)) {
      errors.push(`${label}.borderWidth가 유한한 수가 아닙니다.`);
    }
    if (raw.borderColor !== undefined && typeof raw.borderColor !== 'string') {
      errors.push(`${label}.borderColor가 문자열이 아닙니다.`);
    }
  }

  if (type !== 'shape' && type !== 'brush' && raw.points !== undefined) {
    validatePoints(raw.points, label, errors);
  }

  if (errors.some((e) => e.startsWith(label))) return null;
  return raw as unknown as CanvasElement;
}

export function formatProjectErrors(errors: string[]): string {
  const shown = errors.slice(0, 6);
  const extra = errors.length > shown.length ? ` 외 ${errors.length - shown.length}건` : '';
  return `프로젝트 파일을 열 수 없습니다: ${shown.join(' / ')}${extra}`;
}

/**
 * Runtime-validate a parsed JSON value before it is written into app state.
 * Existing valid 1.x project files are accepted.
 */
export function validateProjectData(raw: unknown): ProjectValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) {
    return { ok: false, errors: ['루트가 JSON 객체가 아닙니다.'] };
  }
  if (!isSupportedVersion(raw.version)) {
    errors.push(`지원하지 않는 version '${String(raw.version)}' 입니다.`);
  }
  if (!Array.isArray(raw.layers)) {
    errors.push('layers가 배열이 아닙니다.');
  }
  if (!Array.isArray(raw.elements)) {
    errors.push('elements가 배열이 아닙니다.');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const config = validateConfig(raw.config, errors);
  const layersRaw = raw.layers as unknown[];
  if (layersRaw.length < 1) {
    errors.push('레이어가 하나 이상 필요합니다.');
  }

  const layers: Layer[] = [];
  const layerIds = new Set<string>();
  layersRaw.forEach((item, i) => {
    const layer = validateLayer(item, i, errors);
    if (!layer) return;
    if (layerIds.has(layer.id)) {
      errors.push(`레이어 ID '${layer.id}'가 중복됩니다.`);
      return;
    }
    layerIds.add(layer.id);
    layers.push(layer);
  });

  const elements: CanvasElement[] = [];
  const elementIds = new Set<string>();
  (raw.elements as unknown[]).forEach((item, i) => {
    const el = validateElement(item, i, layerIds, errors);
    if (!el) return;
    if (elementIds.has(el.id)) {
      errors.push(`객체 ID '${el.id}'가 중복됩니다.`);
      return;
    }
    elementIds.add(el.id);
    elements.push(el);
  });

  if (errors.length > 0 || !config) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      version: typeof raw.version === 'string' ? raw.version : '1.0.0',
      config,
      layers,
      elements,
    },
  };
}
