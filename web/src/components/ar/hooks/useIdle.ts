import { useCallback, useEffect, useRef, useState } from 'react';

/** True after `ms` without a call to wake(); wake() resets the timer. */
export function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), ms);
  }, [ms]);
  useEffect(() => {
    timer.current = setTimeout(() => setIdle(true), ms);
    return () => clearTimeout(timer.current);
  }, [ms]);
  return { idle, wake };
}
