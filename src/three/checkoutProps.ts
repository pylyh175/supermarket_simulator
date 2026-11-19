// Procedural checkout-flow props (Task 2). No assets, no textures, no scene
// attachment — callers (Task 3) own placement. Everything here persists for
// the whole session, so nothing is ever disposed.
//
// Group origins:
//   - "bag" / "tote": origin at the base center (y = 0 underside), so a caller
//     can stand them on a surface by setting y to the surface height.
//   - "belt": origin at the slab underside (y = 0 at the bottom of the slab),
//     rollers/rails protrude above y = BELT_H_M.
//
// Geometry choices (documented, deliberately simple):
//   - Bag: ONE tapered 4-sided open-ended cylinder (radialSegments = 4),
//     rotated 45° so faces align to ±x/±z, then scaled in z to reach the
//     0.22 m depth. This gives the classic splayed paper-bag silhouette with
//     a single geometry + a single DoubleSide Lambert material (DoubleSide so
//     the interior reads from above the open top). A flat square plane caps
//     the bottom.
//   - Tote: same trick, straight-walled (radiusTop == radiusBottom), plus a
//     rolled rim made from a flattened square torus (TorusGeometry with
//     tubularSegments = 4, laid flat on the top edge, spun 45° to match the
//     square orientation). No per-face material flags or 5-plane open box —
//     this keeps the rim honest as a "rolled" edge and readable.
//   - Belt case: dark slab box matching TILL_MAT (#241f1a) exactly, two thin
//     TILL_METAL (#3a3630) rails along the top edges, and 4 roller cylinders
//     half-embedded in the slab top so the motion direction reads from above.
//
// Palette mirrors storeLayout.ts (TILL_MAT / TILL_METAL); do not drift.

import * as THREE from "three";

const BELT_SLAB_COLOR = "#241f1a"; // TILL_MAT
const BELT_RAIL_COLOR = "#3a3630"; // TILL_METAL
const BAG_KRAFT = "#c9a26b"; // kraft cream
const TOTE_KRAFT = "#d3b285"; // slightly paler beige-kraft

const FLAT = { flatShading: true } as const;

function lambert(color: string, side?: THREE.Side): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...FLAT, ...(side ? { side } : {}) });
}

// ---------------------------------------------------------------------------
// Shared sizing
// ---------------------------------------------------------------------------

const BAG_W_M = 0.34;
const BAG_H_M = 0.3;
const BAG_D_M = 0.22;
const BAG_TAPER = 0.88; // bottom footprint as a fraction of the top footprint

const TOTE_W_M = 0.36;
const TOTE_H_M = 0.3;
const TOTE_D_M = 0.24;
const TOTE_RIM_TUBE_M = 0.018;
const TOTE_RIM_OVERHANG_M = 0.012;

const BELT_W_M = 0.95; // matches CONVEYOR_MAX_W_M footprint
const BELT_H_M = 0.1; // matches CONVEYOR_H_M
const BELT_D_M = 0.62; // matches CONVEYOR_D_M
const BELT_RAIL_W_M = 0.03;
const BELT_RAIL_H_M = 0.03;
const BELT_ROLLER_R_M = 0.032;
const BELT_ROLLER_COUNT = 4;
const BELT_ROLLER_INSET_M = 0.12; // rollers span ±(BELT_W_M/2 - this inset)

/** Circumradius so a 4-segment cylinder's flat faces sit at ±width/2. */
function squareCircumradius(width: number): number {
  return width / Math.SQRT2;
}

/** Open-top square prism (openEnded 4-seg cylinder), faces on axes, z-scaled to depth. */
function openSquarePrism(
  topWidth: number,
  bottomWidth: number,
  height: number,
  depth: number,
  material: THREE.MeshLambertMaterial,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(
    squareCircumradius(topWidth),
    squareCircumradius(bottomWidth),
    height,
    4,
    1,
    true, // open-ended: the top stays open (bag/tote mouth)
  );
  geo.rotateY(Math.PI / 4); // vertices to diagonals → faces face ±x/±z
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.z = depth / topWidth;
  return mesh;
}

/** Flat bottom cap for an open prism, sized to the (tapered) footprint. */
function bottomCap(
  width: number,
  depth: number,
  material: THREE.MeshLambertMaterial,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth);
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2; // faces up into the interior
  return mesh;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildBag(): THREE.Group {
  const group = new THREE.Group();
  group.name = "bag";

  const material = lambert(BAG_KRAFT, THREE.DoubleSide); // interior must read from above
  const body = openSquarePrism(BAG_W_M, BAG_W_M * BAG_TAPER, BAG_H_M, BAG_D_M, material);
  body.position.y = BAG_H_M / 2;
  group.add(body);

  const cap = bottomCap(BAG_W_M * BAG_TAPER, BAG_D_M * BAG_TAPER, material);
  cap.position.y = 0.001; // just above the underside plane
  group.add(cap);

  return group;
}

function buildTote(): THREE.Group {
  const group = new THREE.Group();
  group.name = "tote";

  const material = lambert(TOTE_KRAFT, THREE.DoubleSide);
  const body = openSquarePrism(TOTE_W_M, TOTE_W_M, TOTE_H_M, TOTE_D_M, material);
  body.position.y = TOTE_H_M / 2;
  group.add(body);

  const cap = bottomCap(TOTE_W_M, TOTE_D_M, material);
  cap.position.y = 0.001;
  group.add(cap);

  // Rolled top rim: square torus (tubularSegments = 4) laid flat on the top
  // edge. Vertices sit on ±x/±z, so spin 45° to align the flats with the body.
  const rimRadius = squareCircumradius(TOTE_W_M) + TOTE_RIM_OVERHANG_M;
  const rimGeo = new THREE.TorusGeometry(rimRadius, TOTE_RIM_TUBE_M, 6, 4);
  rimGeo.rotateX(Math.PI / 2); // ring lies in the XZ plane
  rimGeo.rotateY(Math.PI / 4); // faces align with the body's faces
  const rim = new THREE.Mesh(rimGeo, lambert(TOTE_KRAFT));
  rim.scale.z = TOTE_D_M / TOTE_W_M;
  rim.position.y = TOTE_H_M;
  group.add(rim);

  return group;
}

function buildBelt(): THREE.Group {
  const group = new THREE.Group();
  group.name = "belt";

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(BELT_W_M, BELT_H_M, BELT_D_M),
    lambert(BELT_SLAB_COLOR),
  );
  slab.position.y = BELT_H_M / 2;
  group.add(slab);

  // Two thin metal rails along the top long edges (x axis = travel direction).
  const railMat = lambert(BELT_RAIL_COLOR);
  const railGeo = new THREE.BoxGeometry(BELT_W_M, BELT_RAIL_H_M, BELT_RAIL_W_M);
  const railZ = BELT_D_M / 2 - BELT_RAIL_W_M / 2;
  for (const z of [-railZ, railZ]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0, BELT_H_M + BELT_RAIL_H_M / 2, z);
    group.add(rail);
  }

  // Rollers half-embedded in the slab top, axes across the belt (z), spaced
  // evenly between the inboard ends.
  const rollerGeo = new THREE.CylinderGeometry(BELT_ROLLER_R_M, BELT_ROLLER_R_M, BELT_D_M - 2 * BELT_RAIL_W_M, 12);
  rollerGeo.rotateX(Math.PI / 2); // cylinder axis → z
  const innerHalf = BELT_W_M / 2 - BELT_ROLLER_INSET_M;
  for (let i = 0; i < BELT_ROLLER_COUNT; i += 1) {
    const t = i / (BELT_ROLLER_COUNT - 1);
    const roller = new THREE.Mesh(rollerGeo, railMat);
    roller.position.set(-innerHalf + t * 2 * innerHalf, BELT_H_M, 0);
    group.add(roller);
  }

  return group;
}

export interface BeltProps {
  bagGroup: THREE.Group;
  toteGroup: THREE.Group;
  beltGroup: THREE.Group;
}

/** Build the checkout-flow props. Not attached to any scene — callers own placement. */
export function buildBeltProps(): BeltProps {
  return {
    bagGroup: buildBag(),
    toteGroup: buildTote(),
    beltGroup: buildBelt(),
  };
}
