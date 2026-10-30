import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDown, Pipette } from 'lucide-react';
import {
  COLOR_WHEEL_CELLS,
  HSV,
  RGB,
  WHEEL_INNER_R,
  WHEEL_OUTER_R,
  hslToRgb,
  hsvFromRgbKeepingHue,
  hsvToRgb,
  parseHex,
  rgbToHex,
  rgbToHsl,
} from '../utils/colorPicker';

type FieldMode = 'rgb' | 'hex' | 'hsl';
const FIELD_MODES: FieldMode[] = ['rgb', 'hex', 'hsl'];
const POPOVER_WIDTH = 236;
const VIEWPORT_MARGIN = 8;

interface EyeDropperResult {
  sRGBHex: string;
}
type EyeDropperCtor = new () => { open: () => Promise<EyeDropperResult> };

function getEyeDropper(): EyeDropperCtor | null {
  const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof ctor === 'function' ? ctor : null;
}

function fieldValues(rgb: RGB, mode: FieldMode): string[] {
  if (mode === 'hex') return [rgbToHex(rgb)];
  if (mode === 'hsl') {
    const [h, s, l] = rgbToHsl(...rgb);
    return [String(h), `${s}%`, `${l}%`];
  }
  return rgb.map((v) => String(Math.round(v)));
}

const FIELD_LABELS: Record<FieldMode, string[]> = {
  rgb: ['R', 'G', 'B'],
  hex: ['HEX'],
  hsl: ['H', 'S', 'L'],
};

interface ColorPickerPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  color: string;
  /** transient = live drag update (no history entry); the final value comes with transient false. */
  onChange: (color: string, transient?: boolean) => void;
  onClose: () => void;
}

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({ anchorRef, color, onChange, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = useState<HSV>(() => hsvFromRgbKeepingHue(parseHex(color) ?? [0, 0, 0], [0, 1, 1]));
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const [mode, setMode] = useState<FieldMode>('rgb');
  const [drafts, setDrafts] = useState<string[]>([]);
  const editingRef = useRef(false);
  const [hoverHex, setHoverHex] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const EyeDropper = getEyeDropper();

  const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
  const hex = rgbToHex(rgb);

  // Follow outside changes (selection, K palette, eyedropper tool) without losing the hue
  useEffect(() => {
    const ext = parseHex(color);
    if (!ext || rgbToHex(ext) === rgbToHex(hsvToRgb(hsvRef.current[0], hsvRef.current[1], hsvRef.current[2]))) return;
    setHsv(hsvFromRgbKeepingHue(ext, hsvRef.current));
  }, [color]);

  useEffect(() => {
    if (!editingRef.current) setDrafts(fieldValues(hsvToRgb(hsv[0], hsv[1], hsv[2]), mode));
  }, [hsv, mode]);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
    const top = r.bottom + 6;
    setPos({
      left: Math.max(VIEWPORT_MARGIN, Math.min(r.right - POPOVER_WIDTH, maxLeft)),
      top,
      maxHeight: Math.max(160, window.innerHeight - top - VIEWPORT_MARGIN),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [place]);

  // Close on outside press / Esc (capture so the canvas doesn't also react to Esc)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchorRef, onClose]);

  const apply = (next: HSV, transient = false) => {
    hsvRef.current = next;
    setHsv(next);
    onChange(rgbToHex(hsvToRgb(next[0], next[1], next[2])), transient);
  };

  const applyRgb = (next: RGB) => apply(hsvFromRgbKeepingHue(next, hsvRef.current));

  /** Pointer drag on the SV square / hue bar: live updates, one history entry on release. */
  const startDrag = (e: React.PointerEvent<HTMLDivElement>, toHsv: (x: number, y: number) => HSV) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const update = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      apply(toHsv(x, y), true);
    };
    update(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      apply(hsvRef.current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const commitFields = (values: string[]) => {
    const current = fieldValues(rgb, mode);
    if (values.every((v, i) => v.trim() === current[i])) return;
    if (mode === 'hex') {
      const parsed = parseHex(values[0] ?? '');
      if (parsed) applyRgb(parsed);
      else setDrafts(fieldValues(rgb, mode));
      return;
    }
    const nums = values.map((v) => parseFloat(v));
    if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) {
      setDrafts(fieldValues(rgb, mode));
      return;
    }
    if (mode === 'rgb') applyRgb(nums.map((n) => Math.min(255, Math.max(0, n))) as RGB);
    else applyRgb(hslToRgb(((nums[0] % 360) + 360) % 360, nums[1], nums[2]));
  };

  const handleEyeDropper = async () => {
    if (!EyeDropper) return;
    try {
      const { sRGBHex } = await new EyeDropper().open();
      const parsed = parseHex(sRGBHex);
      if (parsed) applyRgb(parsed);
    } catch {
      // Cancelled with Esc
    }
  };

  if (!pos) return null;
  const pureHue = rgbToHex(hsvToRgb(hsv[0], 1, 1));
  const labels = FIELD_LABELS[mode];

  return createPortal(
    <div
      ref={panelRef}
      id="color-picker-popover"
      role="dialog"
      aria-label="색상 선택"
      className="fixed z-[60] bg-stone-900 border border-stone-700 rounded-lg shadow-2xl overflow-x-hidden overflow-y-auto select-none"
      style={{ left: pos.left, top: pos.top, width: POPOVER_WIDTH, maxHeight: pos.maxHeight }}
    >
      {/* Saturation / value square */}
      <div
        id="color-picker-sv"
        className="relative h-[140px] cursor-crosshair touch-none"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})` }}
        onPointerDown={(e) => startDrag(e, (x, y) => [hsvRef.current[0], x, 1 - y])}
      >
        <div
          className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] pointer-events-none"
          style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, backgroundColor: hex }}
        />
      </div>

      <div className="p-2.5 space-y-2.5 border-b border-stone-800">
        <div className="flex items-center gap-2">
          {EyeDropper && (
            <button
              type="button"
              onClick={handleEyeDropper}
              className="w-6 h-6 shrink-0 grid place-items-center rounded-md border border-stone-700 bg-stone-800 text-stone-300 hover:text-amber-400 hover:border-amber-500 transition-colors"
              title="화면에서 색 추출 (스포이트)"
              aria-label="화면에서 색 추출"
            >
              <Pipette className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="w-6 h-6 shrink-0 rounded-full border-2 border-stone-600" style={{ backgroundColor: hex }} />
          <div
            id="color-picker-hue"
            className="relative flex-1 h-3 rounded-full cursor-pointer touch-none"
            style={{ background: 'linear-gradient(90deg,#f00,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00)' }}
            onPointerDown={(e) => startDrag(e, (x) => [Math.min(x * 360, 359.9), hsvRef.current[1], hsvRef.current[2]])}
          >
            <div
              className="absolute top-1/2 w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] pointer-events-none"
              style={{ left: `${(hsv[0] / 360) * 100}%`, backgroundColor: pureHue }}
            />
          </div>
        </div>

        <div className="flex items-start gap-1.5">
          {labels.map((label, i) => (
            <label key={`${mode}-${label}`} className="flex-1 min-w-0 text-center">
              <input
                type="text"
                value={drafts[i] ?? ''}
                spellCheck={false}
                aria-label={label}
                onFocus={(e) => {
                  editingRef.current = true;
                  e.currentTarget.select();
                }}
                onChange={(e) => {
                  const next = [...drafts];
                  next[i] = e.target.value;
                  setDrafts(next);
                }}
                onBlur={() => {
                  editingRef.current = false;
                  commitFields(drafts);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="w-full bg-stone-800 border border-stone-700 rounded px-1 py-1 text-center font-mono text-[11px] text-stone-100 focus:border-amber-500 focus:outline-none"
              />
              <span className="block text-[10px] text-stone-500 mt-0.5">{label}</span>
            </label>
          ))}
          <button
            type="button"
            onClick={() => setMode(FIELD_MODES[(FIELD_MODES.indexOf(mode) + 1) % FIELD_MODES.length])}
            className="w-5 h-[26px] shrink-0 grid place-items-center rounded text-stone-400 hover:text-amber-400 hover:bg-stone-800"
            title="입력 형식 전환 (RGB / HEX / HSL)"
            aria-label="입력 형식 전환"
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Color wheel */}
      <div className="flex items-center justify-between px-2.5 pt-2 text-[10px] text-stone-400">
        <span>색상환</span>
        <span className="font-mono text-stone-300">{hoverHex ?? ''}</span>
      </div>
      <svg
        id="color-picker-wheel"
        viewBox={`${-WHEEL_OUTER_R - 2} ${-WHEEL_OUTER_R - 2} ${(WHEEL_OUTER_R + 2) * 2} ${(WHEEL_OUTER_R + 2) * 2}`}
        className="block w-full h-auto px-3.5 pt-1.5 pb-2.5"
        role="group"
        aria-label="색상환"
        onMouseLeave={() => setHoverHex(null)}
      >
        {COLOR_WHEEL_CELLS.map((cell) => (
          <path
            key={cell.d}
            d={cell.d}
            fill={cell.hex}
            data-color={cell.hex}
            className="cursor-pointer hover:stroke-white"
            strokeWidth={1.4}
            onMouseEnter={() => setHoverHex(cell.hex)}
            onClick={() => applyRgb(parseHex(cell.hex)!)}
          >
            <title>{cell.hex}</title>
          </path>
        ))}
        {/* Selected cell drawn last so its outline isn't covered by neighbours */}
        {COLOR_WHEEL_CELLS.filter((cell) => cell.hex === hex).map((cell) => (
          <path key="selected" d={cell.d} fill="none" stroke="#fbbf24" strokeWidth={2.2} pointerEvents="none" />
        ))}
        <circle
          r={WHEEL_INNER_R}
          fill="#000"
          data-color="#000000"
          className="cursor-pointer"
          stroke={hex === '#000000' ? '#fbbf24' : 'none'}
          strokeWidth={2.2}
          onMouseEnter={() => setHoverHex('#000000')}
          onClick={() => applyRgb([0, 0, 0])}
        >
          <title>#000000</title>
        </circle>
      </svg>

      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-stone-700 bg-stone-950/80">
        <div className="w-[18px] h-[18px] rounded border border-stone-600 shrink-0" style={{ backgroundColor: hex }} />
        <span id="color-picker-hex" className="font-mono text-[11px] text-amber-300 tracking-wide">
          {hex}
        </span>
        <span className="ml-auto text-[9px] text-stone-500">Esc 닫기</span>
      </div>
    </div>,
    document.body
  );
};
