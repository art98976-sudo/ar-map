import { useEffect, useRef } from 'react';
import { readOrientation, type OrientationLike, type OrientationReading } from '@/lib/ar/orientation';

/** Calls `onReading` with the phone's compass heading and tilt whenever they change. */
export function useDeviceOrientation(onReading: (r: OrientationReading) => void) {
  const latest = useRef(onReading);
  useEffect(() => {
    latest.current = onReading;
  });
  useEffect(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      const r = readOrientation(e as unknown as OrientationLike, screen.orientation?.angle ?? 0);
      if (r) latest.current(r);
    };
    // Android: the absolute (compass) event; iPhone: the normal one with webkitCompassHeading.
    const hasAbsolute = 'ondeviceorientationabsolute' in window;
    const absolute = (e: Event) => onOrientation(e as DeviceOrientationEvent);
    const relative = (e: Event) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      if (typeof ev.webkitCompassHeading === 'number' || ev.absolute || !hasAbsolute) onOrientation(ev);
    };
    if (hasAbsolute) window.addEventListener('deviceorientationabsolute', absolute, true);
    window.addEventListener('deviceorientation', relative, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute', absolute, true);
      window.removeEventListener('deviceorientation', relative, true);
    };
  }, []);
}
