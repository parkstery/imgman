import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff, Save, Trash2 } from 'lucide-react';
import { HistorySnapshot } from '../types';
import { describeHistoryStep } from '../utils/historyLabels';
import { formatSavedAt } from '../utils/autosave';

interface HistoryPanelProps {
  snapshots: HistorySnapshot[];
  index: number;
  onJump: (index: number) => void;
  autosaveEnabled: boolean;
  autosaveSavedAt: number | null;
  autosaveError: string | null;
  onToggleAutosave: (enabled: boolean) => void;
  onClearAutosave: () => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  snapshots,
  index,
  onJump,
  autosaveEnabled,
  autosaveSavedAt,
  autosaveError,
  onToggleAutosave,
  onClearAutosave,
}) => {
  const labels = useMemo(
    () =>
      snapshots.map((snap, i) => (i === 0 ? '기록 시작' : describeHistoryStep(snapshots[i - 1], snap))),
    [snapshots]
  );
  const currentRef = useRef<HTMLButtonElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index, snapshots.length]);

  // Refresh the "n분 전" label
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-1.5 border-b border-stone-800 text-[10px] text-stone-500 shrink-0">
        항목을 클릭하면 그 단계로 돌아갑니다. 최근 {snapshots.length}단계 보관.
      </div>
      <ol className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="작업 내역">
        {labels.map((label, i) => {
          const isCurrent = i === index;
          const isFuture = i > index;
          return (
            <li key={i}>
              <button
                ref={isCurrent ? currentRef : undefined}
                type="button"
                onClick={() => onJump(i)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors ${
                  isCurrent
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/50'
                    : isFuture
                      ? 'text-stone-500 hover:bg-stone-800 border border-transparent italic'
                      : 'text-stone-300 hover:bg-stone-800 border border-transparent'
                }`}
                title={isFuture ? '다시 실행할 수 있는 단계' : undefined}
              >
                <span className="w-5 text-right font-mono text-[10px] text-stone-500 shrink-0">{i}</span>
                <span className="truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="p-3 border-t border-stone-800 space-y-1.5 bg-stone-900/90 shrink-0">
        <label className="flex items-center justify-between text-[11px] text-stone-300">
          <span className="flex items-center gap-1.5">
            {autosaveEnabled ? <Save className="w-3.5 h-3.5 text-emerald-400" /> : <CloudOff className="w-3.5 h-3.5 text-stone-500" />}
            브라우저 자동 저장
          </span>
          <input
            type="checkbox"
            checked={autosaveEnabled}
            onChange={(e) => onToggleAutosave(e.target.checked)}
            className="accent-amber-500"
          />
        </label>
        <div className="flex items-center justify-between text-[10px] text-stone-500">
          <span>
            {autosaveError
              ? <span className="text-rose-400">{autosaveError}</span>
              : !autosaveEnabled
                ? '꺼짐 — 탭을 닫으면 작업이 사라집니다'
                : autosaveSavedAt
                  ? `마지막 저장: ${formatSavedAt(autosaveSavedAt)}`
                  : '변경하면 자동으로 저장합니다'}
          </span>
          <button
            type="button"
            onClick={onClearAutosave}
            className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-300 transition-colors"
            title="브라우저에 저장된 자동 저장본 삭제"
            aria-label="자동 저장본 삭제"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
