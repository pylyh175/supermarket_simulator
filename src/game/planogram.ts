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
 * Tables that are NOT importable were duplicated deliberately:
 *   - PRODUCT_SPECS (pack dimensions) lives in src/three/assets.ts but is not
 *     exported, so SKU_PACK_SIZE_M mirrors it and a cross-module test pins
 *     every SKU id here to the PRODUCTS catalog.
 *
 * Planogram design (documented judgment calls, per the task brief):
 *   - PLANOGRAM keeps the brief's flat 10-list `string[][]` table (the brief's
 *     Interfaces block annotates it `Record<string, string[][]>`, but the same
 *     brief shows the concrete `string[][]` example and describes 10 lists
 *     wrapped onto 20 faces modulo `PLANOGRAM.length`). The given first-five
 *     entries per list are kept in their original order; two lists (2 and 3)
 *     were re-balanced and every list was extended so the greedy fill reaches
 *     ≥ 96 % of the face — the sparse 5-entry example lists fill only
 *     76–89 %. UNITS_WIDE / PACK_DEPTH_TWO_M are verbatim from the brief.
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
 *     depth. Per-SKU results: kopi-3in1 3, bicarbonate-250g 3, soap-bar 3;
 *     milo-300g 2, maggi-curry 2, susu-fullcream 2; roti-canai-frozen 1,
 *     nasi-lemak-bungkus 1, tens-egg 1, kuih-bahulu 1, telur-10pk 1,
 *     mee-hoon 1.
 *   - Any pack deeper than a half-board is placed 1-DEEP flush with the
 *     INNER edge on the row centre plane (x = rowX ± packDepth/2):
 *     roti-canai-frozen (0.28 m) and tens-egg (0.265 m) both overhang the
 *     board's front lip toward the customer and NEVER cross into the
 *     opposite face's half. (The review named roti-canai only, but the
 *     predicate packDepth > FACE_HALF_M covers tens-egg identically.)
 *   - Containment guarantee: normal rows sit at
 *     x_j = side × (FACE_HALF_M − packDepth/2 − j × (packDepth + GAP_M)),
 *     which keeps each row's inner face at x ≥ 0 relative to the row centre
 *     plane for side +1 (mirrored for −1); overhang packs sit at
 *     x = side × packDepth/2 (inner face exactly on the centre plane). The
 *     two faces of a double-sided board never share space. (Front row's
 *     outer face is flush with the board lip.)
 *   - Fill ratio for the tables above: 96.4 %–100 % (see tests).
 */
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
// Pack sizes per SKU, [width, height, depth] in metres.
// Mirrors PRODUCT_SPECS in src/three/assets.ts (not exported there); the
// cross-module tests pin every id to the PRODUCTS catalog.
// ---------------------------------------------------------------------------
export const SKU_PACK_SIZE_M: Record<string, readonly [number, number, number]> = {
  "milo-300g": [0.11, 0.145, 0.11],
  "maggi-curry": [0.16, 0.21, 0.085],
  "roti-canai-frozen": [0.2, 0.055, 0.28],
  "nasi-lemak-bungkus": [0.14, 0.125, 0.14],
  "tens-egg": [0.29, 0.085, 0.265],
  "kuih-bahulu": [0.15, 0.1, 0.15],
  "susu-fullcream": [0.088, 0.23, 0.088],
  "mee-hoon": [0.3, 0.05, 0.21],
  "telur-10pk": [0.27, 0.11, 0.2],
  "kopi-3in1": [0.14, 0.19, 0.06],
  "bicarbonate-250g": [0.085, 0.125, 0.05],
  "soap-bar": [0.095, 0.045, 0.07],
};

/** Units per SKU across a facing — narrow packs more, wide packs fewer. Verbatim from the brief. */
export const UNITS_WIDE: Record<string, number> = {
  "milo-300g": 6, "maggi-curry": 4, "roti-canai-frozen": 4, "nasi-lemak-bungkus": 5,
  "tens-egg": 3, "kuih-bahulu": 5, "susu-fullcream": 7, "mee-hoon": 3,
  "telur-10pk": 3, "kopi-3in1": 5, "bicarbonate-250g": 6, "soap-bar": 6,
};

/**
 * Hand-authored planogram: 10 face lists → the 20 faces are assigned by
 * `PLANOGRAM[faceIndex % PLANOGRAM.length]` (modulo-wrap). The brief's
 * example first-five entries per list are kept in order and extended to
 * greedily fill ≥ 96 % of a 4.6 m face; lists 2 and 3 were re-balanced
 * (a ≥ 0.51 m facing could not fit their remaining space, so sparse entries
 * were swapped). All 12 catalog SKUs appear.
 */
export const PLANOGRAM: string[][] = [
  // faceIndex 0 / 10
  ["milo-300g", "kopi-3in1", "maggi-curry", "nasi-lemak-bungkus", "bicarbonate-250g", "telur-10pk"],
  // faceIndex 1 / 11
  ["susu-fullcream", "kuih-bahulu", "maggi-curry", "milo-300g", "soap-bar", "kopi-3in1"],
  // faceIndex 2 / 12 (re-balanced: tens-egg dropped, susu-fullcream + soap-bar added)
  ["telur-10pk", "roti-canai-frozen", "kopi-3in1", "bicarbonate-250g", "susu-fullcream", "soap-bar"],
  // faceIndex 3 / 13 (re-balanced: nasi-lemak/soap-bar dropped, tens-egg + roti-canai added)
  ["mee-hoon", "telur-10pk", "tens-egg", "kopi-3in1", "roti-canai-frozen"],
  // faceIndex 4 / 14
  ["susu-fullcream", "maggi-curry", "milo-300g", "kuih-bahulu", "nasi-lemak-bungkus", "kopi-3in1"],
  // faceIndex 5 / 15
  ["kopi-3in1", "kuih-bahulu", "roti-canai-frozen", "bicarbonate-250g", "maggi-curry", "nasi-lemak-bungkus"],
  // faceIndex 6 / 16
  ["bicarbonate-250g", "nasi-lemak-bungkus", "tens-egg", "soap-bar", "telur-10pk", "maggi-curry"],
  // faceIndex 7 / 17
  ["milo-300g", "susu-fullcream", "kopi-3in1", "maggi-curry", "kuih-bahulu", "nasi-lemak-bungkus"],
  // faceIndex 8 / 18
  ["tens-egg", "maggi-curry", "bicarbonate-250g", "milo-300g", "kopi-3in1", "nasi-lemak-bungkus"],
  // faceIndex 9 / 19 (re-balanced: nasi-lemak/soap-bar dropped, tens-egg + mee-hoon added)
  ["roti-canai-frozen", "kuih-bahulu", "telur-10pk", "tens-egg", "mee-hoon"],
];

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
