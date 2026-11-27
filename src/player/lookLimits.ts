// Soft look limits for the till: mouse look slows inside the last stretch
// before a limit, then stops at it, so the view eases in instead of hitting a wall.

export interface LookLimits {
  /** Yaw the range is measured from (radians). */
  centerYaw: number;
  /** Max yaw either side of centerYaw (radians). */
  yawHalfRange: number;
  /** Lowest / highest pitch (radians; negative looks down). */
  pitchMin: number;
  pitchMax: number;
}

const SOFT_ZONE_RAD = (15 * Math.PI) / 180;
// Slowest speed right at the edge, so the last few degrees are still reachable.
const MIN_EDGE_SPEED = 0.2;

/** Apply `delta` to `value`, slowing near min/max and clamping to them. */
export function softLimit(value: number, delta: number, min: number, max: number): number {
  let d = delta;
  if (d > 0 && max - value < SOFT_ZONE_RAD) d *= Math.max(MIN_EDGE_SPEED, (max - value) / SOFT_ZONE_RAD);
  else if (d < 0 && value - min < SOFT_ZONE_RAD) d *= Math.max(MIN_EDGE_SPEED, (value - min) / SOFT_ZONE_RAD);
  return Math.min(max, Math.max(min, value + d));
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

/** New yaw after a mouse delta, held within limits around the centre. */
export function limitYaw(yaw: number, delta: number, limits: LookLimits): number {
  const rel = wrapAngle(yaw - limits.centerYaw);
  return limits.centerYaw + softLimit(rel, delta, -limits.yawHalfRange, limits.yawHalfRange);
}
