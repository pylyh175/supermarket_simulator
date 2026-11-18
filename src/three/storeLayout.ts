// Store layout build-out: shelves, till, signage and inert props on top of
// the shell from storeShell.ts. buildStore() adds every prop to `scene` and
// returns the MERGED collider list (shell walls + every prop) for the
// FpsController.
//
// Interior plan (metres, interior opening centred on the origin):
//
//   z = -7   [storeroom door]  [entrance doorway]  [Grab pickup counter]
//   z ≈ -5   [aisle row A tall] … [aisle row D tall]   rows run along Z,
//   z ≈  0   aisle ends                              length ROW_LENGTH_M
//   z ≈  1.8  KEDAI RUNCIT sign (hanging)
//   z ≈  3.1  checkout counter (till) facing the spawn
//   z = +4   spawn (see FpsController) — faces the till
//   z ≈  5.4 [break bench, bottom-left]
//
// "Top" of a plan = -Z (the doorway/entrance side); "bottom" = +Z (spawn
// side). Entrance stays clear; every other prop is solid. No prompts, no
// interactions — everything here is inert scenery.
import * as THREE from "three";
import { makeWallBoxes, type Aabb } from "../player/colliders";
import {
  STORE_WIDTH_M,
  STORE_DEPTH_M,
  WALL_THICKNESS_M,
  WALL_HEIGHT_M,
} from "./storeShell";
import type { AssetBundle } from "./assets";

// ---------------------------------------------------------------------------
// Layout constants — named, no magic numbers.
// ---------------------------------------------------------------------------

// Aisle shelf rows (double-sided, length stretched along Z).
const ROW_LENGTH_M = 5.4;
const ROW_CENTER_Z = -2.5;
const ROW_X_POSITIONS: readonly number[] = [-6.75, -2.25, 2.25, 6.75];
/** Index into ROW_X_POSITIONS that uses the low archetype (open sightline). */
const LOW_ROW_INDEX = 1;
const ROW_STOCK_MARGIN_M = 0.4;   // keep products clear of the end panels/posts
const ROW_SIDE_OFFSET_M = 0.14;   // product centre offset from the row centre plane
const SLOT_SPACING_M = 0.62;
/** Raycast must start above the tallest shelf board and clear the 2 m cap. */
const ROW_TOP_RAY_Y = 3.0;
/** Boards whose top is within this of the shelf cap are left bare (too high). */
const ROW_TOP_EXCLUDE_M = 0.38;
const BOARD_CLUSTER_EPSILON_M = 0.03;
/** Roughly one empty slot in eleven — shelves read "stocked, not shrink-wrapped". */
const STOCK_SKIP_MOD = 11;

// Checkout counter + till (bottom-centre, facing the spawn). Exported so the
// customer flow and the till station zone anchor to the same spot.
export const TILL_X = 0;
export const TILL_Z = 3.05;
const TILL_SIGN_Y = 2.42;
const TILL_SIGN_Z = 1.77;
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

// KEDAI RUNCIT sign, hanging from the ceiling above/behind the till.
const KEDAI_SIGN_HEIGHT_M = 0.995;        // matches the kedaiSign plane built in assets.ts
const SIGN_ROD_RADIUS_M = 0.02;

// Grab pick-up counter (top-right, against the north wall). Inert.
const GRAB_X = 8.0;
const GRAB_Z = -5.55;
const GRAB_BASE_W_M = 1.35;
const GRAB_BASE_H_M = 0.78;
const GRAB_BASE_D_M = 0.55;
const GRAB_TOP_OVERHANG_M = 0.05;
const GRAB_TOP_H_M = 0.06;
const GRAB_STRIPE_W_M = 1.2;
const GRAB_STRIPE_H_M = 0.14;
const GRAB_STRIPE_D_M = 0.02;
const GRAB_SIGN_Y = 2.15;
const GRAB_SIGN_Z = -6.78;
const GRAB_PARCEL_SIZE_M = 0.34;
const GRAB_PARCEL_X_M = -0.35;             // parcel on the left of the counter top

// Storeroom door (top-left, on the north wall). Inert.
const DOOR_X = -8.2;
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
const BENCH_X = -8.2;
const BENCH_Z = 5.35;
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
// Shelf rows — stretch a cloned archetype along Z, stock with products.
// ---------------------------------------------------------------------------

const DOWN = new THREE.Vector3(0, -1, 0);

function stockShelfRow(
  scene: THREE.Scene,
  row: THREE.Object3D,
  rowHeight: number,
  rowIndex: number,
  bundle: AssetBundle,
  cursor: { value: number },
): void {
  const products = [...bundle.products.values()];
  if (products.length === 0) return;

  const usable = ROW_LENGTH_M - 2 * ROW_STOCK_MARGIN_M;
  const slotCount = Math.floor(usable / SLOT_SPACING_M);
  const slotSpan = (slotCount - 1) * SLOT_SPACING_M;
  const ray = new THREE.Raycaster();
  ray.far = ROW_TOP_RAY_Y;
  const boardLimitY = rowHeight - ROW_TOP_EXCLUDE_M;

  for (let slot = 0; slot < slotCount; slot += 1) {
    const slotOffset = slot * SLOT_SPACING_M - slotSpan / 2;
    // rotation.y = π/2 maps local +X to world -Z, so walk world -Z as local +X grows.
    const worldZ = ROW_CENTER_Z - slotOffset;

    ray.set(new THREE.Vector3(ROW_X_POSITIONS[rowIndex], ROW_TOP_RAY_Y, worldZ), DOWN);
    const hits = ray.intersectObject(row, true);

    // Cluster hit heights (several faces of one board land within an epsilon).
    const boardYs: number[] = [];
    for (const hit of hits) {
      const y = hit.point.y;
      if (y > boardLimitY) continue;
      if (boardYs.some((b) => Math.abs(b - y) < BOARD_CLUSTER_EPSILON_M)) continue;
      boardYs.push(y);
    }

    for (let board = 0; board < boardYs.length; board += 1) {
      for (const side of [1, -1] as const) {
        // Deterministic thinning so the shelves look stocked, not shrink-wrapped.
        const stamp = slot * 31 + board * 7 + (side > 0 ? 0 : 1) + rowIndex * 13;
        if (stamp % STOCK_SKIP_MOD === 0) continue;
        const product = products[cursor.value % products.length].clone(true);
        cursor.value += 1;
        // Side = +1 → east face (+X): product must face outward (+X).
        product.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        product.position.set(
          ROW_X_POSITIONS[rowIndex] + side * ROW_SIDE_OFFSET_M,
          boardYs[board] + 0.002,
          worldZ,
        );
        scene.add(product);
      }
    }
  }
}

function buildShelfRow(
  scene: THREE.Scene,
  archetype: THREE.Group,
  rowIndex: number,
  colliders: Aabb[],
  bundle: AssetBundle,
  stockCursor: { value: number },
): void {
  const row = archetype.clone(true);
  const rawLength = measureBox(row).getSize(new THREE.Vector3()).x;
  if (!Number.isFinite(rawLength) || rawLength <= 1e-4) {
    console.warn("[storeLayout] Shelf archetype has no measurable width — row skipped.");
    return;
  }
  row.scale.x = ROW_LENGTH_M / rawLength;
  row.rotation.y = Math.PI / 2;
  row.position.set(ROW_X_POSITIONS[rowIndex], 0, ROW_CENTER_Z);
  scene.add(row);

  const height = measureBox(row).getSize(new THREE.Vector3()).y;
  colliders.push(footprintCollider(row));
  stockShelfRow(scene, row, height, rowIndex, bundle, stockCursor);
}

// ---------------------------------------------------------------------------
// Checkout counter with till mat + conveyor block.
// ---------------------------------------------------------------------------

function buildCheckoutCounter(
  scene: THREE.Scene,
  bundle: AssetBundle,
  colliders: Aabb[],
): void {
  const counter = bundle.counter.clone(true);
  counter.position.set(TILL_X, 0, TILL_Z);
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
}

// KEDAI RUNCIT sign hanging behind/above the till. Inert.
function buildKedaiSign(scene: THREE.Scene, bundle: AssetBundle): void {
  const sign = bundle.signage.kedaiSign.clone(true);
  sign.position.set(TILL_X, TILL_SIGN_Y, TILL_SIGN_Z);
  scene.add(sign); // plane faces +Z — reads from the spawn/till queue

  // Two ceiling rods make the floating sign read as mounted, not hovering.
  const signTopY = TILL_SIGN_Y + KEDAI_SIGN_HEIGHT_M / 2;
  const rodH = WALL_HEIGHT_M - signTopY;
  const rodY = signTopY + rodH / 2;
  const rodMat = lambert(WOOD_DARK);
  for (const side of [-1, 1]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(SIGN_ROD_RADIUS_M, SIGN_ROD_RADIUS_M, rodH, 8), rodMat);
    rod.position.set(TILL_X + side * TILL_SIGN_HALF_WIDTH_M, rodY, TILL_SIGN_Z);
    scene.add(rod);
  }
}

// ---------------------------------------------------------------------------
// Grab pick-up counter + sign (top-right). Inert.
// ---------------------------------------------------------------------------

function buildGrabPickup(scene: THREE.Scene, bundle: AssetBundle, colliders: Aabb[]): void {
  const base = new THREE.Group();
  base.position.set(GRAB_X, 0, GRAB_Z);

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

  const sign = bundle.signage.grabSign.clone(true);
  sign.position.set(GRAB_X, GRAB_SIGN_Y, GRAB_SIGN_Z);
  scene.add(sign);

  colliders.push(boxCollider(GRAB_X, GRAB_Z, GRAB_BASE_W_M + GRAB_TOP_OVERHANG_M * 2, GRAB_BASE_D_M + GRAB_TOP_OVERHANG_M * 2));
}

// ---------------------------------------------------------------------------
// Storeroom door (top-left). Inert.
// ---------------------------------------------------------------------------

function buildStoreroomDoor(scene: THREE.Scene, colliders: Aabb[]): void {
  const group = new THREE.Group();
  group.position.set(DOOR_X, 0, 0);

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
      ctx.fillText("STOREROOM", 256, 68);
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
  colliders.push(boxCollider(DOOR_X, DOOR_SLAB_Z, DOOR_FRAME_HEAD_W_M + 0.1, DOOR_SLAB_D_M + 0.16));
}

// ---------------------------------------------------------------------------
// Break-area bench (bottom-left). Inert.
// ---------------------------------------------------------------------------

function buildBench(scene: THREE.Scene, colliders: Aabb[]): void {
  const bench = new THREE.Group();
  bench.position.set(BENCH_X, 0, BENCH_Z);

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

  colliders.push(boxCollider(BENCH_X, BENCH_Z, BENCH_SEAT_W_M + 0.1, BENCH_SEAT_D_M + 0.15));
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function buildStore(scene: THREE.Scene, bundle: AssetBundle): Aabb[] {
  const colliders: Aabb[] = [...makeWallBoxes(STORE_WIDTH_M, STORE_DEPTH_M, WALL_THICKNESS_M)];

  // Shelves: 4 double-sided rows; one low archetype for a clear sightline.
  const tallShelf = bundle.shelves[0];
  const lowShelf = bundle.shelves[1] ?? bundle.shelves[0];
  if (tallShelf) {
    const stockCursor = { value: 0 };
    for (let i = 0; i < ROW_X_POSITIONS.length; i += 1) {
      const archetype = i === LOW_ROW_INDEX ? lowShelf : tallShelf;
      if (!archetype) continue; // bundle always ships 2 shelves; stay defensive
      buildShelfRow(scene, archetype, i, colliders, bundle, stockCursor);
    }
  } else {
    console.warn("[storeLayout] Asset bundle has no shelves — aisle rows skipped.");
  }

  // Till + hanging KEDAI RUNCIT sign (bottom-centre).
  buildCheckoutCounter(scene, bundle, colliders);
  buildKedaiSign(scene, bundle);

  // Grab pick-up counter (top-right), storeroom door (top-left), bench (bottom-left).
  buildGrabPickup(scene, bundle, colliders);
  buildStoreroomDoor(scene, colliders);
  buildBench(scene, colliders);

  // Entrance (north wall gap, top-centre) intentionally stays clear —
  // the shell's dark void plane reads as the doorway into the stockroom.
  return colliders;
}
