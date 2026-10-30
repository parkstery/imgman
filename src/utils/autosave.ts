import { CanvasConfig, CanvasElement, HistorySnapshot, Layer } from '../types';

/**
 * Browser-local autosave in IndexedDB (images are base64 and outgrow
 * localStorage quickly). One slot: the latest document state.
 */

const DB_NAME = 'imgman';
const STORE = 'autosave';
const KEY = 'current';
const ENABLED_KEY = 'imgman.autosave.enabled';

export interface AutosaveRecord {
  version: string;
  savedAt: number;
  config: CanvasConfig;
  layers: Layer[];
  elements: CanvasElement[];
  activeLayerId: string;
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

export async function saveAutosave(snapshot: HistorySnapshot): Promise<number> {
  const savedAt = Date.now();
  const record: AutosaveRecord = {
    version: '1.0.0',
    savedAt,
    config: snapshot.canvasConfig,
    layers: snapshot.layers,
    elements: snapshot.elements,
    activeLayerId: snapshot.activeLayerId,
  };
  await withStore('readwrite', (store) => store.put(record, KEY));
  return savedAt;
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  const rec = await withStore<unknown>('readonly', (store) => store.get(KEY));
  if (!rec || typeof rec !== 'object') return null;
  return rec as AutosaveRecord;
}

export async function clearAutosave(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY));
}

export function isAutosaveEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutosaveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off');
  } catch {
    // Preference is a convenience only
  }
}

export function formatSavedAt(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 10_000) return '방금 전';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
