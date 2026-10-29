/**
 * Regression checks for the 2026-10-29 audit fixes:
 * history branching, project validation, locks, clone groups, viewport fit, modal gates.
 *
 * Run: node scripts/run-node-esm.mjs scripts/verify-corrections.ts
 */
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  HISTORY_LIMIT,
} from '../src/hooks/useDocumentHistory';
import { HistorySnapshot, CanvasElement, Layer, CanvasConfig } from '../src/types';
import { validateProjectData } from '../src/utils/projectSchema';
import {
  canApplyElementMutation,
  canDeleteLayer,
  canEditElement,
  elementsRemainingAfterClear,
  isLockFlagToggle,
} from '../src/utils/lockGuards';
import { cloneElements, remapRadialInstanceGroups } from '../src/utils/cloneElements';
import {
  computeViewportFit,
  clampManualZoom,
  shouldApplyFitNonce,
  MIN_ZOOM,
  MAX_ZOOM,
  FIT_MIN_ZOOM,
  RULER_SIZE,
  FIT_PADDING,
} from '../src/utils/viewportFit';
import {
  shouldBlockDocumentPaste,
  shouldBlockDocumentShortcut,
} from '../src/utils/documentShortcuts';
import { isFocusableCandidate, shouldWrapFocus } from '../src/components/ModalDialog';
import { buildRadialPreview } from '../src/utils/radialArray';
import { RadialToolState } from '../src/types';

let failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const config: CanvasConfig = {
  width: 800,
  height: 600,
  backgroundColor: '#ffffff',
  showGrid: false,
  showRulers: true,
  snapToGrid: false,
  gridSize: 20,
};

const layer: Layer = {
  id: 'layer-1',
  name: '레이어1',
  visible: true,
  locked: false,
  opacity: 1,
};

function snap(
  partial: Partial<HistorySnapshot> & { canvasConfig?: CanvasConfig }
): HistorySnapshot {
  return {
    elements: partial.elements ?? [],
    layers: partial.layers ?? [layer],
    activeLayerId: partial.activeLayerId ?? 'layer-1',
    canvasConfig: partial.canvasConfig ?? config,
  };
}

function rect(id: string, extra: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    layerId: 'layer-1',
    name: id,
    type: 'shape',
    shapeType: 'rect',
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    rotation: 0,
    opacity: 1,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    strokeDash: 'solid',
    ...extra,
  } as CanvasElement;
}

console.log('history branching');
{
  let h = createHistory(snap({ canvasConfig: { ...config, showGrid: false, showRulers: true } }));
  h = commitHistory(h, snap({ canvasConfig: { ...config, showGrid: true, showRulers: true } }));
  assert('commit after initial has index 1', h.index === 1 && h.snapshots.length === 2);

  const undone = undoHistory(h);
  assert('undo returns previous snapshot', !!undone && undone.snapshot.canvasConfig.showGrid === false);
  h = undone!.state;
  assert('undo leaves redo available', h.index === 0 && h.snapshots.length === 2);

  // New edit after undo must discard redo branch and record the edit
  h = commitHistory(h, snap({ canvasConfig: { ...config, showGrid: false, showRulers: false } }));
  assert('new edit after undo truncates redo', h.snapshots.length === 2 && h.index === 1);
  assert('new edit is the current snapshot', h.snapshots[h.index].canvasConfig.showRulers === false);

  const redone = redoHistory(h);
  assert('redo after new edit is empty', redone === null);

  // Simulating StrictMode double-commit of a toggle would duplicate if commit
  // lived inside a state updater; callers must commit once. Two explicit
  // commits still stack, but undo/redo stay aligned to snapshot count.
  h = commitHistory(h, snap({ canvasConfig: { ...config, showGrid: true, showRulers: false } }));
  h = commitHistory(h, snap({ canvasConfig: { ...config, showGrid: true, showRulers: true } }));
  const u1 = undoHistory(h)!;
  const u2 = undoHistory(u1.state)!;
  assert('two undos reach the post-undo edit', u2.snapshot.canvasConfig.showRulers === false);

  // Layer add snapshot must carry the new activeLayerId
  h = commitHistory(createHistory(snap({})), snap({ activeLayerId: 'layer-2', layers: [layer, { ...layer, id: 'layer-2', name: '레이어2' }] }));
  assert('commit stores explicit activeLayerId', h.snapshots[h.index].activeLayerId === 'layer-2');

  // Cap
  h = createHistory(snap({}));
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    h = commitHistory(h, snap({ canvasConfig: { ...config, gridSize: i + 1 } }));
  }
  assert('history capped at limit', h.snapshots.length === HISTORY_LIMIT);
}

console.log('project validation');
{
  // Loose object so nested-malformed mutations stay type-checkable.
  const fixture: any = {
    version: '1.0.0',
    config,
    layers: [layer],
    elements: [rect('el-1'), rect('el-2', { x: 80, y: 80 })],
  };
  const valid = validateProjectData(fixture);
  assert('inlined valid project is accepted', valid.ok === true);

  const invalidLayers = { ...fixture, layers: { not: 'an-array' } };
  const badLayers = validateProjectData(invalidLayers);
  assert('layers object is rejected', badLayers.ok === false);

  const emptyLayers = { ...fixture, layers: [] };
  assert('empty layers rejected', validateProjectData(emptyLayers).ok === false);

  const dupId = {
    ...fixture,
    elements: [fixture.elements[0], { ...fixture.elements[1], id: fixture.elements[0].id }],
  };
  assert('duplicate element ids rejected', validateProjectData(dupId).ok === false);

  const badType = {
    ...fixture,
    elements: [{ ...fixture.elements[0], type: 'widget' }],
  };
  assert('unknown element type rejected', validateProjectData(badType).ok === false);

  const nanGeom = {
    ...fixture,
    elements: [{ ...fixture.elements[0], x: Number.NaN }],
  };
  assert('NaN geometry rejected', validateProjectData(nanGeom).ok === false);

  const danglingLayer = {
    ...fixture,
    elements: [{ ...fixture.elements[0], layerId: 'missing' }],
  };
  assert('dangling layerId rejected', validateProjectData(danglingLayer).ok === false);

  const badVersion = { ...fixture, version: '9.0.0' };
  assert('unsupported version rejected', validateProjectData(badVersion).ok === false);

  const noVersion = { ...fixture };
  delete noVersion.version;
  assert('missing version still accepted for 1.x files', validateProjectData(noVersion).ok === true);

  for (const points of [[null, null], {}, [{ x: 'bad', y: 0 }, { x: 1, y: 1 }]]) {
    const malformed = structuredClone(fixture);
    malformed.elements[0].shapeType = 'polyline';
    malformed.elements[0].points = points;
    assert(
      `malformed polyline points ${JSON.stringify(points)} rejected`,
      validateProjectData(malformed).ok === false
    );
  }

  const badLocked = structuredClone(fixture);
  badLocked.elements[0].locked = 'yes';
  assert('non-boolean locked rejected', validateProjectData(badLocked).ok === false);

  const badShadow = structuredClone(fixture);
  badShadow.elements[0].shadow = { color: '#000', blur: 'x', offsetX: 0, offsetY: 0 };
  assert('malformed shadow rejected', validateProjectData(badShadow).ok === false);
}

console.log('lock rules');
{
  const layers: Layer[] = [
    { id: 'layer-1', name: 'A', visible: true, locked: false, opacity: 1 },
    { id: 'layer-2', name: 'B', visible: true, locked: true, opacity: 1 },
  ];
  const free = rect('a');
  const lockedEl = rect('b', { locked: true });
  const onLockedLayer = rect('c', { layerId: 'layer-2' });

  assert('unlocked element is editable', canEditElement(free, layers));
  assert('element.locked is not editable', !canEditElement(lockedEl, layers));
  assert('locked-layer element is not editable', !canEditElement(onLockedLayer, layers));
  assert('locked layer cannot be deleted', !canDeleteLayer(layers[1], 2));
  assert('unlocked extra layer can be deleted', canDeleteLayer(layers[0], 2));

  const unlocked = { ...lockedEl, locked: false };
  assert('explicit unlock is a lock-flag toggle', isLockFlagToggle(lockedEl, unlocked));
  assert('explicit unlock is allowed', canApplyElementMutation(lockedEl, unlocked, layers));
  assert(
    'fill change on locked element is blocked',
    !canApplyElementMutation(lockedEl, { ...lockedEl, fill: '#00ff00' } as CanvasElement, layers)
  );
  assert(
    'mutation on locked-layer element is blocked',
    !canApplyElementMutation(onLockedLayer, { ...onLockedLayer, x: 99 }, layers)
  );

  const remaining = elementsRemainingAfterClear([free, lockedEl, onLockedLayer], layers);
  assert(
    'clear keeps locked content',
    remaining.map((el) => el.id).sort().join(',') === 'b,c'
  );

  const unlockedLayer: Layer = {
    id: 'layer-1',
    name: 'A',
    visible: true,
    locked: false,
    opacity: 1,
  };
  const otherLayer: Layer = {
    id: 'layer-2',
    name: 'B',
    visible: true,
    locked: false,
    opacity: 1,
  };
  const lockedChild = rect('locked-child', { locked: true, layerId: 'layer-1' });
  const sibling = rect('sibling', { layerId: 'layer-2' });
  assert(
    'unlocked layer with locked child cannot be deleted',
    !canDeleteLayer(unlockedLayer, 2, [lockedChild, sibling])
  );
  assert(
    'same layer without locked child can be deleted',
    canDeleteLayer(unlockedLayer, 2, [rect('free-child', { layerId: 'layer-1' }), sibling])
  );

  function deleteLayerIfAllowed(
    allLayers: Layer[],
    allElements: CanvasElement[],
    layerId: string
  ) {
    const target = allLayers.find((l) => l.id === layerId);
    if (!canDeleteLayer(target, allLayers.length, allElements)) {
      return { layers: allLayers, elements: allElements };
    }
    return {
      layers: allLayers.filter((l) => l.id !== layerId),
      elements: allElements.filter((el) => el.layerId !== layerId),
    };
  }
  const after = deleteLayerIfAllowed(
    [unlockedLayer, otherLayer],
    [lockedChild, sibling],
    'layer-1'
  );
  assert('locked child survives layer delete attempt', after.elements.some((el) => el.id === 'locked-child'));
  assert('second layer remains', after.layers.some((l) => l.id === 'layer-2'));
}

console.log('clone group identity / brush coordinates');
{
  const a = rect('a', { groupId: 'g1', x: 0, y: 0 });
  const b = rect('b', { groupId: 'g1', x: 50, y: 0 });
  const cloned = cloneElements([a, b], { offsetX: 10, offsetY: 10, stamp: 't1' });
  assert('clone gets new ids', cloned[0].id !== 'a' && cloned[1].id !== 'b');
  assert('clone batch shares one new group', cloned[0].groupId === cloned[1].groupId);
  assert('clone group id differs from original', cloned[0].groupId !== 'g1');
  assert('clone x/y offset applied', cloned[0].x === 10 && cloned[1].x === 60);

  const brush: CanvasElement = {
    id: 'br',
    layerId: 'layer-1',
    name: 'brush',
    type: 'brush',
    x: 5,
    y: 5,
    width: 20,
    height: 20,
    rotation: 0,
    opacity: 1,
    color: '#111',
    strokeWidth: 2,
    points: [
      { x: 5, y: 5 },
      { x: 15, y: 25 },
    ],
  };
  const [clonedBrush] = cloneElements([brush], { offsetX: 8, offsetY: 4, stamp: 'b1' });
  assert(
    'brush points move with offset',
    clonedBrush.type === 'brush' &&
      clonedBrush.points[0].x === 13 &&
      clonedBrush.points[0].y === 9 &&
      clonedBrush.points[1].x === 23 &&
      clonedBrush.points[1].y === 29
  );

  const copies = [
    { ...a, id: 'r0-0' },
    { ...b, id: 'r0-1' },
    { ...a, id: 'r1-0', x: 200 },
    { ...b, id: 'r1-1', x: 250 },
  ];
  const radial = remapRadialInstanceGroups(copies, 2, 'rad');
  assert('radial instance 0 grouped together', radial[0].groupId === radial[1].groupId);
  assert('radial instance 1 grouped together', radial[2].groupId === radial[3].groupId);
  assert('radial instances use different groups', radial[0].groupId !== radial[2].groupId);
  assert('radial groups differ from original g1', radial[0].groupId !== 'g1' && radial[2].groupId !== 'g1');

  const grouped = [a, b];
  const state: RadialToolState = {
    step: 'preview',
    center: { x: 400, y: 300 },
    radius: 80,
    count: 3,
    startAngle: 0,
    sweepAngle: 360,
    rotateMode: 'none',
    sourceElement: a,
    sourceElements: grouped,
    previewElements: [],
  };
  const preview = buildRadialPreview(state, 'layer-1');
  const g0 = preview.filter((_, i) => i < 2).map((el) => el.groupId);
  const g1 = preview.filter((_, i) => i >= 2 && i < 4).map((el) => el.groupId);
  assert('preview instance groups are internally equal', g0[0] === g0[1] && g1[0] === g1[1]);
  assert('preview instances are separated', g0[0] !== g1[0]);
}

console.log('viewport fit');
{
  const fit = computeViewportFit({
    viewportWidth: 1000,
    viewportHeight: 800,
    canvasWidth: 2000,
    canvasHeight: 1000,
    showRulers: false,
    padding: FIT_PADDING,
  });
  const availW = 1000 - FIT_PADDING * 2;
  const availH = 800 - FIT_PADDING * 2;
  const expected = Math.min(availW / 2000, availH / 1000);
  assert('fit zoom uses available viewport', Math.abs(fit.zoom - expected) < 1e-9);
  assert('fit zoom is not the old 0.85 constant', Math.abs(fit.zoom - 0.85) > 0.01);

  const withRulers = computeViewportFit({
    viewportWidth: 1000,
    viewportHeight: 800,
    canvasWidth: 2000,
    canvasHeight: 1000,
    showRulers: true,
  });
  const rAvailW = 1000 - RULER_SIZE - FIT_PADDING * 2;
  const rAvailH = 800 - RULER_SIZE - FIT_PADDING * 2;
  const rExpected = Math.min(rAvailW / 2000, rAvailH / 1000);
  assert('rulers reduce available size', Math.abs(withRulers.zoom - rExpected) < 1e-9);
  assert('pan is finite', Number.isFinite(withRulers.pan.x) && Number.isFinite(withRulers.pan.y));

  const tiny = computeViewportFit({
    viewportWidth: 10,
    viewportHeight: 10,
    canvasWidth: 4000,
    canvasHeight: 4000,
  });
  assert('fit zoom may go below manual 25%', tiny.zoom < MIN_ZOOM);
  assert('fit zoom respects fit min bound', tiny.zoom >= FIT_MIN_ZOOM);

  const huge = computeViewportFit({
    viewportWidth: 8000,
    viewportHeight: 8000,
    canvasWidth: 10,
    canvasHeight: 10,
  });
  assert('zoom respects max bound', huge.zoom === MAX_ZOOM);

  for (const viewportWidth of [240, 480, 900, 1440]) {
    for (const canvasWidth of [800, 1920, 4000]) {
      const result = computeViewportFit({
        viewportWidth,
        viewportHeight: 700,
        canvasWidth,
        canvasHeight: 1080,
        showRulers: true,
      });
      const fits =
        result.pan.x >= 24 &&
        result.pan.y >= 24 &&
        result.pan.x + canvasWidth * result.zoom <= viewportWidth &&
        result.pan.y + 1080 * result.zoom <= 700;
      assert(
        `fit contains ${canvasWidth}px canvas in ${viewportWidth}px stage`,
        fits,
        `zoom=${result.zoom} pan=${JSON.stringify(result.pan)}`
      );
    }
  }

  assert('manual zoom from 1 stays in 0.25–4', clampManualZoom(0.2, 1) === MIN_ZOOM);
  assert(
    'wheel from a fit zoom below 25% does not snap up to 25%',
    Math.abs(clampManualZoom(0.05 + 0.05, 0.05) - 0.1) < 1e-9
  );
  assert('fit nonce 0 is ignored', shouldApplyFitNonce(0, 0) === false);
  assert('same fit nonce does not re-apply', shouldApplyFitNonce(1, 1) === false);
  assert('new fit nonce applies once', shouldApplyFitNonce(2, 1) === true);
}

console.log('modal keyboard isolation');
{
  const body = { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget;
  assert(
    'delete is blocked while modal open',
    shouldBlockDocumentShortcut({ modalOpen: true, target: body })
  );
  assert(
    'shortcuts run when no modal',
    !shouldBlockDocumentShortcut({ modalOpen: false, target: body })
  );
  const input = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget;
  assert(
    'typing in inputs is ignored even without modal',
    shouldBlockDocumentShortcut({ modalOpen: false, target: input })
  );
  assert(
    'document paste blocked in export modal',
    shouldBlockDocumentPaste({ modalOpen: true, target: body })
  );
  assert(
    'clipboard-guide paste is not stolen',
    !shouldBlockDocumentPaste({
      modalOpen: true,
      allowClipboardPaste: true,
      target: body,
    })
  );
  assert(
    'hidden class is not focusable',
    !isFocusableCandidate({ className: 'hidden', clientRectCount: 0, tabIndex: 0 })
  );
  assert(
    'visible button is focusable',
    isFocusableCandidate({ className: 'px-2', clientRectCount: 1, tabIndex: 0 })
  );
  assert('forward Tab outside list wraps to first', shouldWrapFocus(-1, 4, false) === 'first');
  assert('forward Tab on last wraps to first', shouldWrapFocus(3, 4, false) === 'first');
  assert('Shift+Tab outside list wraps to last', shouldWrapFocus(-1, 4, true) === 'last');
  assert('interior Tab does not wrap', shouldWrapFocus(1, 4, false) === null);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall correction checks passed');
