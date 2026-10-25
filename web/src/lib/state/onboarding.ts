/**
 * Whether the first-run tutorial has been seen, kept in the browser's storage.
 * Storage can be unavailable (blocked, private mode, full): reading then says "not seen" and saving
 * is skipped, so the app never crashes over it.
 */
import { APP_CONFIG } from '@/config/appConfig';

const KEY = APP_CONFIG.onboarding.storageKey;

export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Not saved: the tutorial may show again next time, which is harmless.
  }
}
