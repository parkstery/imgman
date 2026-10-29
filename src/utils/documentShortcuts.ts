export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    !!el.isContentEditable
  );
}

export interface DocumentShortcutGate {
  modalOpen: boolean;
  /** Clipboard guide owns paste; other document shortcuts stay blocked. */
  allowClipboardPaste?: boolean;
  target?: EventTarget | null;
}

/**
 * When a modal is open, background document shortcuts (Delete, Undo, tool
 * keys, canvas capture-phase listeners) must not run.
 */
export function shouldBlockDocumentShortcut(opts: DocumentShortcutGate): boolean {
  if (isEditableTarget(opts.target ?? null)) return true;
  return opts.modalOpen;
}

export function shouldBlockDocumentPaste(opts: DocumentShortcutGate): boolean {
  if (isEditableTarget(opts.target ?? null)) return false;
  if (!opts.modalOpen) return false;
  if (opts.allowClipboardPaste) return false;
  return true;
}
