import { useCallback, useEffect, useState } from 'react';

/** Messages show one at a time, each for this long. */
const TOAST_MS = 3000;

/** Short messages shown one at a time; the rest wait in a queue, and repeats are dropped. */
export function useToastQueue() {
  const [queue, setQueue] = useState<string[]>([]);
  const toast = queue[0] ?? null;
  const showToast = useCallback((message: string) => {
    setQueue((q) => (q.includes(message) ? q : [...q, message]));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);
  return { toast, showToast };
}
