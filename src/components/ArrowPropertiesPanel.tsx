import React, { useState } from 'react';
import { ArrowType, ArrowSize, LineCap, ArrowConfig } from '../types';
import { X, CheckCheck } from 'lucide-react';

interface ArrowPropertiesPanelProps {
  /** Selected arrow begin config (null if no arrow selected) */
  beginArrow?: ArrowConfig;
  /** Selected arrow end config (null if no arrow selected) */
  endArrow?: ArrowConfig;
  /** Selected arrow stroke width */
  strokeWidth?: number;
  /** Selected arrow stroke color */
  strokeColor?: string;
  /** Selected arrow stroke dash */
  strokeDash?: 'solid' | 'dashed' | 'dotted';
  /** Selected arrow line cap */
  lineCap?: LineCap;
  /** Callback when properties change */
  onPropertiesChange: (props: {
    beginArrow?: ArrowConfig;
    endArrow?: ArrowConfig;
    strokeWidth?: number;
    strokeColor?: string;
    strokeDash?: 'solid' | 'dashed' | 'dotted';
    lineCap?: LineCap;
  }) => void;
  /** Callback to close panel */
  onClose: () => void;
  /** Is this for new arrow defaults (vs editing existing arrow) */
  isDefaults?: boolean;
  /** Save the current arrow style as the default for new arrows */
  onSaveAsDefault?: () => void;
}

const ARROW_TYPES: { value: ArrowType; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'triangle', label: '삼각형' },
  { value: 'open', label: '열린 V' },
  { value: 'stealth', label: '스텔스' },
  { value: 'oval', label: '원형' },
  { value: 'diamond', label: '마름모' },
];

const ARROW_SIZES: { value: ArrowSize; label: string }[] = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
];

const DASH_TYPES: { value: 'solid' | 'dashed' | 'dotted'; label: string }[] = [
  { value: 'solid', label: '실선' },
  { value: 'dashed', label: '파선' },
  { value: 'dotted', label: '점선' },
];

const LINE_CAPS: { value: LineCap; label: string }[] = [
  { value: 'flat', label: '평평' },
  { value: 'round', label: '둥글게' },
  { value: 'square', label: '사각' },
];

export const ArrowPropertiesPanel: React.FC<ArrowPropertiesPanelProps> = ({
  beginArrow = { type: 'none', size: 'medium' },
  endArrow = { type: 'triangle', size: 'medium' },
  strokeWidth = 2,
  strokeColor = '#000000',
  strokeDash = 'solid',
  lineCap = 'round',
  onPropertiesChange,
  onClose,
  isDefaults = false,
  onSaveAsDefault,
}) => {
  const handleBeginTypeChange = (type: ArrowType) => {
    onPropertiesChange({ beginArrow: { ...beginArrow, type } });
  };

  const handleBeginSizeChange = (size: ArrowSize) => {
    onPropertiesChange({ beginArrow: { ...beginArrow, size } });
  };

  const handleEndTypeChange = (type: ArrowType) => {
    onPropertiesChange({ endArrow: { ...endArrow, type } });
  };

  const handleEndSizeChange = (size: ArrowSize) => {
    onPropertiesChange({ endArrow: { ...endArrow, size } });
  };

  const handleStrokeWidthChange = (width: number) => {
    onPropertiesChange({ strokeWidth: width });
  };

  const handleStrokeColorChange = (color: string) => {
    onPropertiesChange({ strokeColor: color });
  };

  const handleStrokeDashChange = (dash: 'solid' | 'dashed' | 'dotted') => {
    onPropertiesChange({ strokeDash: dash });
  };

  const handleLineCapChange = (cap: LineCap) => {
    onPropertiesChange({ lineCap: cap });
  };

  const [savedAsDefault, setSavedAsDefault] = useState(false);
  const handleSaveAsDefault = () => {
    onSaveAsDefault?.();
    setSavedAsDefault(true);
    window.setTimeout(() => setSavedAsDefault(false), 1600);
  };

  return (
    <div className="fixed z-[70] top-28 right-[19rem] w-72 bg-stone-900/95 border border-stone-700 rounded-lg shadow-2xl overflow-hidden backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800 bg-stone-950/80">
        <h3 className="text-sm font-semibold text-stone-200">
          {isDefaults ? '화살표 기본값 설정' : '화살표 속성'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded text-stone-400 hover:text-white hover:bg-stone-800"
          title="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
        {/* Begin Arrow Head */}
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            시작 화살촉
          </label>
          <div className="space-y-2">
            <select
              value={beginArrow.type}
              onChange={(e) => handleBeginTypeChange(e.target.value as ArrowType)}
              className="w-full px-2 py-1.5 text-xs bg-stone-800 border border-stone-700 rounded text-stone-200 focus:outline-none focus:border-amber-500"
            >
              {ARROW_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {beginArrow.type !== 'none' && (
              <div className="flex gap-1">
                {ARROW_SIZES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => handleBeginSizeChange(s.value)}
                    className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                      beginArrow.size === s.value
                        ? 'bg-amber-500 text-stone-950 font-semibold'
                        : 'bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* End Arrow Head */}
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            끝 화살촉
          </label>
          <div className="space-y-2">
            <select
              value={endArrow.type}
              onChange={(e) => handleEndTypeChange(e.target.value as ArrowType)}
              className="w-full px-2 py-1.5 text-xs bg-stone-800 border border-stone-700 rounded text-stone-200 focus:outline-none focus:border-amber-500"
            >
              {ARROW_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {endArrow.type !== 'none' && (
              <div className="flex gap-1">
                {ARROW_SIZES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => handleEndSizeChange(s.value)}
                    className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                      endArrow.size === s.value
                        ? 'bg-amber-500 text-stone-950 font-semibold'
                        : 'bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Line Width */}
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            선 두께: {strokeWidth}px
          </label>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            value={strokeWidth}
            onChange={(e) => handleStrokeWidthChange(Number(e.target.value))}
            className="w-full h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
          />
        </div>

        {/* Line Color */}
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            선 색상
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => handleStrokeColorChange(e.target.value)}
              className="w-12 h-8 rounded border border-stone-700 cursor-pointer"
            />
            <input
              type="text"
              value={strokeColor}
              onChange={(e) => handleStrokeColorChange(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs bg-stone-800 border border-stone-700 rounded text-stone-200 font-mono focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Dash Type */}
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            선 스타일
          </label>
          <div className="flex gap-1">
            {DASH_TYPES.map((d) => (
              <button
                key={d.value}
                onClick={() => handleStrokeDashChange(d.value)}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                  strokeDash === d.value
                    ? 'bg-amber-500 text-stone-950 font-semibold'
                    : 'bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-200'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Line Cap */}
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            끝 모양
          </label>
          <div className="flex gap-1">
            {LINE_CAPS.map((c) => (
              <button
                key={c.value}
                onClick={() => handleLineCapChange(c.value)}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                  lineCap === c.value
                    ? 'bg-amber-500 text-stone-950 font-semibold'
                    : 'bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Save current style as default */}
        {onSaveAsDefault && (
          <button
            type="button"
            onClick={handleSaveAsDefault}
            className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] rounded border transition-colors ${
              savedAsDefault
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700 hover:text-white'
            }`}
            title="다음에 그리는 화살표에 이 스타일을 적용합니다"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>{savedAsDefault ? '기본값으로 저장됨' : '이 스타일을 기본값으로 저장'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
