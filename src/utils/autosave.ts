/**
 * 레거시 자동 저장본 정리용 유틸.
 *
 * 자동 저장·복구 기능은 제거되었다(복구 안내 창도 더 이상 뜨지 않는다).
 * 예전에 IndexedDB에 남아 있을 수 있는 과거 저장본만 한 번 지우기 위해
 * 이 파일을 남겨 둔다.
 */

const DB_NAME = 'imgman';
const STORE = 'autosave';
const KEY = 'current';

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

/** 과거에 저장된 자동 저장본을 삭제한다 (실패해도 앱 동작에는 영향 없음). */
export async function clearLegacyAutosave(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}
