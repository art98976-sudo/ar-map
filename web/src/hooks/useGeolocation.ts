'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/lib/types';

export type GeoStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'error';

export interface GeoState {
  status: GeoStatus;
  position?: LatLng;
  /** Accuracy radius in metres. */
  accuracy?: number;
}

/**
 * Browser geolocation, only started when the user asks for it (so the permission
 * prompt appears in context). Keeps watching once allowed.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: 'idle' });
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

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
    stop();
    setState((s) => ({ ...s, status: s.position ? s.status : 'locating' }));
    watchId.current = navigator.geolocation.watchPosition(
      (pos) =>
        setState({
          status: 'ok',
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        stop();
        setState((s) => ({
          ...s,
          status: err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.POSITION_UNAVAILABLE ? 'unavailable' : 'error',
        }));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { ...state, request };
}

export const GEO_MESSAGES: Record<Exclude<GeoStatus, 'idle' | 'ok'>, string> = {
  locating: 'Finding your location…',
  denied: 'Location access is turned off. Allow location for this site in your browser settings, or choose a starting point.',
  unavailable: "Couldn't find your location. Choose a starting point.",
  error: "Couldn't find your location. Choose a starting point.",
};
