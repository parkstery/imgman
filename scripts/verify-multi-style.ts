/**
 * Checks for multi-selection color propagation from the PropertiesPanel.
 *
 * Run: node scripts/run-node-esm.mjs scripts/verify-multi-style.ts
 */
import type {
  BrushStrokeElement,
  CanvasElement,
  ImageElement,
  ShapeElement,
  TextElement,
} from '../src/types';
import { propagateColorChange } from '../src/utils/multiStyle';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function shape(id: string, patch: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id,
    type: 'shape',
    shapeType: 'rect',
    name: id,
    layerId: 'l',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: '#111111',
    stroke: '#000000',
    strokeWidth: 2,
    strokeDash: 'solid',
    ...patch,
  };
}

function line(id: string, patch: Partial<ShapeElement> = {}): ShapeElement {
  return shape(id, { shapeType: 'line', fill: 'none', stroke: '#000000', ...patch });
}

function text(id: string, patch: Partial<TextElement> = {}): TextElement {
  return {
    id,
    type: 'text',
    name: id,
    layerId: 'l',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: 'hello',
    fontFamily: 'Arial',
    fontSize: 16,
    color: '#111111',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    ...patch,
  };
}

function brush(id: string, patch: Partial<BrushStrokeElement> = {}): BrushStrokeElement {
  return {
    id,
    type: 'brush',
    name: id,
    layerId: 'l',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    points: [{ x: 0, y: 0 }],
    color: '#111111',
    strokeWidth: 4,
    ...patch,
  };
}

function image(id: string, patch: Partial<ImageElement> = {}): ImageElement {
  return {
    id,
    type: 'image',
    name: id,
    layerId: 'l',
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 40,
    naturalHeight: 20,
    filters: { brightness: 100, contrast: 100, saturation: 100, blur: 0, grayscale: 0, invert: 0 },
    ...patch,
  };
}

function byId(elements: CanvasElement[], id: string): CanvasElement | undefined {
  return elements.find((el) => el.id === id);
}
function shapeById(elements: CanvasElement[], id: string): ShapeElement | undefined {
  const el = byId(elements, id);
  return el?.type === 'shape' ? el : undefined;
}
function textById(elements: CanvasElement[], id: string): TextElement | undefined {
  const el = byId(elements, id);
  return el?.type === 'text' ? el : undefined;
}
function brushById(elements: CanvasElement[], id: string): BrushStrokeElement | undefined {
  const el = byId(elements, id);
  return el?.type === 'brush' ? el : undefined;
}
function imageById(elements: CanvasElement[], id: string): ImageElement | undefined {
  const el = byId(elements, id);
  return el?.type === 'image' ? el : undefined;
}

console.log('no color change -> []');
{
  const before = shape('src');
  const moved = { ...before, x: 50, y: 60, width: 99 };
  const others = [shape('other'), text('t'), image('i')];
  check('move/resize returns no changes', propagateColorChange(before, moved, others).length === 0);

  const resized = { ...before, strokeWidth: 9, strokeDash: 'dashed' as const };
  check('strokeWidth/strokeDash returns no changes', propagateColorChange(before, resized, others).length === 0);

  const t = text('t1');
  const edited = { ...t, text: 'edited', fontSize: 30 };
  check('text content edit returns no changes', propagateColorChange(t, edited, [text('t2')]).length === 0);
}

console.log('shape fill change');
{
  const source = shape('src', { fill: '#222222' });
  const updated = { ...source, fill: '#ABCDEF' };
  const plain = shape('plain', { fill: '#333333' });
  const gradient = shape('gradient', {
    fill: '#444444',
    gradient: { enabled: true, type: 'linear', startColor: '#444444', endColor: '#555555', angle: 45 },
  });
  const ln = line('ln', { stroke: '#666666' });
  const tx = text('tx', { color: '#777777' });
  const br = brush('br', { color: '#888888' });
  const img = image('img', { borderColor: '#999999' });
  const inputs = JSON.stringify([plain, gradient, ln, tx, br, img]);
  const res = propagateColorChange(source, updated, [plain, gradient, ln, tx, br, img]);

  check('closed shape + gradient shape + line + text + brush change', res.length === 5);
  check('closed shape takes the new fill', shapeById(res, 'plain')?.fill === '#ABCDEF');
  const g = shapeById(res, 'gradient');
  const gGradient = g?.gradient;
  check(
    'gradient is disabled and restarted with the new fill',
    gGradient?.enabled === false && gGradient.startColor === '#ABCDEF' && gGradient.endColor === '#555555'
  );
  check('line takes the new fill as stroke', shapeById(res, 'ln')?.stroke === '#ABCDEF');
  check('text takes the new fill as color', textById(res, 'tx')?.color === '#ABCDEF');
  check('brush takes the new fill as color', brushById(res, 'br')?.color === '#ABCDEF');
  check('image is untouched', byId(res, 'img') === undefined);
  check('inputs are not mutated', JSON.stringify([plain, gradient, ln, tx, br, img]) === inputs);
  check(
    'results are new objects',
    res.every((el) => [plain, gradient, ln, tx, br, img].every((input) => el !== input))
  );
}

console.log('shape fill "none"');
{
  const source = shape('src', { fill: '#222222' });
  const updated = { ...source, fill: 'none' };
  const plain = shape('plain', { fill: '#333333' });
  const gradient = shape('gradient', {
    fill: '#444444',
    gradient: { enabled: true, type: 'linear', startColor: '#444444', endColor: '#555555', angle: 0 },
  });
  const ln = line('ln', { stroke: '#666666' });
  const tx = text('tx', { color: '#777777' });
  const br = brush('br', { color: '#888888' });
  const res = propagateColorChange(source, updated, [plain, gradient, ln, tx, br]);

  check('only closed shapes change', res.length === 2);
  check('closed shape fill becomes none', shapeById(res, 'plain')?.fill === 'none');
  const g = shapeById(res, 'gradient');
  const gGradient = g?.gradient;
  check(
    'gradient keeps its state when fill is none',
    gGradient?.enabled === true && gGradient.startColor === '#444444'
  );
  check('line keeps its stroke', byId(res, 'ln') === undefined);
  check('text keeps its color', byId(res, 'tx') === undefined);
  check('brush keeps its color', byId(res, 'br') === undefined);
}

console.log('shape gradient change');
{
  const source = shape('src', {
    fill: '#111111',
    gradient: { enabled: true, type: 'linear', startColor: '#111111', endColor: '#222222', angle: 0 },
  });
  const updated = {
    ...source,
    gradient: { enabled: true, type: 'radial' as const, startColor: '#333333', endColor: '#444444', angle: 90 },
  };
  const plain = shape('plain', { fill: '#555555' });
  const gradient = shape('gradient', {
    fill: '#666666',
    gradient: { enabled: false, type: 'linear', startColor: '#666666', endColor: '#777777', angle: 10 },
  });
  const ln = line('ln', { stroke: '#888888' });
  const tx = text('tx', { color: '#999999' });
  const img = image('img', { borderColor: '#AAAAAA' });
  const res = propagateColorChange(source, updated, [plain, gradient, ln, tx, img]);

  check('only closed shapes change', res.length === 2);
  const g = shapeById(res, 'gradient');
  check('gradient is copied', JSON.stringify(g?.gradient) === JSON.stringify(updated.gradient));
  check('gradient object is a copy, not shared', g?.gradient !== updated.gradient);
  check('fill is copied with the gradient', g?.fill === '#111111');
  check(
    'line/text/image are untouched',
    byId(res, 'ln') === undefined && byId(res, 'tx') === undefined && byId(res, 'img') === undefined
  );
  check('plain shape gets the new fill too', shapeById(res, 'plain')?.fill === '#111111');

  const angleOnly = { ...source, gradient: { ...source.gradient!, angle: 180 } };
  const res2 = propagateColorChange(source, angleOnly, [plain]);
  const angleResult = shapeById(res2, 'plain');
  check('gradient angle-only edit counts as a gradient change', res2.length === 1 && angleResult?.gradient?.angle === 180);
}

console.log('shape fill + gradient change together');
{
  const source = shape('src', {
    fill: '#111111',
    gradient: { enabled: true, type: 'linear', startColor: '#111111', endColor: '#222222', angle: 0 },
  });
  const updated = {
    ...source,
    fill: '#ABCDEF',
    gradient: { enabled: true, type: 'radial' as const, startColor: '#ABCDEF', endColor: '#123456', angle: 45 },
  };
  const gradient = shape('gradient', {
    fill: '#333333',
    gradient: { enabled: true, type: 'linear', startColor: '#333333', endColor: '#444444', angle: 0 },
  });
  const res = propagateColorChange(source, updated, [gradient]);
  const g = shapeById(res, 'gradient');
  const gGradient = g?.gradient;
  check(
    'closed shape gets fill + full gradient',
    g?.fill === '#ABCDEF' && JSON.stringify(gGradient) === JSON.stringify(updated.gradient)
  );
}

console.log('shape stroke change');
{
  const source = shape('src', { stroke: '#000000' });
  const updated = { ...source, stroke: '#FF0000' };
  const closed = shape('closed', { stroke: '#111111' });
  const ln = line('ln', { stroke: '#222222' });
  const tx = text('tx', { color: '#333333' });
  const br = brush('br', { color: '#444444' });
  const img = image('img', { borderColor: '#555555' });
  const res = propagateColorChange(source, updated, [closed, ln, tx, br, img]);

  check(
    'all shapes take the new stroke',
    res.length === 2 && shapeById(res, 'closed')?.stroke === '#FF0000' && shapeById(res, 'ln')?.stroke === '#FF0000'
  );
  check('non-line source does not recolor text/brush', byId(res, 'tx') === undefined && byId(res, 'br') === undefined);
  check('image is untouched', byId(res, 'img') === undefined);
}

console.log('line stroke change');
{
  const source = line('src', { stroke: '#000000' });
  const updated = { ...source, stroke: '#00FF00' };
  const closed = shape('closed', { stroke: '#111111' });
  const ln = line('ln', { stroke: '#222222' });
  const tx = text('tx', { color: '#333333' });
  const br = brush('br', { color: '#444444' });
  const img = image('img', { borderColor: '#555555' });
  const res = propagateColorChange(source, updated, [closed, ln, tx, br, img]);

  check(
    'all shapes take the new line stroke',
    res.length === 4 && shapeById(res, 'closed')?.stroke === '#00FF00' && shapeById(res, 'ln')?.stroke === '#00FF00'
  );
  check(
    'text and brush take a line stroke as color',
    textById(res, 'tx')?.color === '#00FF00' && brushById(res, 'br')?.color === '#00FF00'
  );
  check('image is untouched', byId(res, 'img') === undefined);

  const toNone = { ...source, stroke: 'none' };
  const resNone = propagateColorChange(source, toNone, [closed, ln, tx, br]);
  check(
    'line stroke none still updates shapes',
    resNone.length === 2 && shapeById(resNone, 'closed')?.stroke === 'none' && shapeById(resNone, 'ln')?.stroke === 'none'
  );
  check(
    'line stroke none leaves text/brush alone',
    byId(resNone, 'tx') === undefined && byId(resNone, 'br') === undefined
  );
}

console.log('text/brush color change');
{
  const source = text('src', { color: '#111111' });
  const updated = { ...source, color: '#ABCDEF' };
  const tx = text('tx', { color: '#222222' });
  const br = brush('br', { color: '#333333' });
  const closed = shape('closed', { fill: '#444444' });
  const gradient = shape('gradient', {
    fill: '#555555',
    gradient: { enabled: true, type: 'linear', startColor: '#555555', endColor: '#666666', angle: 0 },
  });
  const noFill = shape('noFill', { fill: 'none', stroke: '#777777' });
  const ln = line('ln', { stroke: '#888888' });
  const img = image('img', { borderColor: '#999999' });
  const res = propagateColorChange(source, updated, [tx, br, closed, gradient, noFill, ln, img]);

  check('text/brush + closed shapes + line/fill-none change', res.length === 6);
  check('other text takes the color', textById(res, 'tx')?.color === '#ABCDEF');
  check('other brush takes the color', brushById(res, 'br')?.color === '#ABCDEF');
  check('filled shape takes the color as fill', shapeById(res, 'closed')?.fill === '#ABCDEF');
  const g = shapeById(res, 'gradient');
  const gGradient = g?.gradient;
  check(
    'gradient shape fill changes and gradient restarts',
    g?.fill === '#ABCDEF' && gGradient?.enabled === false && gGradient.startColor === '#ABCDEF' && gGradient.endColor === '#666666'
  );
  check('fill-none shape takes the color as stroke', shapeById(res, 'noFill')?.stroke === '#ABCDEF');
  check('line takes the color as stroke', shapeById(res, 'ln')?.stroke === '#ABCDEF');
  check('image is untouched', byId(res, 'img') === undefined);

  const brushSource = brush('bsrc', { color: '#111111' });
  const brushUpdated = { ...brushSource, color: '#123456' };
  const resBrush = propagateColorChange(brushSource, brushUpdated, [text('t2', { color: '#222222' })]);
  check('brush source recolors text', textById(resBrush, 't2')?.color === '#123456');
}

console.log('image borderColor change');
{
  const source = image('src', { borderColor: '#000000' });
  const updated = { ...source, borderColor: '#123456' };
  const img = image('img', { borderColor: '#111111' });
  const same = image('same', { borderColor: '#123456' });
  const closed = shape('closed');
  const tx = text('tx');
  const res = propagateColorChange(source, updated, [img, same, closed, tx]);

  check('only other images change', res.length === 1 && imageById(res, 'img')?.borderColor === '#123456');
  check('already-matching image is skipped', byId(res, 'same') === undefined);
  check('shapes/text are untouched', byId(res, 'closed') === undefined && byId(res, 'tx') === undefined);
}

console.log('identical results are skipped');
{
  const source = shape('src', { fill: '#111111' });
  const updated = { ...source, fill: '#ABCDEF' };
  const sameFill = shape('sameFill', { fill: '#ABCDEF' });
  const sameGradient = shape('sameGradient', {
    fill: '#ABCDEF',
    gradient: { enabled: false, type: 'linear', startColor: '#ABCDEF', endColor: '#999999', angle: 0 },
  });
  check('no-op fill propagation returns []', propagateColorChange(source, updated, [sameFill, sameGradient]).length === 0);

  const strokeUpdated = { ...source, stroke: '#FF0000' };
  const sameStroke = shape('sameStroke', { stroke: '#FF0000' });
  check('no-op stroke propagation returns []', propagateColorChange(source, strokeUpdated, [sameStroke]).length === 0);

  const tx = text('srcT', { color: '#111111' });
  const txUpdated = { ...tx, color: '#ABCDEF' };
  const sameText = text('sameText', { color: '#ABCDEF' });
  check('no-op text color propagation returns []', propagateColorChange(tx, txUpdated, [sameText]).length === 0);
}

console.log('line-shape classification');
{
  const source = shape('src', { fill: '#111111' });
  const updated = { ...source, fill: '#ABCDEF' };
  const variants: ShapeElement[] = ['line-arrow', 'line-arrow-both', 'polyline', 'arc'].map((t, i) =>
    line(`ln${i}`, { shapeType: t as ShapeElement['shapeType'], stroke: '#000000' })
  );
  const res = propagateColorChange(source, updated, variants);
  check(
    'all line shape types take fill as stroke',
    res.length === variants.length && variants.every((v) => shapeById(res, v.id)?.stroke === '#ABCDEF')
  );

  const gradientSource = shape('gsrc', {
    fill: '#111111',
    gradient: { enabled: true, type: 'linear', startColor: '#111111', endColor: '#222222', angle: 0 },
  });
  const gradientUpdated = { ...gradientSource, gradient: { ...gradientSource.gradient!, angle: 60 } };
  check('gradient change leaves line shapes untouched', propagateColorChange(gradientSource, gradientUpdated, variants).length === 0);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall multi-style checks passed');
