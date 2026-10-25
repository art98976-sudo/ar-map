/** The debug panel's text (shown only with the debug overlay on). */
import { APP_CONFIG } from '@/config/appConfig';
import { circularSpread } from '@/lib/ar/alignment';
import { maxArrowDistance } from '@/lib/ar/ground';
import type { XrFrameInfo } from '../xr/XrGround';
import type { ArState } from './state';

/**
 * Debug text from the start: the config switch, or ?ardebug=1 in the address. Read when the app
 * loads, because the app then rewrites the address bar (without this parameter).
 */
export const DEBUG_AT_START =
  APP_CONFIG.arScreen.debug || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ardebug') === '1');

export function debugLines(st: ArState, xr: XrFrameInfo | undefined, status: string | null): string[] {
  const lines = [
    `engine ${xr ? 'ground tracking (WebXR)' : 'camera overlay'} · ${Math.round(st.fps)} fps`,
    `state ${status ?? 'tracking OK, arrows shown'}`,
    `heading ${st.heading.toFixed(1)}° · compass ${st.rawHeading === null ? 'none' : `${st.rawHeading.toFixed(1)}°`}${st.compassAccuracy !== null ? ` ±${st.compassAccuracy}°` : ''} · offset ${st.headingOffset}°`,
    `gps ${st.geo.status}${st.geo.accuracy ? ` ±${Math.round(st.geo.accuracy)} m` : ''} · along ${st.along.toFixed(1)}/${st.track.total.toFixed(1)} m · off route ${st.off.toFixed(1)} m`,
  ];
  if (xr) {
    const p = xr.pose;
    lines.push(
      `pose ${p ? `${p.tracking} x${p.x.toFixed(2)} y${p.y.toFixed(2)} z${p.z.toFixed(2)} yaw ${p.yaw.toFixed(0)}°` : 'none'}`,
      `ground ${xr.groundY === null ? 'looking for the floor' : `y ${xr.groundY.toFixed(2)} m (${xr.groundSource === 'hits' ? 'measured' : '1.5 m fallback'})`} · ${xr.groundSamples} hits · ${xr.floorSpace}`,
      `arrow y ${xr.arrowY === null ? 'hidden' : `${xr.arrowY.toFixed(3)} m`} · phone ${p && xr.groundY !== null ? `${(p.y - xr.groundY).toFixed(2)} m above the floor` : 'height unknown'}`,
      `anchor ${!xr.anchorsSupported ? 'not supported' : xr.originAnchor ? `x${xr.originAnchor.x.toFixed(2)} z${xr.originAnchor.z.toFixed(2)}` : 'none'}`,
      `map→AR ${st.align ? `rotation ${st.align.offset.toFixed(1)}°${st.manualAlign ? ' (manual)' : ''}` : 'not aligned'} · compass samples ${st.compassSamples.length} spread ${circularSpread(st.compassSamples).toFixed(0)}°`,
    );
  } else {
    lines.push(
      `tilt ${st.pitch.toFixed(1)}° roll ${((st.roll * 180) / Math.PI).toFixed(1)}° · phone height ${st.eyeHeight.toFixed(2)} m · arrows to ${maxArrowDistance(st.eyeHeight).toFixed(1)} m`,
    );
  }
  return lines;
}
