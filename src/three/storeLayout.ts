// Store layout build-out: gondolas, stock, rail tags, checkouts, signage and
// inert props on top of the shell from storeShell.ts. buildStore() adds every
// prop to `scene` and returns the MERGED collider list (shell walls + every
// prop) for the FpsController. Every position comes from
// src/game/storeGeometry.ts (28 x 20 m, centred on the origin):
//
//   z = -10   back wall: staff door (east)
//   z -6.9..-3.15 / -1.35..2.4   back / front gondola runs (7 + 2 wall runs)
//   z ≈ 5.7   PASARAYA MESRA sign (hanging, double-sided)
//   z = 7     3 checkout counters; the player's is the west one (TILL_X)
//   z = +10   glass shopfront, door at the west end; Grab counter and bench
//             against the west wall beside it
//
// Nothing here is interactive — the till machine lives in cashierMachine.ts.
import * as THREE from "three";
import { makeWallBoxes, type Aabb } from "../player/colliders";
import {
  STORE_WIDTH_M,
  STORE_DEPTH_M,
  WALL_THICKNESS_M,
  WALL_HEIGHT_M,
} from "./storeShell";
import type { AssetBundle } from "./assets";
import {
  FACE_SLOTS,
  FACE_USABLE_M,
  computeFacings,
  computePlacements,
  faceSkus,
  type Placement,
  type PlacementCell,
} from "../game/planogram";
import { buildRailTags } from "../game/railTags";
import {
  BACK_Z,
  BENCH,
  CHECKOUT_XS,
  COUNTER_W_M,
  GONDOLA_XS,
  GRAB,
  RUNS,
  STAFF_DOOR_X,
  STORE_WIDTH_M as GEOMETRY_WIDTH_M,
  TILL_X,
  TILL_Z,
  WALL_RUN_BACK_XS,
  solidFootprints,
} from "../game/storeGeometry";
import { buildRunMeshes } from "./gondola";

// ---------------------------------------------------------------------------
// Layout constants — named, no magic numbers.
// ---------------------------------------------------------------------------

// Checkout counter + till (bottom-centre, facing the spawn). Exported so the
// customer flow and the till station zone anchor to the same spot.
export { TILL_X, TILL_Z };
const TILL_SIGN_Y = 3.1;
const TILL_SIGN_Z = TILL_Z - 1.28;
const TILL_SIGN_HALF_WIDTH_M = 1.15;      // rod mounts, ± from sign centre
const CONVEYOR_X_FRACTION = -0.27;        // of counter width, left side
const MAT_X_FRACTION = 0.27;              // scanner mat, customer side right
const CONVEYOR_MAX_W_M = 0.95;
const CONVEYOR_D_M = 0.62;
const CONVEYOR_H_M = 0.1;
const CONVEYOR_SINK_M = 0.02;             // sits slightly into the counter top
const MAT_W_M = 0.5;
const MAT_H_M = 0.025;
const MAT_D_M = 0.42;

// PASARAYA MESRA sign, hanging from the ceiling above/behind the till.
const KEDAI_SIGN_HEIGHT_M = 0.995;        // matches the kedaiSign plane built in assets.ts
const SIGN_ROD_RADIUS_M = 0.02;

// Grab pick-up counter (top-right, against the north wall). Inert.
const GRAB_BASE_W_M = 1.35;
const GRAB_BASE_H_M = 0.78;
const GRAB_BASE_D_M = 0.55;
const GRAB_TOP_OVERHANG_M = 0.05;
const GRAB_TOP_H_M = 0.06;
const GRAB_STRIPE_W_M = 1.2;
const GRAB_STRIPE_H_M = 0.14;
const GRAB_STRIPE_D_M = 0.02;
const GRAB_SIGN_Y = 2.15;
const GRAB_PARCEL_SIZE_M = 0.34;
const GRAB_PARCEL_X_M = -0.35;             // parcel on the left of the counter top

// Storeroom door (top-left, on the north wall). Inert.
const DOOR_SLAB_W_M = 1.1;
const DOOR_SLAB_H_M = 2.15;
const DOOR_SLAB_D_M = 0.09;
const DOOR_SLAB_Z = -6.9;
const DOOR_FRAME_POST_W_M = 0.12;
const DOOR_FRAME_POST_H_M = 2.3;
const DOOR_FRAME_HEAD_W_M = 1.46;
const DOOR_FRAME_HEAD_H_M = 0.14;
const DOOR_FRAME_HEAD_Y = 2.36;
const DOOR_KNOB_RADIUS_M = 0.035;
const DOOR_KNOB_X_M = 0.38;               // knob on the latch side (toward the store centre)
const DOOR_KNOB_Y_M = 1.02;
const DOOR_STENCIL_W_M = 0.62;
const DOOR_STENCIL_H_M = 0.17;
const DOOR_STENCIL_Y_M = 1.68;

// Break-area bench (bottom-left). Inert.
const BENCH_SEAT_W_M = 1.8;
const BENCH_SEAT_H_M = 0.08;
const BENCH_SEAT_D_M = 0.48;
const BENCH_SEAT_Y_M = 0.46;
const BENCH_LEG_W_M = 0.09;
const BENCH_LEG_H_M = 0.42;
const BENCH_LEG_D_M = 0.4;
const BENCH_LEG_X_M = 0.72;
const BENCH_BACK_POST_W_M = 0.07;
const BENCH_BACK_POST_H_M = 0.5;
const BENCH_BACK_POST_X_M = 0.8;
const BENCH_BACK_POST_Z_M = 0.2;
const BENCH_BACK_Y_M = 0.71;
const BENCH_BACKREST_W_M = 1.72;
const BENCH_BACKREST_H_M = 0.34;
const BENCH_BACKREST_D_M = 0.06;
const BENCH_BACKREST_Y_M = 0.82;
const BENCH_BACKREST_Z_M = 0.2;

// Shared warm palette (mirrors assets.ts / storeShell.ts; not exported there).
const WOOD_COLOR = "#8a5a2e";
const WOOD_DARK = "#5f3d1e";
const COUNTER_CREAM = "#e8e2d6";
const COUNTER_TOP = "#7a5a36";
const GRAB_GREEN = "#00aa5b";
const TILL_METAL = "#3a3630";
const TILL_MAT = "#241f1a";
const DOOR_WOOD = "#6b4a2c";
const DOOR_FRAME = "#4e3421";
const KNOB_BRASS = "#d8b878";
const PARCEL_KRAFT = "#b98a52";
const STENCIL_BG = "#33241a";
const STENCIL_FG = "#e8d9b8";

const FLAT = { flatShading: true } as const;

function lambert(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...FLAT });
}

function boxCollider(cx: number, cz: number, width: number, depth: number): Aabb {
  return { minX: cx - width / 2, minZ: cz - depth / 2, maxX: cx + width / 2, maxZ: cz + depth / 2 };
}

function measureBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj);
}

/** Collider matching an object's measured XZ footprint (Y is ignored). */
function footprintCollider(obj: THREE.Object3D): Aabb {
  const box = measureBox(obj);
  return { minX: box.min.x, minZ: box.min.z, maxX: box.max.x, maxZ: box.max.z };
}

function addBox(
  scene: THREE.Scene,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Stock — one InstancedMesh per SKU per run, from the planogram's face slots.
// ---------------------------------------------------------------------------

// Reused for every placement matrix — never allocated per unit.
const PLACEMENT_MATRIX = new THREE.Matrix4();
/** All-white instance color — stamping slot 0 once compiles the instancingColor variant at load. */
const INSTANCE_WHITE = new THREE.Color(1, 1, 1);
const PLACEMENT_POSITION = new THREE.Vector3();
const PLACEMENT_QUATERNION = new THREE.Quaternion();
const PLACEMENT_EULER = new THREE.Euler();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
/** Reused cell — mutated per face, consumed immediately by computePlacements. */
const PLACEMENT_CELL: PlacementCell = { rowX: 0, boardY: 0, centerZ: 0 };

/**
 * Stock every face in FACE_SLOTS. Placements are bucketed per SKU per run
 * (key `${sku}|${unit}:${run}`) so each InstancedMesh has a tight bounding
 * sphere: raycasts and frustum culling skip whole runs at once.
 */
function stockRuns(scene: THREE.Scene, bundle: AssetBundle): void {
  if (bundle.products.size === 0) return;
  const buckets = new Map<string, Placement[]>();
  for (const slot of FACE_SLOTS) {
    const facings = computeFacings(faceSkus(slot), FACE_USABLE_M);
    const face = slot.side > 0 ? "front" : "back";
    PLACEMENT_CELL.rowX = slot.rowX;
    PLACEMENT_CELL.boardY = slot.boardY;
    PLACEMENT_CELL.centerZ = slot.centerZ;
    for (const placement of computePlacements(facings, face, PLACEMENT_CELL, slot.side)) {
      const key = `${placement.skuId}|${slot.unit}:${slot.run}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(placement);
      else buckets.set(key, [placement]);
    }
  }
  addInstancedProducts(scene, bundle, buckets);
  buildRailTags(scene, FACE_SLOTS);
}

/**
 * Bake one InstancedMesh per SKU from the placements collected across every
 * row/face. Geometry and materials are shared with the archetype product's
 * single child Mesh; instances are stamped with userData.productId on the
 * InstancedMesh itself (resolved by main.ts's productIdOf walk).
 *
 * computePlacements y is the pack BASE (board top + a hair), while the child
 * mesh's geometry is vertically centred — so each instance lifts by the
 * child's local y (height / 2) to reproduce the old clone placement exactly.
 */
function addInstancedProducts(
  scene: THREE.Scene,
  bundle: AssetBundle,
  buckets: Map<string, Placement[]>,
): void {
  for (const [key, placements] of buckets) {
    if (placements.length === 0) continue;
    const productId = key.split("|")[0];
    const archetype = bundle.products.get(productId);
    const child = archetype?.children[0] as THREE.Mesh | undefined;
    if (!child || !child.isMesh) {
      console.warn(
        `[storeLayout] Product "${productId}" has no child mesh — ${placements.length} placement(s) skipped.`,
      );
      continue;
    }
    const mesh = new THREE.InstancedMesh(child.geometry, child.material, placements.length);
    mesh.userData.productId = productId;
    // Warm up the instancingColor program variant at load — identity tint, no
    // first-aim recompile hitch.
    mesh.setColorAt(0, INSTANCE_WHITE);
    const childLiftY = child.position.y;
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      PLACEMENT_EULER.set(0, placement.rotationY, 0);
      PLACEMENT_QUATERNION.setFromEuler(PLACEMENT_EULER);
      PLACEMENT_POSITION.set(placement.x, placement.y + childLiftY, placement.z);
      PLACEMENT_MATRIX.compose(PLACEMENT_POSITION, PLACEMENT_QUATERNION, UNIT_SCALE);
      mesh.setMatrixAt(index, PLACEMENT_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (mesh.count !== placements.length) {
      throw new Error(
        `[storeLayout] InstancedMesh "${productId}" count mismatch: ${mesh.count} !== ${placements.length}`,
      );
    }
    scene.add(mesh);
  }
}


// ---------------------------------------------------------------------------
// Checkout counter with till mat + conveyor block.
// ---------------------------------------------------------------------------

function buildCheckoutCounter(
  scene: THREE.Scene,
  bundle: AssetBundle,
  colliders: Aabb[],
  x: number,
  closed: boolean,
): void {
  const counter = bundle.counter.clone(true);
  counter.position.set(x, 0, TILL_Z);
  scene.add(counter);

  const bbox = measureBox(counter);
  const size = bbox.getSize(new THREE.Vector3());
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cz = (bbox.min.z + bbox.max.z) / 2;
  const topY = bbox.max.y;

  const conveyorW = Math.min(CONVEYOR_MAX_W_M, size.x * 0.48);
  const conveyorD = Math.min(CONVEYOR_D_M, size.z * 0.82);
  addBox(
    scene,
    conveyorW,
    CONVEYOR_H_M,
    conveyorD,
    cx + CONVEYOR_X_FRACTION * size.x,
    topY + CONVEYOR_H_M / 2 - CONVEYOR_SINK_M,
    cz,
    lambert(TILL_METAL),
  );
  addBox(
    scene,
    MAT_W_M,
    MAT_H_M,
    MAT_D_M,
    cx + MAT_X_FRACTION * size.x,
    topY + MAT_H_M / 2,
    cz,
    lambert(TILL_MAT),
  );

  colliders.push(footprintCollider(counter));
  if (Math.abs(size.x - COUNTER_W_M) > 0.05) {
    console.warn(`[storeLayout] Counter is ${size.x.toFixed(3)} m wide; storeGeometry assumes ${COUNTER_W_M} m — routes may clip it.`);
  }
  if (closed) buildClosedTill(scene, cx, topY, cz, size.x);
}

/** "KAUNTER DITUTUP" A-frame on the belt plus a dark dummy monitor on a pole. */
function buildClosedTill(scene: THREE.Scene, cx: number, topY: number, cz: number, width: number): void {
  const beltX = cx + CONVEYOR_X_FRACTION * width;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#c62828";
      ctx.fillRect(0, 0, 256, 144);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "900 44px Arial, sans-serif";
      ctx.fillText("KAUNTER", 128, 48, 236);
      ctx.fillText("DITUTUP", 128, 100, 236);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
      // Two boards leaning 15° on each other, reading to both sides of the counter.
      for (const sz of [1, -1]) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.2), mat);
        board.position.set(beltX, topY + CONVEYOR_H_M + 0.1, cz + sz * 0.026);
        board.rotation.x = sz * -0.26;
        if (sz < 0) board.rotation.y = Math.PI;
        scene.add(board);
      }
    }
  } catch {
    // Decorative — the counter reads as closed from the dark monitor alone.
  }
  const dark = lambert("#1f2328");
  addBox(scene, 0.04, 0.35, 0.04, cx + 0.3 * width, topY + 0.175, cz + 0.1, dark);
  addBox(scene, 0.4, 0.3, 0.05, cx + 0.3 * width, topY + 0.5, cz + 0.1, dark);
}

// PASARAYA MESRA sign hanging behind/above the till. Inert.
function buildKedaiSign(scene: THREE.Scene, bundle: AssetBundle): void {
  const signX = CHECKOUT_XS[1];
  // Two planes back to back: reads from the till and from the store floor.
  for (const rotY of [0, Math.PI]) {
    const sign = bundle.signage.kedaiSign.clone(true);
    sign.position.set(signX, TILL_SIGN_Y, TILL_SIGN_Z + (rotY ? -0.005 : 0.005));
    sign.rotation.y = rotY;
    scene.add(sign);
  }

  // Two ceiling rods make the floating sign read as mounted, not hovering.
  const signTopY = TILL_SIGN_Y + KEDAI_SIGN_HEIGHT_M / 2;
  const rodH = WALL_HEIGHT_M - signTopY;
  const rodY = signTopY + rodH / 2;
  const rodMat = lambert(WOOD_DARK);
  for (const side of [-1, 1]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(SIGN_ROD_RADIUS_M, SIGN_ROD_RADIUS_M, rodH, 8), rodMat);
    rod.position.set(signX + side * TILL_SIGN_HALF_WIDTH_M, rodY, TILL_SIGN_Z);
    scene.add(rod);
  }
}

// ---------------------------------------------------------------------------
// Grab pick-up counter + sign (top-right). Inert.
// ---------------------------------------------------------------------------

function buildGrabPickup(scene: THREE.Scene, bundle: AssetBundle, colliders: Aabb[]): void {
  const base = new THREE.Group();
  base.position.set(GRAB.x, 0, GRAB.z);
  base.rotation.y = GRAB.rotY; // customer face (+Z in the model) turns to face east

  const add = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    base.add(mesh);
  };
  // Cream body, dark counter top, Grab-green stripe on the customer face.
  add(GRAB_BASE_W_M, GRAB_BASE_H_M, GRAB_BASE_D_M, 0, GRAB_BASE_H_M / 2, 0, lambert(COUNTER_CREAM));
  add(
    GRAB_BASE_W_M + GRAB_TOP_OVERHANG_M * 2,
    GRAB_TOP_H_M,
    GRAB_BASE_D_M + GRAB_TOP_OVERHANG_M * 2,
    0,
    GRAB_BASE_H_M + GRAB_TOP_H_M / 2,
    0,
    lambert(COUNTER_TOP),
  );
  add(GRAB_STRIPE_W_M, GRAB_STRIPE_H_M, GRAB_STRIPE_D_M, 0, 0.6, GRAB_BASE_D_M / 2 + GRAB_STRIPE_D_M / 2, lambert(GRAB_GREEN));
  // One waiting parcel so the pickup point reads as "alive".
  add(
    GRAB_PARCEL_SIZE_M,
    GRAB_PARCEL_SIZE_M,
    GRAB_PARCEL_SIZE_M,
    GRAB_PARCEL_X_M,
    GRAB_BASE_H_M + GRAB_TOP_H_M + GRAB_PARCEL_SIZE_M / 2,
    0,
    lambert(PARCEL_KRAFT),
  );
  scene.add(base);

  // Sign on the west wall above the counter, facing into the store.
  const sign = bundle.signage.grabSign.clone(true);
  sign.position.set(-GEOMETRY_WIDTH_M / 2 + 0.02, GRAB_SIGN_Y, GRAB.z);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);

  colliders.push(boxCollider(GRAB.x, GRAB.z, GRAB_BASE_D_M + GRAB_TOP_OVERHANG_M * 2, GRAB_BASE_W_M + GRAB_TOP_OVERHANG_M * 2));
}

// ---------------------------------------------------------------------------
// Storeroom door (top-left). Inert.
// ---------------------------------------------------------------------------

function buildStoreroomDoor(scene: THREE.Scene, colliders: Aabb[]): void {
  // DOOR_SLAB_Z is the slab's offset from a wall at z = −7; shift to the back wall.
  const group = new THREE.Group();
  const shiftZ = BACK_Z + 7;
  group.position.set(STAFF_DOOR_X, 0, shiftZ);

  const add = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  // Door slab + dark warm-wood frame, proud of the north wall's inner face.
  add(DOOR_SLAB_W_M, DOOR_SLAB_H_M, DOOR_SLAB_D_M, 0, DOOR_SLAB_H_M / 2, DOOR_SLAB_Z, lambert(DOOR_WOOD));
  add(DOOR_FRAME_POST_W_M, DOOR_FRAME_POST_H_M, DOOR_FRAME_POST_W_M, -(DOOR_SLAB_W_M / 2 + DOOR_FRAME_POST_W_M / 2), DOOR_FRAME_POST_H_M / 2, DOOR_SLAB_Z, lambert(DOOR_FRAME));
  add(DOOR_FRAME_POST_W_M, DOOR_FRAME_POST_H_M, DOOR_FRAME_POST_W_M, DOOR_SLAB_W_M / 2 + DOOR_FRAME_POST_W_M / 2, DOOR_FRAME_POST_H_M / 2, DOOR_SLAB_Z, lambert(DOOR_FRAME));
  add(DOOR_FRAME_HEAD_W_M, DOOR_FRAME_HEAD_H_M, DOOR_FRAME_POST_W_M, 0, DOOR_FRAME_HEAD_Y, DOOR_SLAB_Z, lambert(DOOR_FRAME));
  // Brass knob on the latch side (toward the store centre).
  const knob = new THREE.Mesh(new THREE.SphereGeometry(DOOR_KNOB_RADIUS_M, 12, 8), lambert(KNOB_BRASS));
  knob.position.set(DOOR_KNOB_X_M, DOOR_KNOB_Y_M, DOOR_SLAB_Z + DOOR_SLAB_D_M / 2 + DOOR_KNOB_RADIUS_M * 0.6);
  group.add(knob);

  // Tiny painted stencil plate — system fonts on a canvas, no font files.
  // Canvas failure must not abort the rest of the store build, so skip it.
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = STENCIL_BG;
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = STENCIL_FG;
      ctx.font = "700 64px Arial, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("KAKITANGAN SAHAJA", 256, 68, 492);
      const stencilTexture = new THREE.CanvasTexture(canvas);
      stencilTexture.colorSpace = THREE.SRGBColorSpace;
      stencilTexture.anisotropy = 4;
      const stencil = new THREE.Mesh(
        new THREE.PlaneGeometry(DOOR_STENCIL_W_M, DOOR_STENCIL_H_M),
        new THREE.MeshLambertMaterial({ map: stencilTexture, ...FLAT }),
      );
      stencil.position.set(0, DOOR_STENCIL_Y_M, DOOR_SLAB_Z + DOOR_SLAB_D_M / 2 + 0.006);
      group.add(stencil);
    }
  } catch {
    // Stencil is decorative — the door reads fine without it.
  }

  scene.add(group);
  colliders.push(boxCollider(STAFF_DOOR_X, shiftZ + DOOR_SLAB_Z, DOOR_FRAME_HEAD_W_M + 0.1, DOOR_SLAB_D_M + 0.16));
}

// ---------------------------------------------------------------------------
// Break-area bench (bottom-left). Inert.
// ---------------------------------------------------------------------------

function buildBench(scene: THREE.Scene, colliders: Aabb[]): void {
  const bench = new THREE.Group();
  bench.position.set(BENCH.x, 0, BENCH.z);
  bench.rotation.y = BENCH.rotY;

  const wood = lambert(WOOD_COLOR);
  const dark = lambert(WOOD_DARK);
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    bench.add(mesh);
  };
  // Faces north (-Z) into the store; backrest on the south edge.
  for (const side of [-1, 1]) {
    add(BENCH_LEG_W_M, BENCH_LEG_H_M, BENCH_LEG_D_M, side * BENCH_LEG_X_M, BENCH_LEG_H_M / 2, 0, dark);
    add(BENCH_BACK_POST_W_M, BENCH_BACK_POST_H_M, BENCH_BACK_POST_W_M, side * BENCH_BACK_POST_X_M, BENCH_BACK_Y_M, BENCH_BACK_POST_Z_M, dark);
  }
  add(BENCH_SEAT_W_M, BENCH_SEAT_H_M, BENCH_SEAT_D_M, 0, BENCH_SEAT_Y_M, 0, wood);
  add(BENCH_BACKREST_W_M, BENCH_BACKREST_H_M, BENCH_BACKREST_D_M, 0, BENCH_BACKREST_Y_M, BENCH_BACKREST_Z_M, wood);
  scene.add(bench);

  colliders.push(boxCollider(BENCH.x, BENCH.z, BENCH_SEAT_D_M + 0.15, BENCH_SEAT_W_M + 0.1));
}

// ---------------------------------------------------------------------------
// Gondola runs — procedural units from gondola.ts, cloned per run.
// ---------------------------------------------------------------------------

function buildGondolas(scene: THREE.Scene, colliders: Aabb[]): void {
  const double = buildRunMeshes("double");
  const wall = buildRunMeshes("wall");
  for (const run of RUNS) {
    const z = (run.minZ + run.maxZ) / 2;
    for (const x of GONDOLA_XS) {
      const g = double.clone();
      g.position.set(x, 0, z);
      scene.add(g);
    }
    WALL_RUN_BACK_XS.forEach((x) => {
      const g = wall.clone();
      g.position.set(x, 0, z);
      if (x > 0) g.rotation.y = Math.PI; // east wall run faces −X
      scene.add(g);
    });
  }
  // Run colliders come from the shared footprint table (the first entries).
  const runCount = RUNS.length * (GONDOLA_XS.length + WALL_RUN_BACK_XS.length);
  colliders.push(...solidFootprints().slice(0, runCount));
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function buildStore(scene: THREE.Scene, bundle: AssetBundle): Aabb[] {
  const colliders: Aabb[] = [...makeWallBoxes(STORE_WIDTH_M, STORE_DEPTH_M, WALL_THICKNESS_M)];

  // Gondolas: 7 double-sided runs per run band + one wall run on each side wall.
  buildGondolas(scene, colliders);

  stockRuns(scene, bundle);

  // Till + hanging PASARAYA MESRA sign (bottom-centre).
  CHECKOUT_XS.forEach((x, i) => buildCheckoutCounter(scene, bundle, colliders, x, i > 0));
  buildKedaiSign(scene, bundle);

  // Grab pick-up counter (top-right), storeroom door (top-left), bench (bottom-left).
  buildGrabPickup(scene, bundle, colliders);
  buildStoreroomDoor(scene, colliders);
  buildBench(scene, colliders);

  // Entrance (north wall gap, top-centre) intentionally stays clear —
  // the shell's dark void plane reads as the doorway into the stockroom.
  return colliders;
}
