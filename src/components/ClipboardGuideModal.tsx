import React, { useRef, useEffect, useState } from 'react';
import {
  X,
  Clipboard,
  ExternalLink,
  Keyboard,
  MousePointerClick,
  UploadCloud,
  Info,
  CheckCircle2,
  FolderOpen,
} from 'lucide-react';
import { ModalDialog } from './ModalDialog';

interface ClipboardGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertImage?: (file: File) => void;
  onInsertImageSrc?: (src: string, name?: string) => void;
}

export const ClipboardGuideModal: React.FC<ClipboardGuideModalProps> = ({
  isOpen,
  onClose,
  onInsertImage,
  onInsertImageSrc,
}) => {
  const pasteZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPasteFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle Paste event directly on the modal paste zone
  const handleZonePaste = (e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Check files
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (
          file.type.startsWith('image/') ||
          /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i.test(file.name)
        ) {
          e.preventDefault();
          setPasteFeedback('이미지를 성공적으로 읽었습니다!');
          onInsertImage?.(file);
          setTimeout(() => onClose(), 250);
          return;
        }
      }
    }

    // 2. Check items (screenshots, Snipping tool, copy image)
    if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type.indexOf('image') !== -1 || item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            setPasteFeedback('이미지를 성공적으로 읽었습니다!');
            onInsertImage?.(file);
            setTimeout(() => onClose(), 250);
            return;
          }
        }
      }
    }

    // 3. Check HTML (copied web image)
    const html = clipboardData.getData('text/html');
    if (html) {
      const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match && match[1]) {
        e.preventDefault();
        setPasteFeedback('웹 복사 이미지를 성공적으로 읽었습니다!');
        onInsertImageSrc?.(match[1], '웹 복사 이미지');
        setTimeout(() => onClose(), 250);
        return;
      }
    }

    // 4. Check Text (URL, base64 or SVG)
    const text = clipboardData.getData('text/plain')?.trim();
    if (text) {
      if (
        text.startsWith('data:image/') ||
        /^https?:\/\/.+\.(png|jpe?g|webp|gif|svg|bmp|avif)(\?.*)?$/i.test(text)
      ) {
        e.preventDefault();
        setPasteFeedback('이미지 링크를 성공적으로 읽었습니다!');
        onInsertImageSrc?.(text, 'URL 이미지');
        setTimeout(() => onClose(), 250);
        return;
      } else if (text.startsWith('<svg') && text.includes('</svg>')) {
        e.preventDefault();
        setPasteFeedback('SVG 코드를 성공적으로 읽었습니다!');
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
        onInsertImageSrc?.(svgDataUrl, '붙여넣은 SVG');
        setTimeout(() => onClose(), 250);
        return;
      }
    }
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (
          file.type.startsWith('image/') ||
          /\.(png|jpe?g|webp|gif|svg|bmp|ico|avif)$/i.test(file.name)
        ) {
          setPasteFeedback('이미지 파일이 추가되었습니다!');
          onInsertImage?.(file);
          setTimeout(() => onClose(), 250);
          return;
        }
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setPasteFeedback('이미지 파일이 추가되었습니다!');
      onInsertImage?.(file);
      setTimeout(() => onClose(), 250);
    }
  };

  const handleOpenInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="clipboard-dialog-title"
      closeOnBackdrop
      initialFocusRef={pasteZoneRef}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      panelClassName="relative w-full max-w-xl rounded-2xl bg-stone-900 border border-stone-800 shadow-2xl p-6 text-stone-200 flex flex-col space-y-4"
    >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          title="닫기"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 shrink-0">
            <Clipboard className="w-5 h-5" />
          </div>
          <div>
            <h2 id="clipboard-dialog-title" className="text-base font-bold text-stone-100">클립보드 이미지 붙여넣기</h2>
            <p className="text-xs text-stone-400">샌드박스 보안 환경 안내 및 즉시 붙여넣기</p>
          </div>
        </div>

        {/* 1. Interactive Paste Drop Zone (Ready for Ctrl+V right now) */}
        <div
          ref={pasteZoneRef}
          tabIndex={0}
          onPaste={handleZonePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative p-5 rounded-xl border-2 border-dashed transition-all cursor-pointer outline-none flex flex-col items-center justify-center text-center space-y-2 ${
            isDragOver
              ? 'border-orange-500 bg-orange-500/15'
              : 'border-orange-500/60 bg-stone-950/60 hover:border-orange-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20'
          }`}
          onClick={() => pasteZoneRef.current?.focus()}
        >
          {pasteFeedback ? (
            <div className="flex items-center space-x-2 text-emerald-400 py-3">
              <CheckCircle2 className="w-6 h-6 animate-bounce" />
              <span className="font-semibold text-sm">{pasteFeedback}</span>
            </div>
          ) : (
            <>
              <div className="p-3 rounded-full bg-orange-500/20 text-orange-400">
                <Keyboard className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-bold text-white mb-0.5">
                  지금 바로 <kbd className="px-2 py-0.5 bg-stone-800 border border-stone-700 rounded text-orange-400 font-mono text-xs">Ctrl + V</kbd> (Mac: <kbd className="px-1.5 py-0.5 bg-stone-800 border border-stone-700 rounded text-orange-400 font-mono text-xs">Cmd + V</kbd>) 키를 누르세요!
                </p>
                <p className="text-xs text-stone-400">
                  캡처도구(Win+Shift+S), 스크린샷, 웹에서 복사한 이미지가 즉시 삽입됩니다.
                </p>
              </div>
              <div className="flex items-center space-x-3 pt-2">
                <span className="text-[11px] text-stone-500">또는</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg text-xs font-medium border border-stone-700 transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-orange-400" />
                  <span>컴퓨터 파일 선택</span>
                </button>
                <span className="text-[11px] text-stone-500">또는 여기로 드래그 앤 드롭</span>
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>

        {/* 2. Technical Explanation for the User's Inquiry */}
        <div className="p-3.5 rounded-xl bg-stone-950/80 border border-stone-800 space-y-2 text-xs">
          <div className="flex items-start space-x-2">
            <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold text-orange-300">
                왜 [클립보드 붙여넣기] 버튼 클릭 시 이 안내가 나타나나요?
              </span>
              <p className="text-stone-300 leading-relaxed">
                현재 실행 중인 <strong>AI Studio 미리보기는 iFrame 샌드박스(Sandbox)</strong> 내부에서 구동됩니다.
                브라우저의 W3C 웹 보안 표준상, 샌드박스 프레임에서는 자바스크립트가 시스템 클립보드를 임의로 직접 읽어오는 기능(<code className="bg-stone-800 px-1 py-0.5 rounded text-orange-200">navigator.clipboard.read()</code>)을 보안상 완전 차단(NotAllowedError)하기 때문입니다.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-stone-800/80 grid grid-cols-1 sm:grid-cols-2 gap-2 text-stone-300">
            <div className="p-2 rounded bg-stone-900/60 border border-stone-800 flex items-start space-x-2">
              <MousePointerClick className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-stone-200 block text-[11px]">캔버스 어디서나 Ctrl+V</strong>
                <span className="text-[11px] text-stone-400">
                  캔버스를 한 번 클릭한 뒤 키보드로 Ctrl+V를 누르면 모달 없이도 즉시 붙여넣어집니다.
                </span>
              </div>
            </div>

            <div className="p-2 rounded bg-stone-900/60 border border-stone-800 flex items-start space-x-2">
              <ExternalLink className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-stone-200 block text-[11px]">새 탭에서 열기</strong>
                <span className="text-[11px] text-stone-400">
                  독립 브라우저 탭으로 앱을 열면 iFrame 샌드박스가 해제되어 버튼 클릭도 권한 허용 후 작동합니다.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleOpenInNewTab}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white text-xs font-medium border border-stone-700 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
            <span>새 탭에서 열기 (샌드박스 해제)</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-stone-950 font-bold text-xs transition-colors shadow-sm"
          >
            닫기
          </button>
        </div>
    </ModalDialog>
  );
};
