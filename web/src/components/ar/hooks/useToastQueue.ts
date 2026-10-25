import { useCallback, useEffect, useState } from 'react';
import { APP_CONFIG } from '@/config/appConfig';

/** Short messages shown one at a time (each for APP_CONFIG.arScreen.toastMs); the rest wait in a queue, and repeats are dropped. */
export function useToastQueue() {
  const [queue, setQueue] = useState<string[]>([]);
  const toast = queue[0] ?? null;
  const showToast = useCallback((message: string) => {
    setQueue((q) => (q.includes(message) ? q : [...q, message]));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), APP_CONFIG.arScreen.toastMs);
    return () => clearTimeout(t);
  }, [toast]);
  return { toast, showToast };
}
