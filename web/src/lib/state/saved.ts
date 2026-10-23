/**
 * Saved places, kept in this browser only (localStorage). Storage can be missing or blocked
 * (private windows, strict settings), so every access is guarded and the app still works without it.
 */

export const SAVED_KEY = 'stirling-campus-map:saved:v1';
const MAX_SAVED = 100;

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: string[] | undefined;
const EMPTY: string[] = [];

function read(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(SAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  cache = ids;
  try {
    globalThis.localStorage?.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable: keep the in-memory list for this visit.
  }
  listeners.forEach((l) => l());
}

export const savedStore = {
  getSnapshot(): string[] {
    cache ??= read();
    return cache;
  },
  getServerSnapshot(): string[] {
    return EMPTY;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVED_KEY) {
        cache = read();
        listener();
      }
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      listeners.delete(listener);
      globalThis.removeEventListener?.('storage', onStorage);
    };
  },
  isSaved(id: string): boolean {
    return savedStore.getSnapshot().includes(id);
  },
  toggle(id: string): boolean {
    const ids = savedStore.getSnapshot();
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids].slice(0, MAX_SAVED);
    write(next);
    return next.includes(id);
  },
  remove(id: string) {
    write(savedStore.getSnapshot().filter((x) => x !== id));
  },
  /** For tests. */
  reset() {
    cache = undefined;
  },
};
