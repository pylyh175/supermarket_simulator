// Pure movement math — no THREE imports, no DOM, fully deterministic.
//
// Yaw convention (must match tests/colliders.test.ts):
//   forward is -Z (Three.js camera default), right is +X.
//   yaw 0 = facing -Z; yaw is a Three.js-style rotation about +Y,
//   counter-clockwise when viewed from above.
//     yaw   0    ⇒ forward ( 0, 0, -1)   right ( 1, 0,  0)
//     yaw +π/2   ⇒ forward (-1, 0,  0)   right ( 0, 0, -1)
//     yaw +π     ⇒ forward ( 0, 0,  1)   right (-1, 0,  0)
//     yaw +3π/2  ⇒ forward ( 1, 0,  0)   right ( 0, 0,  1)
// Rotating the local direction by yaw about +Y:
//   worldX = cos(yaw) * localX + sin(yaw) * localZ
//   worldZ = -sin(yaw) * localX + cos(yaw) * localZ

export type MoveKeys = { forward: boolean; back: boolean; left: boolean; right: boolean };

// Camera eye height above the floor, in metres.
export function eyeHeightM(): number {
  return 1.6;
}

// Normalized direction rotated by yaw, scaled to speedMps.
// The diagonal is normalized so it is NOT faster than straight movement.
// Returns the zero vector when no keys are pressed (opposing keys cancel out).
export function moveVector(keys: MoveKeys, yawRad: number, speedMps: number): [number, number, number] {
  let localX = 0;
  let localZ = 0;
  if (keys.forward) localZ -= 1;
  if (keys.back) localZ += 1;
  if (keys.right) localX += 1;
  if (keys.left) localX -= 1;

  const len = Math.hypot(localX, localZ);
  if (len === 0) return [0, 0, 0];

  const nx = localX / len;
  const nz = localZ / len;
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);

  return [
    (cos * nx + sin * nz) * speedMps,
    0,
    (-sin * nx + cos * nz) * speedMps,
  ];
}
