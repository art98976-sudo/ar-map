/** Average walking speed used for time estimates (about 4.8 km/h). */
export const WALKING_SPEED_MPS = 1.33;
/** Slower average used for step-free routes. */
export const ACCESSIBLE_SPEED_MPS = 1.1;

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}
