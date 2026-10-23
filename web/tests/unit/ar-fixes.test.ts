import { describe, expect, it } from 'vitest';
import { GEO_ERROR, statusAfterError } from '@/hooks/useGeolocation';
import { facingYaw, xrYaw } from '@/lib/ar/alignment';

describe('location errors', () => {
  it('only gives up when permission is refused', () => {
    expect(statusAfterError(GEO_ERROR.PERMISSION_DENIED, false, 1)).toBe('denied');
    expect(statusAfterError(GEO_ERROR.PERMISSION_DENIED, true, 1)).toBe('denied');
  });

  it('keeps trying through timeouts while the phone gets its first fix', () => {
    expect(statusAfterError(GEO_ERROR.TIMEOUT, false, 1)).toBe('locating');
    expect(statusAfterError(GEO_ERROR.TIMEOUT, false, 2)).toBe('locating');
    // After a few tries, say so (it keeps retrying in the background).
    expect(statusAfterError(GEO_ERROR.TIMEOUT, false, 3)).toBe('error');
    expect(statusAfterError(GEO_ERROR.POSITION_UNAVAILABLE, false, 3)).toBe('unavailable');
  });

  it('keeps the last good position when a later reading times out', () => {
    expect(statusAfterError(GEO_ERROR.TIMEOUT, true, 5)).toBe('ok');
    expect(statusAfterError(GEO_ERROR.POSITION_UNAVAILABLE, true, 5)).toBe('ok');
  });
});

describe('facing direction in ground tracking', () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  // Phone facing yaw θ, camera tilted down by p: forward and up vectors in AR space.
  const pose = (yawDeg: number, pitchDownDeg: number) => {
    const y = rad(yawDeg);
    const p = rad(pitchDownDeg);
    const fwd = { x: Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: -Math.cos(y) * Math.cos(p) };
    const up = { x: Math.sin(y) * Math.sin(p), y: Math.cos(p), z: -Math.cos(y) * Math.sin(p) };
    return [fwd, up] as const;
  };

  it('matches the camera direction when the phone is upright', () => {
    const [f, u] = pose(40, 5);
    expect(facingYaw(f, u)).toBeCloseTo(40, 6);
  });

  it('stays correct when looking steeply or straight down at the ground', () => {
    for (const pitch of [60, 80, 89.9]) {
      const [f, u] = pose(130, pitch);
      expect(facingYaw(f, u)).toBeCloseTo(130, 4);
    }
  });

  it('agrees with the plain direction formula', () => {
    expect(xrYaw(0, -1)).toBeCloseTo(0);
    const [f, u] = pose(270, 30);
    expect(facingYaw(f, u)).toBeCloseTo(270, 6);
  });
});
