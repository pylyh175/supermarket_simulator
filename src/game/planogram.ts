/**
 * Pure planogram layer for the supermarket simulation.
 *
 * This module decides WHICH products stand WHERE on the shelf boards — no
 * Three.js, no DOM, no hidden state. Everything is derived from the tables
 * below and the `PRODUCTS` catalog. Task 2 (storeLayout) consumes
 * `computePlacements` to clone product archetypes into the scene; keeping the
 * math three-free means it stays unit-testable.
 *
 * Layout context (see src/three/storeLayout.ts):
 *   - interior 20 m (x −10..10) × 14 m (z −7..7); aisle rows run along Z at
 *     x = −6.75, −2.25, 2.25, 6.75, length ROW_LENGTH_M (5.4 m).
 *   - usable face = ROW_LENGTH_M − 2 × ROW_STOCK_MARGIN_M = 4.6 m — mirrored
 *     here as FACE_USABLE_M (storeLayout imports three, so it cannot be
 *     imported from this pure module).
 *   - row index 1 is the low archetype; tall rows stock 3 boards × 2 sides,
 *     the low row 1 board × 2 sides → 18 + 2 = 20 faces.
 *
 * Pack sizes and units-per-facing are derived from the shared pure table
 * in src/data/packSpecs.ts (the same table the 3D pack builder reads).
 *
 * Planogram design (documented judgment calls, per the task brief):
 *   - PLANOGRAM is built from FACE_PLAN (one category group per face) by
 *     fillFaceList: greedy cycling, then a 1 mm knapsack over the group +
 *     small filler packs so every face reaches ≥ 96 % fill.
 *   - 20 faces are enumerated row-major (row → board → side) by
 *     FACE_ENUMERATION; faceIndex % PLANOGRAM.length selects the SKU list.
 *     sideIndex 0 = the front face (fills −z → +z), sideIndex 1 = the back
 *     face (fills +z → −z, mirrored so both aisles read left-to-right the
 *     same). `computePlacements(face: "front" | "back", side: 1 | -1)` maps
 *     front ≙ sideIndex 0, back ≙ sideIndex 1; `side` is the x sign of the
 *     face normal (side 1 = +x / east face, rotationY = +π/2).
 *
 * Fill rules:
 *   - Greedy: walk the SKU list, pack each SKU into one facing of
 *     UNITS_WIDE[sku] packs side by side; facing width = UNITS_WIDE × pack
 *     width. A ~0.1 m gap (FACING_GAP_M) separates facings; units inside a
 *     facing sit flush (zero gap).
 *   - Greedy skips a SKU whose facing does not fit the remaining span and
 *     keeps walking — a later, smaller SKU is still placed when it fits; the
 *     walk only ends when every remaining list entry has been tried (or the
 *     list is exhausted). Never overflows the face.
 *   - Depth is auto-clamped per SKU to one half-board: the largest d ∈ {3,2,1}
 *     with d × packDepth + (d − 1) × GAP_M ≤ FACE_HALF_M (0.25 m, board is
 *     0.5 m deep, centred on the row centre plane). PACK_DEPTH_TWO_M is kept
 *     verbatim from the brief for contract continuity but no longer drives
 *     depth.
 *   - Any pack deeper than a half-board is placed 1-DEEP flush with the
 *     INNER edge on the row centre plane (x = rowX ± packDepth/2):
 *     roti-canai-frozen (0.28 m) overhangs the board's front lip toward the
 *     customer and NEVER crosses into the opposite face's half.
 *   - Containment guarantee: normal rows sit at
 *     x_j = side × (FACE_HALF_M − packDepth/2 − j × (packDepth + GAP_M)),
 *     which keeps each row's inner face at x ≥ 0 relative to the row centre
 *     plane for side +1 (mirrored for −1); overhang packs sit at
 *     x = side × packDepth/2 (inner face exactly on the centre plane). The
 *     two faces of a double-sided board never share space. (Front row's
 *     outer face is flush with the board lip.)
 *   - Fill ratio for the tables above: 97.5 %–100 % (see tests).
 */
import { PRODUCTS } from "../data/products";
import { FALLBACK_PACK_SPEC, PACK_SPECS, unitsWideFor } from "../data/packSpecs";

// ---------------------------------------------------------------------------
// Interfaces (task-brief contract).
// ---------------------------------------------------------------------------

export interface Facing {
  skuId: string;
  /** Front-to-back extent of the facing: depth × pack depth + (depth − 1) × GAP_M, in metres. */
  lengthM: number;
  /** Pack rows deep, 1–3; auto-clamped to one half-board (see FACE_HALF_M / GAP_M). */
  depth: 1 | 2 | 3;
  /** widthM = UNITS_WIDE[skuId] × pack width of the SKU, in metres. */
  widthM: number;
}

/**
 * Per-facing render metadata, reserved for the shelf view (Task 2 may use it
 * to drive signage / hover text). Placement itself is computed by fill, not
 * from this interface.
 */
export interface BoardFace {
  unitsWide: number;
}

export interface Placement {
  skuId: string;
  x: number;
  y: number;
  z: number;
  depth: 1 | 2 | 3;
  rotationY: number;
}

// ---------------------------------------------------------------------------
// Named constants.
// ---------------------------------------------------------------------------

/**
 * Kept verbatim from the task brief for contract continuity. Depth is no
 * longer derived from this constant (see the per-SKU clamp in the header).
 */
export const PACK_DEPTH_TWO_M = 0.20;
/** Board half-depth: the board is 0.5 m deep, 0.25 m per side of the row centre plane. */
export const FACE_HALF_M = 0.25;
/** Gap between depth rows within a facing (keeps unit rows readable). */
export const GAP_M = 0.005;
/** ~0.1 m gap between facings (units inside a facing sit flush). */
export const FACING_GAP_M = 0.1;
/** Usable face width — mirrors ROW_LENGTH_M − 2 × ROW_STOCK_MARGIN_M. */
export const FACE_USABLE_M = 4.6;
/** Minimum acceptable fill ratio for hand-authored face lists. */
export const MIN_FACE_FILL_RATIO = 0.96;
/** Lift products a hair off the board top to avoid z-fighting. */
export const PACK_Y_EPSILON_M = 0.002;
/** Stocked boards per tall row (top boards are excluded as too high). */
export const TALL_ROW_BOARD_COUNT = 3;
/** Low row: a single stocked board keeps the open sightline. */
export const LOW_ROW_BOARD_COUNT = 1;
/** Boards per row index 0..3 (index 1 is the low row). */
export const ROW_BOARD_COUNTS: readonly number[] = [
  TALL_ROW_BOARD_COUNT,
  LOW_ROW_BOARD_COUNT,
  TALL_ROW_BOARD_COUNT,
  TALL_ROW_BOARD_COUNT,
];

/** Fit tolerance for the greedy fill (metres) — absorbs float dust at 4.6 m. */
const FIT_EPSILON_M = 1e-6;

// ---------------------------------------------------------------------------
// Pack sizes + units per facing — derived from the shared pure pack table
// (src/data/packSpecs.ts), so the planogram never drifts from the 3D packs.
// ---------------------------------------------------------------------------
export const SKU_PACK_SIZE_M: Record<string, readonly [number, number, number]> = Object.fromEntries(
  PRODUCTS.map((p) => [p.id, (PACK_SPECS[p.id] ?? FALLBACK_PACK_SPEC).size]),
);

/** Units per SKU across a facing — narrow packs more, wide packs fewer. */
export const UNITS_WIDE: Record<string, number> = Object.fromEntries(
  PRODUCTS.map((p) => [p.id, unitsWideFor(PACK_SPECS[p.id] ?? FALLBACK_PACK_SPEC)]),
);

/**
 * Category plan, one SKU group per board face (20 faces, row-major — see
 * FACE_ENUMERATION). Row 0 = drinks & dairy, row 1 (low) = rice / oil /
 * sugar, row 2 = noodles, bread, condiments, snacks, row 3 = household,
 * eggs and frozen.
 */
const FACE_PLAN: readonly (readonly string[])[] = [
  // Row 0 (x = −6.75, tall): beverages & dairy
  ["isotonic-1-5l", "mineral-1-5l", "sirap-ros-2l"],
  ["mineral-1-5l", "isotonic-1-5l", "soya-1l"],
  ["milo-400g", "kopi-3in1", "teh-tarik-3in1"],
  ["susu-fullcream", "soya-1l", "susu-pekat"],
  ["kopi-3in1", "teh-tarik-3in1", "milo-400g", "susu-pekat"],
  ["butter-250g", "susu-pekat", "milo-400g"],
  // Row 1 (x = −2.25, low): heavy staples
  ["beras-5kg", "minyak-2kg", "gula-1kg"],
  ["beras-5kg", "tepung-1kg", "garam-500g", "minyak-2kg"],
  // Row 2 (x = 2.25, tall): noodles, bread, condiments, snacks
  ["maggi-curry", "mi-ayam-5pk", "mee-hoon"],
  ["roti-putih", "kaya-pandan", "kuih-bahulu", "nasi-lemak-bungkus"],
  ["kicap-manis", "sos-cili", "sambal-bilis"],
  ["sardin-425g", "belacan-250g", "ikan-bilis-200g"],
  ["cream-crackers", "keropok-ikan", "kuih-bahulu"],
  ["maggi-curry", "mi-ayam-5pk", "roti-canai-frozen"],
  // Row 3 (x = 6.75, tall): household, eggs, frozen
  ["detergent-1-8kg", "tisu-tandas-10"],
  ["tisu-tandas-10", "pencuci-pinggan", "detergent-1-8kg"],
  ["telur-30-tray", "telur-10pk", "roti-canai-frozen"],
  ["soap-bar", "ubat-gigi", "bicarbonate-250g", "pencuci-pinggan"],
  ["gula-1kg", "tepung-1kg", "garam-500g", "minyak-2kg"],
  ["soap-bar", "ubat-gigi", "bicarbonate-250g", "keropok-ikan"],
];

/** Small packs allowed to top up a face's last gap. */
const FILLER_SKUS: readonly string[] = [
  "soap-bar", "bicarbonate-250g", "garam-500g", "susu-pekat", "belacan-250g", "ubat-gigi",
];

function facingWidthM(skuId: string): number {
  return UNITS_WIDE[skuId] * SKU_PACK_SIZE_M[skuId][0];
}

/**
 * Turn a face's SKU group into a list the greedy fill packs to ≥ 96 %:
 * cycle the group greedily until ~2.6 m remains, then solve the tail as a
 * tiny unbounded knapsack (1 mm resolution) over the group + filler packs.
 * Every chosen facing fits by construction, so computeFacings reproduces it.
 */
function fillFaceList(group: readonly string[]): string[] {
  const list: string[] = [];
  let cursor = 0;
  const TAIL_M = 2.6;
  let index = 0;
  while (FACE_USABLE_M - cursor > TAIL_M) {
    const sku = group[index % group.length];
    index += 1;
    list.push(sku);
    cursor += facingWidthM(sku) + FACING_GAP_M;
  }
  // Capacity includes the trailing gap the last facing doesn't need.
  const candidates = [...new Set([...group, ...FILLER_SKUS])];
  const capacityMm = Math.floor((FACE_USABLE_M - cursor + FACING_GAP_M) * 1000 + 1e-6);
  const weights = candidates.map((sku) => Math.ceil((facingWidthM(sku) + FACING_GAP_M) * 1000 - 1e-6));
  const best = new Array<number>(capacityMm + 1).fill(0);
  const choice = new Array<number>(capacityMm + 1).fill(-1);
  for (let c = 1; c <= capacityMm; c += 1) {
    best[c] = best[c - 1];
    choice[c] = -2; // inherit from c − 1
    for (let k = 0; k < candidates.length; k += 1) {
      const w = weights[k];
      if (w <= c && best[c - w] + w > best[c]) {
        best[c] = best[c - w] + w;
        choice[c] = k;
      }
    }
  }
  const tail: string[] = [];
  let c = capacityMm;
  while (c > 0) {
    const k = choice[c];
    if (k === -2) {
      c -= 1;
      continue;
    }
    if (k < 0) break;
    tail.push(candidates[k]);
    c -= weights[k];
  }
  // Group SKUs first, fillers last — reads tidier on the shelf.
  const isFiller = (sku: string): number => (group.includes(sku) ? 0 : 1);
  tail.sort((a, b) => isFiller(a) - isFiller(b));
  return [...list, ...tail];
}

/**
 * The planogram: one list per board face (faceIndex % PLANOGRAM.length), each
 * packed to ≥ MIN_FACE_FILL_RATIO by fillFaceList. All catalog SKUs appear.
 */
export const PLANOGRAM: string[][] = FACE_PLAN.map(fillFaceList);

// ---------------------------------------------------------------------------
// Face enumeration (deterministic, row-major).
// ---------------------------------------------------------------------------

export interface FaceSlot {
  /** 0..19, row-major: row → board → side. */
  faceIndex: number;
  rowIndex: number;
  /** Index into the row's stocked boards (tall: 0..2, low: 0). */
  boardIndex: number;
  /** 0 = front (fills −z → +z), 1 = back (fills +z → −z, mirrored). */
  sideIndex: 0 | 1;
  face: "front" | "back";
}

function buildFaceEnumeration(): FaceSlot[] {
  const slots: FaceSlot[] = [];
  let faceIndex = 0;
  for (let rowIndex = 0; rowIndex < ROW_BOARD_COUNTS.length; rowIndex += 1) {
    for (let boardIndex = 0; boardIndex < ROW_BOARD_COUNTS[rowIndex]; boardIndex += 1) {
      for (const sideIndex of [0, 1] as const) {
        slots.push({
          faceIndex,
          rowIndex,
          boardIndex,
          sideIndex,
          face: sideIndex === 0 ? "front" : "back",
        });
        faceIndex += 1;
      }
    }
  }
  return slots;
}

/**
 * The store's 20 board faces, enumerated row-major (row → board → side).
 * Tall rows stock 3 boards × 2 sides each; the low row (index 1) stocks 1
 * board × 2 sides. The row's SKU list is `PLANOGRAM[faceIndex % PLANOGRAM.length]`.
 */
export const FACE_ENUMERATION: readonly FaceSlot[] = buildFaceEnumeration();

// ---------------------------------------------------------------------------
// Facings (greedy fill across the face).
// ---------------------------------------------------------------------------

/**
 * Greedy fill: walk `faceSkus` in order; pack each SKU into a facing of
 * UNITS_WIDE[skuId] units side by side (facing width = UNITS_WIDE × pack
 * width) separated by FACING_GAP_M. Depth is auto-clamped per SKU (largest
 * d ∈ {3,2,1} with d × packDepth + (d − 1) × GAP_M ≤ FACE_HALF_M; packs
 * deeper than a half-board go 1-deep, flush with the centre plane — see the
 * module header). A SKU whose facing does not fit the remaining span is
 * SKIPPED, not fatal: the walk keeps going so a later, smaller SKU is placed
 * when it fits, and ends when the list is exhausted. Never overflows the
 * face.
 */
export function computeFacings(faceSkus: string[], usableM: number): Facing[] {
  const facings: Facing[] = [];
  if (!Number.isFinite(usableM) || usableM <= 0) return facings;

  let cursor = 0; // occupied width so far, including inter-facing gaps
  for (const skuId of faceSkus) {
    const unitsWide = UNITS_WIDE[skuId];
    const size = SKU_PACK_SIZE_M[skuId];
    if (unitsWide === undefined || size === undefined) {
      throw new Error(`[planogram] Unknown SKU id "${skuId}" in face list`);
    }
    const widthM = unitsWide * size[0];
    if (cursor + widthM > usableM + FIT_EPSILON_M) continue; // skip what does not fit; keep walking
    const packDepthM = size[2];
    let depth: 1 | 2 | 3 = 1;
    for (const d of [3, 2] as const) {
      if (d * packDepthM + (d - 1) * GAP_M <= FACE_HALF_M + FIT_EPSILON_M) {
        depth = d;
        break;
      }
    }
    facings.push({ skuId, lengthM: depth * packDepthM + (depth - 1) * GAP_M, depth, widthM });
    cursor += widthM + FACING_GAP_M;
  }
  return facings;
}

// ---------------------------------------------------------------------------
// Placements (one per unit per facing, laid out across the face).
// ---------------------------------------------------------------------------

export interface PlacementCell {
  /** Row centre x from the layout (ROW_X_POSITIONS). */
  rowX: number;
  /** Board-top y the packs stand on. */
  boardY: number;
  /** Row centre z (ROW_CENTER_Z). */
  centerZ: number;
}

/**
 * Lay the facings across a board face, one Placement per unit per facing
 * (UNITS_WIDE × depth units each). Units inside a facing are flush; facings
 * keep FACING_GAP_M between them. The front face fills from the north end
 * (z = centerZ − FACE_USABLE_M / 2) toward +z; the back face mirrors and
 * fills from z = centerZ + FACE_USABLE_M / 2 toward −z. `side` is the x sign
 * of the face normal (1 = +x face, packs rotate to face +x).
 *
 * Depth rows step inward from the board's front lip, outer faces flush:
 *   x_j = cell.rowX + side × (FACE_HALF_M − packDepth/2 − j × (packDepth + GAP_M)),
 * j = 0..depth−1 — every row stays on the producing face's half of the board.
 * Packs deeper than a half-board (roti-canai-frozen 0.28 m, tens-egg
 * 0.265 m) sit 1-deep, flush with the inner edge on the row centre plane
 * (x = rowX + side × packDepth/2): they overhang the front lip toward the
 * customer and never enter the opposite face's half. Returns [] for empty
 * input.
 */
export function computePlacements(
  facings: Facing[],
  face: "front" | "back",
  cell: PlacementCell,
  side: 1 | -1,
): Placement[] {
  const placements: Placement[] = [];
  const direction = face === "front" ? 1 : -1;
  const startZ = cell.centerZ - direction * (FACE_USABLE_M / 2);
  const rotationY = side > 0 ? Math.PI / 2 : -Math.PI / 2;

  let cursor = 0; // filled width along the fill direction, including gaps
  for (const facing of facings) {
    const size = SKU_PACK_SIZE_M[facing.skuId];
    if (!size) throw new Error(`[planogram] Unknown SKU id "${facing.skuId}"`);
    const unitsWide = UNITS_WIDE[facing.skuId];
    const packDepthM = size[2];
    const overhang = packDepthM > FACE_HALF_M; // centre-plane flush; front lip overhang
    for (let row = 0; row < facing.depth; row += 1) {
      const inwardM = overhang
        ? packDepthM / 2
        : FACE_HALF_M - packDepthM / 2 - row * (packDepthM + GAP_M);
      const x = cell.rowX + side * inwardM;
      for (let unit = 0; unit < unitsWide; unit += 1) {
        const along = cursor + (unit + 0.5) * size[0]; // zero gap between units
        placements.push({
          skuId: facing.skuId,
          x,
          y: cell.boardY + PACK_Y_EPSILON_M,
          z: startZ + direction * along,
          depth: facing.depth,
          rotationY,
        });
      }
    }
    cursor += facing.widthM + FACING_GAP_M;
  }
  return placements;
}
