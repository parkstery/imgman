import React, { useState, useEffect } from 'react';
import {
  Layer,
  CanvasElement,
  CanvasConfig,
} from '../types';
import {
  generateSVGString,
  generateSVGStringAsync,
  downloadSVGFile,
  SVGExportOptions,
  analyzeSVGSize,
  type RasterHandling,
} from '../utils/svgExport';
import { VectorizeError } from '../utils/rasterVectorizer';
import { getExportVisibleImageElements } from '../utils/svgExportImages';
import { exportToRaster, downloadDataUrl } from '../utils/rasterExport';
import { X, Download, FileCode, Image as ImageIcon, Sparkles, Settings, AlertTriangle, CheckCheck } from 'lucide-react';

/** Export basename: im-YYMMDD-HHMMSS (e.g. im-261005-064530) */
function makeExportFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = pad(date.getFullYear() % 100);
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `im-${yy}${mm}${dd}-${hh}${mi}${ss}`;
}

/** Human-readable byte size (B / KB / MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Approximate byte size of a data URL (base64 → ~0.75 bytes per char). */
function estimateBytesFromDataUrl(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return 0;
  return Math.round((dataUrl.length - commaIdx - 1) * 0.75);
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  layers: Layer[];
  elements: CanvasElement[];
  config: CanvasConfig;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  layers,
  elements,
  config,
}) => {
  const [format, setFormat] = useState<'svg' | 'png' | 'jpeg' | 'webp'>('png');
  const [scale, setScale] = useState<number>(1);
  const [transparent, setTransparent] = useState<boolean>(false);
  const [qualityPct, setQualityPct] = useState<number>(80);
  const [filename, setFilename] = useState<string>(() => makeExportFilename());
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const [svgAnalysisBusy, setSvgAnalysisBusy] = useState(false);

  const [svgOptions, setSvgOptions] = useState<SVGExportOptions>({
    rasterHandling: 'preserve',
    precision: 1,
    simplifyTolerance: 1.2,
    brushSampleDistance: 2,
    includeMetadata: false,
  });
  const [svgAnalysis, setSvgAnalysis] = useState<{ total: number; byType: Record<string, number> } | null>(null);

  const imageElementCount = getExportVisibleImageElements(layers, elements).length;

  // Reset format + timestamped filename whenever the export dialog opens
  useEffect(() => {
    if (isOpen) {
      setFormat('png');
      setQualityPct(80);
      setFilename(makeExportFilename());
      setExportError(null);
      setExportStatus(null);
      setSvgAnalysis(null);
      setSvgAnalysisBusy(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setExportError(null);
    setExportStatus(null);
    setSvgAnalysis(null);
  }, [isOpen, format, transparent, svgOptions, layers, elements, config]);

  // Generate a live preview when modal opens or settings change (debounced —
  // the preview renders at the real export scale so its byte size doubles as
  // a true capacity estimate).
  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    const timer = setTimeout(async () => {
      try {
        const url = await exportToRaster(
          layers,
          elements,
          config,
          format === 'svg' ? 'png' : format,
          scale,
          transparent,
          qualityPct / 100
        );
        if (!isCancelled) {
          setPreviewUrl(url);
        }
      } catch (err) {
        console.error('Preview error:', err);
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, layers, elements, config, transparent, format, scale, qualityPct]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    setIsGenerating(true);
    setExportError(null);
    setExportStatus(null);
    try {
      const baseName = filename.trim() || makeExportFilename();
      if (format === 'svg') {
        const svgOpts = { ...svgOptions, transparentBackground: transparent };
        if (svgOpts.rasterHandling === 'vectorize') {
          setExportStatus('이미지 벡터화 중…');
          const { svg, report } = await generateSVGStringAsync(layers, elements, config, svgOpts);
          downloadSVGFile(svg, `${baseName}.svg`);
          setExportStatus(
            `벡터화 완료: 이미지 ${report.vectorizedImageCount}장, path ${report.pathCount}개` +
              (report.warnings.length ? ` · 경고 ${report.warnings.length}건` : '')
          );
        } else {
          const svgStr = generateSVGString(layers, elements, config, svgOpts);
          downloadSVGFile(svgStr, `${baseName}.svg`);
        }
      } else {
        const dataUrl = await exportToRaster(
          layers,
          elements,
          config,
          format,
          scale,
          transparent,
          qualityPct / 100
        );
        downloadDataUrl(dataUrl, `${baseName}.${format}`);
      }
      onClose();
    } catch (err) {
      console.error('Export error:', err);
      const msg =
        err instanceof VectorizeError
          ? err.message
          : err instanceof Error
            ? err.message
            : '보내기에 실패했습니다.';
      setExportError(msg);
    } finally {
      setIsGenerating(false);
      setExportStatus(null);
    }
  };

  const outputWidth = config.width * scale;
  const outputHeight = config.height * scale;
  const isLossy = format === 'jpeg' || format === 'webp';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 border border-stone-700 rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 text-stone-200 select-none">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-stone-800">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-100">그래픽 내보내기 (Export)</h2>
              <p className="text-xs text-stone-400">벡터 SVG 및 고해상도 이미지 포맷 지원</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-5">
          {/* Left: Format & Settings */}
          <div className="space-y-4 text-xs">
            {/* Format Picker */}
            <div>
              <label className="text-stone-300 font-medium block mb-2">포맷 선택</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setFormat('png')}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    format === 'png'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300 font-bold ring-1 ring-amber-500/40'
                      : 'border-stone-800 hover:border-stone-700 text-stone-400'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
                  <span>PNG (비트맵)</span>
                </button>

                <button
                  onClick={() => setFormat('jpeg')}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    format === 'jpeg'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300 font-bold ring-1 ring-amber-500/40'
                      : 'border-stone-800 hover:border-stone-700 text-stone-400'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                  <span>JPEG (사진)</span>
                </button>

                <button
                  onClick={() => setFormat('webp')}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    format === 'webp'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300 font-bold ring-1 ring-amber-500/40'
                      : 'border-stone-800 hover:border-stone-700 text-stone-400'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 mx-auto mb-1 text-violet-400" />
                  <span>WebP (고압축)</span>
                </button>

                <button
                  onClick={() => setFormat('svg')}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    format === 'svg'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300 font-bold ring-1 ring-amber-500/40'
                      : 'border-stone-800 hover:border-stone-700 text-stone-400'
                  }`}
                >
                  <FileCode className="w-4 h-4 mx-auto mb-1 text-amber-400" />
                  <span>SVG (벡터)</span>
                </button>
              </div>
            </div>

            {/* Compression Quality (JPEG / WebP only) */}
            {isLossy && (
              <div>
                <label className="text-stone-300 font-medium block mb-1">
                  압축 품질 <span className="text-amber-400 font-semibold">{qualityPct}%</span>
                </label>
                <input
                  id="export-quality-range"
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={qualityPct}
                  onChange={(e) => setQualityPct(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <p className="text-[10px] text-stone-500 mt-1">
                  낮을수록 파일이 작아지고 화질이 떨어집니다. 스크린샷·공유용은 70~85% 권장.
                </p>
              </div>
            )}

            {/* Resolution Scale (for PNG/JPEG) */}
            {format !== 'svg' && (
              <div>
                <label className="text-stone-300 font-medium block mb-1">해상도 배율</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: '1x (표준)', val: 1 },
                    { label: '2x (고화질)', val: 2 },
                    { label: '3x (인쇄용)', val: 3 },
                  ].map((s) => (
                    <button
                      key={s.val}
                      onClick={() => setScale(s.val)}
                      className={`py-1.5 px-2 rounded border text-center text-[11px] ${
                        scale === s.val
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300 font-medium'
                          : 'border-stone-800 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-stone-500 mt-1">
                  출력 해상도: {outputWidth} × {outputHeight} px
                </p>
              </div>
            )}

            {/* Transparent background toggle */}
            {format !== 'jpeg' && (
              <div className="flex items-center space-x-2 pt-1">
                <input
                  id="chk-transparent"
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                  className="rounded border-stone-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="chk-transparent" className="text-stone-300 cursor-pointer">
                  배경 투명하게 내보내기 (Transparent)
                </label>
              </div>
            )}

            {/* File Name */}
            <div>
              <label className="text-stone-300 font-medium block mb-1">파일명</label>
              <div className="flex items-center space-x-1.5">
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="flex-1 bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-stone-100 focus:border-amber-500 text-xs"
                />
                <span className="text-stone-400 font-mono text-xs">.{format}</span>
              </div>
            </div>

            {/* Format Info callout */}
            <div className="p-2.5 rounded bg-stone-800/60 border border-stone-700/60 text-[11px] text-stone-400">
              {format === 'svg' && (
                <p className="flex items-start space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    {imageElementCount === 0
                      ? '도형·텍스트·브러시만 있어 순수 벡터 SVG로보낼 수 있습니다.'
                      : svgOptions.rasterHandling === 'vectorize'
                        ? '삽입 이미지를 path로 변환해 순수 벡터 SVG를 만듭니다(실패 시 다운로드가 중단됩니다).'
                        : svgOptions.rasterHandling === 'skip'
                          ? '삽입 이미지는 제외되고 나머지만 벡터로보냅니다.'
                          : `원본 유지: 삽입 이미지 ${imageElementCount}개를 <image href>로 넣습니다(data URL은 파일에 포함, http(s)는 링크).`}
                  </span>
                </p>
              )}

              {/* SVG Export Options (Advanced) */}
              {format === 'svg' && (
                <div className="space-y-3 pt-2 border-t border-stone-800">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-300 font-medium flex items-center space-x-1.5">
                      <Settings className="w-3.5 h-3.5 text-amber-400" />
                      <span>SVG 고급 옵션</span>
                    </span>
                    <span className="text-[10px] text-stone-500">경량화된 표준 SVG 출력</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Image Mode */}
                    <div className="space-y-1 col-span-2">
                      <label className="text-[11px] text-stone-400 block">이미지 처리</label>
                      <select
                        value={svgOptions.rasterHandling ?? 'preserve'}
                        onChange={(e) =>
                          setSvgOptions({
                            ...svgOptions,
                            rasterHandling: e.target.value as RasterHandling,
                          })
                        }
                        className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 text-xs focus:border-amber-500"
                      >
                        <option value="preserve">원본 유지 (혼합 SVG)</option>
                        <option value="vectorize">벡터화 (순수 벡터)</option>
                        <option value="skip">이미지 제외</option>
                      </select>
                    </div>

                    {/* Precision */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-stone-400 block">좌표 정밀도</label>
                      <select
                        value={svgOptions.precision}
                        onChange={(e) => setSvgOptions({ ...svgOptions, precision: Number(e.target.value) })}
                        className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 text-xs focus:border-amber-500"
                      >
                        <option value={0}>정수 (최소 용량)</option>
                        <option value={1}>소수점 1자리 (기본)</option>
                        <option value={2}>소수점 2자리</option>
                        <option value={3}>소수점 3자리</option>
                      </select>
                    </div>

                    {/* Simplify Tolerance */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-stone-400 block">패스 단순화 허용오차</label>
                      <select
                        value={svgOptions.simplifyTolerance}
                        onChange={(e) => setSvgOptions({ ...svgOptions, simplifyTolerance: Number(e.target.value) })}
                        className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 text-xs focus:border-amber-500"
                      >
                        <option value={0.5}>0.5px (최대 단순화)</option>
                        <option value={1.0}>1.0px</option>
                        <option value={1.2}>1.2px (기본)</option>
                        <option value={2.0}>2.0px</option>
                        <option value={0}>비활성화</option>
                      </select>
                    </div>

                    {/* Brush Sample Distance */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-stone-400 block">브러시 샘플 간격</label>
                      <select
                        value={svgOptions.brushSampleDistance}
                        onChange={(e) => setSvgOptions({ ...svgOptions, brushSampleDistance: Number(e.target.value) })}
                        className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 text-xs focus:border-amber-500"
                      >
                        <option value={1}>1px (고정밀)</option>
                        <option value={2}>2px (기본)</option>
                        <option value={3}>3px</option>
                        <option value={5}>5px (최대 압축)</option>
                      </select>
                    </div>

                    {/* Include Metadata */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-stone-400 block">메타데이터</label>
                      <select
                        value={svgOptions.includeMetadata ? 'true' : 'false'}
                        onChange={(e) => setSvgOptions({ ...svgOptions, includeMetadata: e.target.value === 'true' })}
                        className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-stone-100 text-xs focus:border-amber-500"
                      >
                        <option value="false">제외 (기본)</option>
                        <option value="true">포함</option>
                      </select>
                    </div>

                  </div>

                  {/* SVG Size Analysis */}
                  <button
                    type="button"
                    disabled={svgAnalysisBusy}
                    onClick={async () => {
                      if (svgAnalysisBusy) return;
                      setSvgAnalysisBusy(true);
                      setExportError(null);
                      try {
                        const opts = { ...svgOptions, transparentBackground: transparent };
                        if (opts.rasterHandling === 'vectorize') {
                          const { svg } = await generateSVGStringAsync(layers, elements, config, opts);
                          setSvgAnalysis(analyzeSVGSize(svg));
                        } else {
                          const svgStr = generateSVGString(layers, elements, config, opts);
                          setSvgAnalysis(analyzeSVGSize(svgStr));
                        }
                      } catch (e) {
                        setExportError(e instanceof Error ? e.message : '분석 실패');
                      } finally {
                        setSvgAnalysisBusy(false);
                      }
                    }}
                    className="w-full px-3 py-1.5 rounded border border-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700 text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>{svgAnalysisBusy ? '분석 중…' : 'SVG 용량 분석 실행'}</span>
                  </button>

                  {svgAnalysis && (
                    <div className="p-2 bg-stone-800/60 border border-stone-700 rounded text-[10px] text-stone-400 font-mono">
                      <div className="flex items-center space-x-1.5 mb-1">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        <span className="font-semibold text-amber-300">예상 SVG 크기:</span>
                        <span className="text-amber-400">{formatBytes(svgAnalysis.total)}</span>
                      </div>
                      <div className="text-right text-stone-500">
                        주요 태그:{' '}
                        {Object.entries(svgAnalysis.byType)
                          .sort(([, a], [, b]) => (b as number) - (a as number))
                          .slice(0, 5)
                          .map(([k, v]) => `<${k}>:${formatBytes(v as number)}`)
                          .join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {format === 'png' && (
                <p>무손실 압축 포맷으로 투명 배경을 지원하며 그래픽, 로고, 아이콘에 적합합니다. 사진 성격의 캔버스라면 JPEG/WebP가 훨씬 작습니다.</p>
              )}
              {format === 'jpeg' && (
                <p>사진 및 배경이 포함된 이미지에 최적화된 고압축 래스터 포맷입니다. 품질 슬라이더로 용량을 조절하세요.</p>
              )}
              {format === 'webp' && (
                <p>같은 화질에서 PNG 대비 수십~수십 분의 1 작은 고압축 포맷입니다. 투명 배경도 지원하며, 최신 앱·브라우저에서 호환됩니다.</p>
              )}
            </div>
          </div>

          {/* Right: Preview */}
          <div className="flex flex-col items-center justify-center bg-stone-950/80 rounded-lg p-3 border border-stone-800">
            <span className="text-[11px] text-stone-400 mb-2 font-medium">내보내기 미리보기</span>
            <div
              className={`w-full h-44 rounded border border-stone-800 flex items-center justify-center overflow-hidden ${
                transparent ? 'bg-[radial-gradient(#374151_1px,transparent_1px)] [background-size:8px_8px]' : 'bg-white'
              }`}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Export preview"
                  className="max-w-full max-h-full object-contain shadow-sm"
                />
              ) : (
                <span className="text-stone-500 text-xs">미리보기 로딩 중...</span>
              )}
            </div>
            <span className="text-[10px] text-stone-500 mt-2 font-mono">
              {config.width} × {config.height} px ({layers.length}개 레이어, {elements.length}개 개체)
            </span>
            {format !== 'svg' && previewUrl && (
              <span className="text-[11px] text-amber-400/90 font-mono mt-1">
                예상 파일 크기: {formatBytes(estimateBytesFromDataUrl(previewUrl))}
              </span>
            )}
          </div>
        </div>

        {(exportError || exportStatus) && (
          <div
            className={`text-xs px-3 py-2 rounded border ${
              exportError
                ? 'border-red-800/80 bg-red-950/40 text-red-200'
                : 'border-amber-800/60 bg-amber-950/30 text-amber-200'
            }`}
          >
            {exportError ?? exportStatus}
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-end space-x-2 pt-4 border-t border-stone-800">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            취소
          </button>
          <button
            id="btn-confirm-export"
            disabled={isGenerating}
            onClick={handleDownload}
            className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {isGenerating
                ? svgOptions.rasterHandling === 'vectorize' && format === 'svg'
                  ? '벡터화 중...'
                  : '생성 중...'
                : '파일 다운로드'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
