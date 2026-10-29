import React, { useEffect, useState } from 'react';
import { X, FilePlus2 } from 'lucide-react';
import { CanvasConfig } from '../types';
import { ModalDialog } from './ModalDialog';

interface NewCanvasModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (config: { width: number; height: number; backgroundColor: string }) => void;
  currentConfig: CanvasConfig;
}

const PRESETS = [
  { name: 'FHD 와이드 (16:9)', width: 1920, height: 1080, desc: '표준 프레젠테이션 & 유튜브 썸네일' },
  { name: 'HD 해상도 (16:9)', width: 1280, height: 720, desc: '슬라이드 및 웹 배너' },
  { name: '인스타그램 정사각형 (1:1)', width: 1080, height: 1080, desc: 'SNS 피드 & 카드뉴스' },
  { name: '고전 그림판 (4:3)', width: 800, height: 600, desc: '레트로 픽셀 및 간단한 드로잉' },
  { name: 'A4 문서 세로', width: 794, height: 1123, desc: '인쇄 및 보고서 삽화' },
  { name: '트위터 / 웹 헤더', width: 1200, height: 630, desc: '블로그 및 SNS 공유 카드' },
];

function parseCanvasSize(raw: string, fallback = 100): number {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(4000, parsed);
}

export const NewCanvasModal: React.FC<NewCanvasModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  currentConfig,
}) => {
  const [widthText, setWidthText] = useState(String(currentConfig.width));
  const [heightText, setHeightText] = useState(String(currentConfig.height));
  const [bg, setBg] = useState(currentConfig.backgroundColor || '#FFFFFF');

  useEffect(() => {
    if (!isOpen) return;
    setWidthText(String(currentConfig.width));
    setHeightText(String(currentConfig.height));
    setBg(currentConfig.backgroundColor || '#FFFFFF');
  }, [isOpen, currentConfig.width, currentConfig.height, currentConfig.backgroundColor]);

  if (!isOpen) return null;

  const widthNum = parseInt(widthText, 10);
  const heightNum = parseInt(heightText, 10);

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="new-canvas-dialog-title"
      panelClassName="bg-stone-900 border border-stone-700 rounded-xl shadow-2xl max-w-lg w-full p-6 text-stone-200 select-none"
    >
        <div className="flex items-center justify-between pb-3 border-b border-stone-800">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
              <FilePlus2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="new-canvas-dialog-title" className="text-base font-semibold text-stone-100">새 캔버스 생성</h2>
              <p className="text-xs text-stone-400">원하는 크기와 배경색을 선택하세요</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 space-y-4 text-xs">
          {/* Presets */}
          <div>
            <label className="text-stone-300 font-medium block mb-2">규격 프리셋</label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setWidthText(String(p.width));
                    setHeightText(String(p.height));
                  }}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    widthNum === p.width && heightNum === p.height
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300 font-medium'
                      : 'border-stone-800 hover:border-stone-700 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  <div className="font-semibold text-xs text-stone-200">{p.name}</div>
                  <div className="text-[10px] text-stone-500 mt-0.5">{p.width} × {p.height} px</div>
                  <div className="text-[10px] text-stone-400 mt-1 truncate">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom dimensions */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-stone-800">
            <div>
              <span className="text-[11px] text-stone-400 block mb-1">가로 너비 (px)</span>
              <input
                type="number"
                min="1"
                max="4000"
                value={widthText}
                onChange={(e) => setWidthText(e.target.value)}
                onBlur={() => setWidthText(String(parseCanvasSize(widthText)))}
                className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 font-mono text-xs"
              />
            </div>
            <div>
              <span className="text-[11px] text-stone-400 block mb-1">세로 높이 (px)</span>
              <input
                type="number"
                min="1"
                max="4000"
                value={heightText}
                onChange={(e) => setHeightText(e.target.value)}
                onBlur={() => setHeightText(String(parseCanvasSize(heightText)))}
                className="w-full bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 font-mono text-xs"
              />
            </div>
          </div>

          {/* Background color */}
          <div className="flex items-center justify-between pt-2 border-t border-stone-800">
            <span className="text-stone-300 font-medium">배경 색상</span>
            <div className="flex items-center space-x-2">
              <input
                type="color"
                value={bg === 'transparent' ? '#ffffff' : bg}
                onChange={(e) => setBg(e.target.value)}
                className="w-7 h-7 rounded border border-stone-700 bg-transparent cursor-pointer"
              />
              <div className="flex space-x-1">
                <button
                  type="button"
                  onClick={() => setBg('#FFFFFF')}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    bg === '#FFFFFF' ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                  }`}
                >
                  흰색
                </button>
                <button
                  type="button"
                  onClick={() => setBg('#18181B')}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    bg === '#18181B' ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                  }`}
                >
                  다크
                </button>
                <button
                  type="button"
                  onClick={() => setBg('transparent')}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    bg === 'transparent' ? 'border-amber-500 text-amber-300' : 'border-stone-800 text-stone-400'
                  }`}
                >
                  투명
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-2 pt-4 border-t border-stone-800">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-stone-400 hover:text-white"
          >
            취소
          </button>
          <button
            onClick={() => {
              onCreate({
                width: parseCanvasSize(widthText),
                height: parseCanvasSize(heightText),
                backgroundColor: bg,
              });
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
          >
            캔버스 생성
          </button>
        </div>
    </ModalDialog>
  );
};
