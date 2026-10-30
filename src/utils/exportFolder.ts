/**
 * Export destination folder via the File System Access API (Chrome/Edge).
 * The chosen directory handle persists in IndexedDB so the next export
 * writes straight into the same folder. Browsers expose only the folder's
 * name — never its absolute path — so the UI shows that name.
 * Without the API (Firefox/Safari) exports fall back to a plain download.
 */

type PermissionMode = { mode: 'read' | 'readwrite' };

interface DirectoryHandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission?: (desc: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (desc: PermissionMode) => Promise<PermissionState>;
}

type DirectoryPicker = (options?: {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'pictures';
}) => Promise<FileSystemDirectoryHandle>;

const DB_NAME = 'imgman-export';
const STORE = 'folder';
const KEY = 'current';

export class ExportFolderError extends Error {}

function getPicker(): DirectoryPicker | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

export function supportsExportFolder(): boolean {
  return getPicker() !== null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadExportFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsExportFolder()) return null;
  try {
    const handle = await withStore<unknown>('readonly', (store) => store.get(KEY));
    return handle && typeof handle === 'object' && (handle as FileSystemHandle).kind === 'directory'
      ? (handle as FileSystemDirectoryHandle)
      : null;
  } catch {
    return null;
  }
}

export async function clearExportFolder(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // Nothing stored is the same as cleared
  }
}

/** Opens the OS folder picker; resolves null when the user cancels. */
export async function pickExportFolder(
  current: FileSystemDirectoryHandle | null
): Promise<FileSystemDirectoryHandle | null> {
  const picker = getPicker();
  if (!picker) throw new ExportFolderError('이 브라우저는 저장 폴더 선택을 지원하지 않습니다. Chrome/Edge를 사용하세요.');
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker({ id: 'imgman-export', mode: 'readwrite', startIn: current ?? 'downloads' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw new ExportFolderError(
      err instanceof DOMException && err.name === 'SecurityError'
        ? '이 화면에서는 폴더를 선택할 수 없습니다. 앱을 새 탭에서 열어 주세요.'
        : '폴더를 선택하지 못했습니다.'
    );
  }
  try {
    await withStore('readwrite', (store) => store.put(handle, KEY));
  } catch {
    // Still usable for this session even if it can't be remembered
  }
  return handle;
}

/** Must run inside a user gesture: may show the browser's permission prompt. */
export async function ensureFolderPermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const h = handle as DirectoryHandleWithPermission;
  const desc: PermissionMode = { mode: 'readwrite' };
  if (!h.queryPermission || !h.requestPermission) return;
  if ((await h.queryPermission(desc)) === 'granted') return;
  if ((await h.requestPermission(desc)) !== 'granted') {
    throw new ExportFolderError(`'${handle.name}' 폴더에 저장할 권한이 없습니다. 권한을 허용하거나 폴더를 다시 선택하세요.`);
  }
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return false;
    throw err;
  }
}

/** "name.png" → "name (1).png", "name (2).png", … like a browser download. */
export async function uniqueFileName(dir: FileSystemDirectoryHandle, fileName: string): Promise<string> {
  if (!(await exists(dir, fileName))) return fileName;
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

/** Writes the blob into the folder without overwriting; returns the saved name. */
export async function writeToExportFolder(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob
): Promise<string> {
  try {
    const name = await uniqueFileName(dir, fileName);
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => undefined);
      throw err;
    }
    return name;
  } catch (err) {
    if (err instanceof ExportFolderError) throw err;
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      throw new ExportFolderError(`'${dir.name}' 폴더를 찾을 수 없습니다. 폴더가 옮겨졌거나 삭제됐다면 다시 선택하세요.`);
    }
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new ExportFolderError(`'${dir.name}' 폴더에 저장할 권한이 없습니다.`);
    }
    if (err instanceof TypeError || (err instanceof DOMException && err.name === 'TypeMismatchError')) {
      throw new ExportFolderError('파일명에 사용할 수 없는 문자가 있습니다.');
    }
    throw new ExportFolderError(`'${dir.name}' 폴더에 저장하지 못했습니다.`);
  }
}
