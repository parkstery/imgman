import { CanvasElement, HistorySnapshot } from '../types';

const TYPE_NAMES: Record<string, string> = {
  brush: '브러시',
  text: '텍스트',
  image: '이미지',
};

function elementLabel(el: CanvasElement): string {
  if (el.name && el.name.trim()) return el.name.trim();
  if (el.type === 'shape') return el.shapeType === 'path' ? '펜 패스' : '도형';
  return TYPE_NAMES[el.type] ?? '객체';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function changedKeys(prev: CanvasElement, next: CanvasElement): Set<string> {
  const keys = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
  const out = new Set<string>();
  for (const k of keys) {
    if (!sameValue((prev as unknown as Record<string, unknown>)[k], (next as unknown as Record<string, unknown>)[k])) {
      out.add(k);
    }
  }
  return out;
}

/** Name the kind of edit from the set of changed fields. */
function editVerb(keys: Set<string>): string {
  const only = (...names: string[]) => [...keys].every((k) => names.includes(k));
  if (keys.has('pathNodes') && !keys.has('width') && !keys.has('shapeType')) return '점 편집';
  if (keys.has('shapeType')) return '형식 변환';
  if (keys.has('src')) return '이미지 편집';
  if (only('x', 'y', 'points')) return '이동';
  if (only('rotation')) return '회전';
  if (only('flipH', 'flipV')) return '뒤집기';
  if (keys.has('width') || keys.has('height')) return '크기 조절';
  if (only('text')) return '텍스트 수정';
  if (only('visible')) return '표시 전환';
  if (only('locked')) return '잠금 전환';
  if (only('layerId')) return '레이어 이동';
  if (only('groupId')) return '그룹 변경';
  if (keys.has('filters')) return '필터 조정';
  return '속성 변경';
}

/**
 * Human label for the step that turned `prev` into `next`. Derived from the
 * snapshots themselves so no call site has to name its edit.
 */
export function describeHistoryStep(prev: HistorySnapshot | null, next: HistorySnapshot): string {
  if (!prev) return next.elements.length > 0 ? '문서 열기' : '새 문서';

  const pc = prev.canvasConfig;
  const nc = next.canvasConfig;
  const prevById = new Map(prev.elements.map((el) => [el.id, el]));
  const nextById = new Map(next.elements.map((el) => [el.id, el]));
  const added = next.elements.filter((el) => !prevById.has(el.id));
  const removed = prev.elements.filter((el) => !nextById.has(el.id));

  if (pc.width !== nc.width || pc.height !== nc.height) {
    return `캔버스 크기 ${nc.width}×${nc.height}`;
  }
  if (added.length === 0 && removed.length > 0 && next.elements.length === 0) return '캔버스 비우기';

  if (added.length > 0 && removed.length > 0) {
    return `객체 ${removed.length}개 → ${added.length}개 교체`;
  }
  if (added.length === 1) return `${elementLabel(added[0])} 추가`;
  if (added.length > 1) return `객체 ${added.length}개 추가`;
  if (removed.length === 1) return `${elementLabel(removed[0])} 삭제`;
  if (removed.length > 1) return `객체 ${removed.length}개 삭제`;

  const changed: { el: CanvasElement; keys: Set<string> }[] = [];
  for (const el of next.elements) {
    const before = prevById.get(el.id);
    if (!before) continue;
    const keys = changedKeys(before, el);
    if (keys.size > 0) changed.push({ el, keys });
  }
  if (changed.length === 1) return `${elementLabel(changed[0].el)} ${editVerb(changed[0].keys)}`;
  if (changed.length > 1) {
    const verbs = new Set(changed.map((c) => editVerb(c.keys)));
    return verbs.size === 1 ? `객체 ${changed.length}개 ${[...verbs][0]}` : `객체 ${changed.length}개 수정`;
  }

  const prevOrder = prev.elements.map((el) => el.id).join('|');
  const nextOrder = next.elements.map((el) => el.id).join('|');
  if (prevOrder !== nextOrder) return '쌓기 순서 변경';

  if (prev.layers.length < next.layers.length) return '레이어 추가';
  if (prev.layers.length > next.layers.length) return '레이어 삭제';
  if (prev.layers.map((l) => l.id).join('|') !== next.layers.map((l) => l.id).join('|')) return '레이어 순서 변경';
  if (!sameValue(prev.layers, next.layers)) return '레이어 속성 변경';

  if (pc.backgroundColor !== nc.backgroundColor) return '배경색 변경';
  if (!sameValue(pc, nc)) return '캔버스 설정 변경';
  if (prev.activeLayerId !== next.activeLayerId) return '레이어 선택';
  return '변경 없음';
}
