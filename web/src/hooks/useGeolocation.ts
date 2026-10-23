'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/lib/types';

export type GeoStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'error';

interface GeoState {
  status: GeoStatus;
  position?: LatLng;
  /** Accuracy radius in metres. */
  accuracy?: number;
}

/** GeolocationPositionError codes. */
export const GEO_ERROR = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as const;

/** How long to wait before trying again after a timeout or "position unavailable". */
const RETRY_MS = 3000;

/**
 * What a location error means for the app. Only a refusal is final; a timeout or a temporary
 * "unavailable" (common indoors, or while the phone gets its first fix) keeps trying, and a
 * position we already have is kept rather than thrown away.
 */
export function statusAfterError(code: number, hadFix: boolean, failures: number): GeoStatus {
  if (code === GEO_ERROR.PERMISSION_DENIED) return 'denied';
  if (hadFix) return 'ok';
  // Give the phone a few tries before telling the person.
  return failures >= 3 ? (code === GEO_ERROR.POSITION_UNAVAILABLE ? 'unavailable' : 'error') : 'locating';
}

/**
 * Browser geolocation, only started when the user asks for it (so the permission
 * prompt appears in context). Keeps watching once allowed, and keeps retrying after
 * timeouts instead of giving up.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: 'idle' });
  const watchId = useRef<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const hadFix = useRef(false);
  /** The latest start(), for retrying from inside its own callbacks. */
  const startRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        failures.current = 0;
        hadFix.current = true;
        setState({
          status: 'ok',
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        failures.current += 1;
        const status = statusAfterError(err.code, hadFix.current, failures.current);
        setState((s) => ({ ...s, status }));
        if (status === 'denied') {
          stop();
          return;
        }
        // Timeout or temporarily unavailable: start a fresh watch shortly.
        stop();
        retryTimer.current = setTimeout(() => startRef.current(), RETRY_MS);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
  }, [stop]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'unavailable' });
      return;
    }
    if (!window.isSecureContext) {
      // Browsers only share location over https (or localhost).
      setState({ status: 'unavailable' });
      return;
    }
    failures.current = 0;
    setState((s) => ({ ...s, status: s.position ? s.status : 'locating' }));
    start();
  }, [start]);

  useEffect(() => stop, [stop]);

  return { ...state, request };
}

export const GEO_MESSAGES: Record<Exclude<GeoStatus, 'idle' | 'ok'>, string> = {
  locating: 'Finding your location…',
  denied:
    'Location is turned off for this site. iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. ' +
    'Android: tap the icon left of the address → Permissions → Location → Allow. Then try again, or choose a starting point.',
  unavailable: "Your phone can't find its location right now (try outdoors, and turn on precise location). Still trying… or choose a starting point.",
  error: "Your phone is taking a long time to find its location. Still trying… or choose a starting point.",
};
