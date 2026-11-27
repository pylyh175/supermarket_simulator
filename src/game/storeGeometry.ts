/**
 * Store geometry — every layout number for the 28 × 20 m pasaraya, in one
 * pure module (no three.js). The shell, shelves, planogram, customer routes,
 * player controller and till zone all read from here so they cannot drift.
 *
 * Plan view (metres, interior centred on the origin; forward = −Z):
 *
 *   z = −10  back wall (staff door east; stage 2 chillers)
 *   z ≈ −8   back cross-aisle
 *   z −6.9..−3.15   back runs   (7 gondolas + 2 wall runs)
 *   z ≈ −2.25 middle cross-aisle
 *   z −1.35..2.4    front runs
 *   z ≈ 3.6  front cross-aisle, then the queue area
 *   z = 7    checkout counters (cashier on the +Z side, facing −Z)
 *   z = +10  front wall: glass shopfront, door at the west end
 */
import type { Aabb } from "../player/colliders";

export const STORE_WIDTH_M = 28;
export const STORE_DEPTH_M = 20;
export const WALL_THICKNESS_M = 0.4;
export const CEILING_HEIGHT_M = 4.2;
export const FRONT_Z = STORE_DEPTH_M / 2;
export const BACK_Z = -STORE_DEPTH_M / 2;

/** Gap in the front wall (front-left as a shopper walks in). */
export const DOOR = { x: -11.2, widthM: 2.4, heightM: 2.5 } as const;

// ---------------------------------------------------------------------------
// Shelving
// ---------------------------------------------------------------------------

/** Double-sided gondola centre planes, west → east. */
export const GONDOLA_XS: readonly number[] = [-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4];
/** Back-panel plane of each wall run; the west run faces +X, the east run −X. */
export const WALL_RUN_BACK_XS: readonly number[] = [-13.98, 13.98];
/** Centre plane (or back panel) to shelf lip. */
export const FACE_HALF_M = 0.44;
/** Depth budget for pack rows on one side (leaves 1 cm off the back panel). */
export const STOCK_DEPTH_M = 0.43;

export const BAY_W_M = 1.25;
export const BAYS_PER_RUN = 3;
export const UPRIGHT_W_M = 0.04;
export const BAY_STOCK_MARGIN_M = 0.01;
/** Stockable width of one bay face. */
export const FACE_USABLE_M = BAY_W_M - UPRIGHT_W_M - 2 * BAY_STOCK_MARGIN_M;

export type RunId = "back" | "front";
export const RUNS: readonly { id: RunId; minZ: number; maxZ: number }[] = [
  { id: "back", minZ: -6.9, maxZ: -6.9 + BAYS_PER_RUN * BAY_W_M },
  { id: "front", minZ: -1.35, maxZ: -1.35 + BAYS_PER_RUN * BAY_W_M },
];

export const CROSS_AISLE_Z = { front: 3.6, middle: -2.25, back: -8.05 } as const;

/** Board top surfaces, bottom deck → top shelf. */
export const SHELF_YS: readonly number[] = [0.15, 0.53, 0.91, 1.29, 1.67];
export const BOARD_T_M = 0.025;
export const UNIT_HEIGHT_M = 2.1;
export const KICK_H_M = 0.15;

/** Free height above a shelf: up to the next board's underside (or the unit top). */
export function shelfClearanceM(shelfIndex: number): number {
  const y = SHELF_YS[shelfIndex];
  const next = SHELF_YS[shelfIndex + 1];
  return next === undefined ? UNIT_HEIGHT_M - y : next - BOARD_T_M - y;
}

export function runById(run: RunId): { id: RunId; minZ: number; maxZ: number } {
  return RUNS.find((r) => r.id === run)!;
}

/** Bay centre z values of a run, north → south. */
export function bayCenterZs(run: RunId): number[] {
  const { minZ } = runById(run);
  return Array.from({ length: BAYS_PER_RUN }, (_, k) => minZ + BAY_W_M * (k + 0.5));
}

// ---------------------------------------------------------------------------
// Checkouts
// ---------------------------------------------------------------------------

/** The player's counter — nearest the entrance. */
export const TILL_X = -7.0;
export const TILL_Z = 7.0;
export const CHECKOUT_PITCH_M = 3.2;
export const CHECKOUT_XS: readonly number[] = [TILL_X, TILL_X + CHECKOUT_PITCH_M, TILL_X + 2 * CHECKOUT_PITCH_M];
/** kitchenBar GLB scaled to 0.95 m tall (storeLayout warns if the model differs). */
export const COUNTER_W_M = 0.973;
export const COUNTER_D_M = 0.475;
const STAND_W_M = 0.62;
const STAND_D_M = 0.52;
/** POS stand centre, east of the counter centre (cashier's right). */
export const STAND_OFFSET_X_M = COUNTER_W_M / 2 + 0.06 + STAND_W_M / 2;
const STAND_OFFSET_Z_M = 0.12;

/** Start of day: behind the till, facing the counter (yaw 0). */
export const SPAWN = { x: TILL_X, z: TILL_Z + 1.2 } as const;

/** Where E serves (cashier side of the player's counter). */
export const TILL_ZONE: Aabb = { minX: TILL_X - 0.95, maxX: TILL_X + 0.95, minZ: TILL_Z + 0.5, maxZ: TILL_Z + 1.9 };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Grab pick-up counter against the west wall, facing into the store (east). */
export const GRAB = { x: -13.72, z: 5.0, rotY: Math.PI / 2 } as const;
/** Bench against the west wall near the door, facing east (the model faces −Z). */
export const BENCH = { x: -13.7, z: 7.6, rotY: -Math.PI / 2 } as const;
/** Staff door slab on the back wall. */
export const STAFF_DOOR_X = 11.0;

const box = (cx: number, cz: number, w: number, d: number): Aabb => ({
  minX: cx - w / 2,
  maxX: cx + w / 2,
  minZ: cz - d / 2,
  maxZ: cz + d / 2,
});

/** Every solid on the floor plan, as XZ boxes (colliders and route checks). */
export function solidFootprints(): Aabb[] {
  const out: Aabb[] = [];
  for (const run of RUNS) {
    for (const x of GONDOLA_XS) out.push({ minX: x - 0.46, maxX: x + 0.46, minZ: run.minZ, maxZ: run.maxZ });
    for (const back of WALL_RUN_BACK_XS) {
      const lip = back + Math.sign(-back) * (FACE_HALF_M + 0.02);
      out.push({ minX: Math.min(back, lip), maxX: Math.max(back, lip), minZ: run.minZ, maxZ: run.maxZ });
    }
  }
  for (const x of CHECKOUT_XS) out.push(box(x, TILL_Z, COUNTER_W_M, COUNTER_D_M));
  out.push(box(TILL_X + STAND_OFFSET_X_M, TILL_Z + STAND_OFFSET_Z_M, STAND_W_M, STAND_D_M));
  out.push(box(GRAB.x, GRAB.z, 0.55, 1.35));
  out.push(box(BENCH.x, BENCH.z, 0.6, 1.9));
  return out;
}
