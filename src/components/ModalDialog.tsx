import React, { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  overlayClassName?: string;
  panelClassName?: string;
  closeOnBackdrop?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export interface FocusableCandidateInfo {
  disabled?: boolean;
  hidden?: boolean;
  ariaHidden?: boolean;
  className?: string;
  display?: string;
  visibility?: string;
  tabIndex?: number;
  clientRectCount?: number;
}

/** Visible, enabled controls only — skips Tailwind `hidden` file inputs etc. */
export function isFocusableCandidate(el: FocusableCandidateInfo): boolean {
  if (el.disabled) return false;
  if (el.hidden) return false;
  if (el.ariaHidden) return false;
  if ((el.tabIndex ?? 0) === -1) return false;
  const className = el.className ?? '';
  if (className.split(/\s+/).includes('hidden')) return false;
  if (el.display === 'none' || el.visibility === 'hidden') return false;
  if (el.clientRectCount === 0) return false;
  return true;
}

/**
 * When the active element is not in the trap list, forward Tab wraps to the
 * first control and Shift+Tab to the last.
 */
export function shouldWrapFocus(
  index: number,
  length: number,
  shift: boolean
): 'first' | 'last' | 'panel' | null {
  if (length === 0) return 'panel';
  if (shift && index <= 0) return 'last';
  if (!shift && (index < 0 || index === length - 1)) return 'first';
  return null;
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
    return isFocusableCandidate({
      disabled: el.hasAttribute('disabled') || ('disabled' in el && !!(el as HTMLButtonElement).disabled),
      hidden: el.hasAttribute('hidden'),
      ariaHidden: el.getAttribute('aria-hidden') === 'true',
      className: el.className?.toString?.() ?? '',
      display: style?.display,
      visibility: style?.visibility,
      tabIndex: el.tabIndex,
      clientRectCount: el.getClientRects().length,
    });
  });
}

/**
 * Accessible modal shell: role=dialog, aria-modal, focus entry/trap/restore,
 * Escape closes only the modal. Visual classes stay with the caller.
 */
export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  titleId,
  overlayClassName,
  panelClassName,
  closeOnBackdrop = false,
  initialFocusRef,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusTarget = initialFocusRef?.current || getFocusable(panel ?? document.body)[0] || panel;
    const timer = window.setTimeout(() => {
      focusTarget?.focus?.();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const list = getFocusable(panelRef.current);
      const wrap = shouldWrapFocus(
        list.indexOf(document.activeElement as HTMLElement),
        list.length,
        e.shiftKey
      );
      if (!wrap) return;
      e.preventDefault();
      e.stopPropagation();
      if (wrap === 'panel') {
        panelRef.current.focus();
        return;
      }
      if (wrap === 'last') {
        list[list.length - 1].focus();
        return;
      }
      list[0].focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, initialFocusRef]);

  if (!isOpen) return null;

  return (
    <div
      className={
        overlayClassName ??
        'fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4'
      }
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
};
