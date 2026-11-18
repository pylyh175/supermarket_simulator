// Pure AABB collision helpers — no THREE imports, no DOM, fully deterministic.
//
// "Circle vs axis-aligned box on the XZ plane." Y is not collided against;
// the floor is flat. Positions are [x, z] pairs.

export interface Aabb {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

// Push a circle out of a box. Axis-separated-safe: when the circle centre is
// outside the box, push along the normal from the closest point on the box to
// the centre (handles faces and corners). When the centre is inside the box
// there is no closest-point direction, so push out along the axis of least
// penetration instead.
export function circleAabbResolve(
  pos: [number, number],
  radius: number,
  box: Aabb,
): [number, number] {
  const [x, z] = pos;
  const closestX = Math.max(box.minX, Math.min(x, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
  let dx = x - closestX;
  let dz = z - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq > 0) {
    // Centre is outside (or on the boundary of) the box.
    const dist = Math.sqrt(distSq);
    if (dist >= radius) return [x, z]; // no overlap
    const push = radius - dist;
    return [x + (dx / dist) * push, z + (dz / dist) * push];
  }

  // Centre is inside the box: push out along the axis of least penetration.
  const pushLeft = x - box.minX + radius;
  const pushRight = box.maxX - x + radius;
  const pushNear = z - box.minZ + radius;
  const pushFar = box.maxZ - z + radius;
  const minPush = Math.min(pushLeft, pushRight, pushNear, pushFar);
  if (minPush === pushLeft) return [box.minX - radius, z];
  if (minPush === pushRight) return [box.maxX + radius, z];
  if (minPush === pushNear) return [x, box.minZ - radius];
  return [x, box.maxZ + radius];
}

// Clamp a circle so it stays fully inside the bounds.
export function clampToBounds(
  pos: [number, number],
  radius: number,
  bounds: Aabb,
): [number, number] {
  const loX = bounds.minX + radius;
  const hiX = bounds.maxX - radius;
  const loZ = bounds.minZ + radius;
  const hiZ = bounds.maxZ - radius;
  // Degenerate bounds narrower than the diameter collapse to their midline.
  const x = loX > hiX ? (bounds.minX + bounds.maxX) / 2 : Math.max(loX, Math.min(pos[0], hiX));
  const z = loZ > hiZ ? (bounds.minZ + bounds.maxZ) / 2 : Math.max(loZ, Math.min(pos[1], hiZ));
  return [x, z];
}

// Build the 4 wall boxes that form a closed shell around a widthM × depthM
// interior opening centred on the origin. Walls sit on the boundary and grow
// outward by wallThicknessM, so the interior opening is exactly widthM × depthM.
// North/south walls span the full outer width (covering the corners);
// west/east walls span the inner depth between them.
//   -Z wall: [-(w/2 + t), -(d/2 + t)] → [ (w/2 + t), -d/2          ]
//   +Z wall: [-(w/2 + t),   d/2      ] → [ (w/2 + t),  d/2 + t     ]
//   -X wall: [-(w/2 + t),  -d/2      ] → [ -w/2      ,  d/2        ]
//   +X wall: [ w/2      ,  -d/2      ] → [  w/2 + t  ,  d/2        ]
export function makeWallBoxes(widthM: number, depthM: number, wallThicknessM: number): Aabb[] {
  const hw = widthM / 2;
  const hd = depthM / 2;
  const t = wallThicknessM;
  return [
    { minX: -hw - t, minZ: -hd - t, maxX: hw + t, maxZ: -hd }, // north (-Z)
    { minX: -hw - t, minZ: hd, maxX: hw + t, maxZ: hd + t },   // south (+Z)
    { minX: -hw - t, minZ: -hd, maxX: -hw, maxZ: hd },         // west  (-X)
    { minX: hw, minZ: -hd, maxX: hw + t, maxZ: hd },           // east  (+X)
  ];
}
