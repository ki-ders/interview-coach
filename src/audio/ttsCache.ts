/**
 * Gemini 로 합성한 면접관 음성을 이 브라우저(IndexedDB)에 남겨 둔다.
 * 인사·기본 질문·"잘 들었습니다" 같은 문장은 매번 같으므로, 한 번 만든 뒤로는 무료 한도를 쓰지 않는다.
 */

const DB_NAME = 'interview-coach-tts';
const STORE = 'pcm';
const MAX_ITEMS = 400;

export interface CachedPcm {
  rate: number;
  pcm: ArrayBuffer;
}

interface Row extends CachedPcm {
  k: string;
  t: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'k' });
        store.createIndex('t', 't');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function getCachedPcm(key: string): Promise<CachedPcm | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as Row | undefined;
        resolve(row ? { rate: row.rate, pcm: row.pcm } : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putCachedPcm(key: string, value: CachedPcm): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({ k: key, t: Date.now(), ...value } satisfies Row);
    // 너무 많이 쌓이면 오래된 것부터 지운다 (꼬리 질문처럼 한 번만 쓰는 문장이 쌓인다)
    const count = store.count();
    count.onsuccess = () => {
      let extra = count.result - MAX_ITEMS;
      if (extra <= 0) return;
      const cursor = store.index('t').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || extra <= 0) return;
        c.delete();
        extra--;
        c.continue();
      };
    };
  } catch {
    /* 저장 실패는 무시 — 다음에 다시 합성하면 된다 */
  }
}
