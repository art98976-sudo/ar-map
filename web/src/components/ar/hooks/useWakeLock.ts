import { useEffect } from 'react';

type WakeLock = { release(): Promise<void> };

/** Keeps the screen on while mounted (asks again when the page becomes visible). */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLock | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } };
    const ask = () => {
      if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      document.removeEventListener('visibilitychange', ask);
      lock?.release().catch(() => {});
    };
  }, []);
}
