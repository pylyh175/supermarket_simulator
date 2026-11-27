/**
 * Pure planogram layer for the supermarket simulation.
 *
 * This module decides WHICH products stand WHERE on the shelf boards — no
 * Three.js, no DOM, no hidden state. Everything is derived from the tables
 * below and the `PRODUCTS` catalog. Task 2 (storeLayout) consumes
 * `computePlacements` to clone product archetypes into the scene; keeping the
 * math three-free means it stays unit-testable.
 *
 * Layout context (see src/game/storeGeometry.ts):
 *   - 7 double-sided gondolas + 2 single-sided wall runs, each split into a
 *     back and a front run of 3 bays (1.25 m). Every bay has 5 shelves.
 *   - One face = one shelf of one bay on one side: 7 x 2 x 3 x 5 x 2 +
 *     2 x 2 x 3 x 5 = 480 faces (FACE_SLOTS). Usable face = FACE_USABLE_M.
 *   - Each run belongs to a department (RUN_DEPARTMENTS); the face's SKU
 *     list is one of that department's groups, packed by fillFaceList.
 *
 * Pack sizes and units-per-facing are derived from the shared pure table
 * in src/data/packSpecs.ts (the same table the 3D pack builder reads).
 *
 * Planogram design:
 *   - Each face is planned by fillFaceList: the lead SKU of the face's
 *     department group takes the first facing, then an unbounded knapsack
 *     (1 mm resolution) packs the rest from (sku, units) options of the
 *     group, the whole department and small filler packs, so every face
 *     reaches >= 96 % fill. Facings are 0.2-0.45 m wide; the face entry
 *     carries its own unit count (FaceEntry).
 *   - side +1 (east face) fills -z to +z ("front"); side -1 mirrors
 *     ("back") so both aisles read the same way. rotationY = side x pi/2.
 *
 * Fill rules:
 *   - Units inside a facing sit flush; FACING_GAP_M (1 cm) separates
 *     facings. computeFacings skips a facing that does not fit and keeps
 *     walking; it never overflows the face.
 *   - Depth: the largest d <= MAX_DEPTH with d x packDepth + (d - 1) x GAP_M
 *     <= STOCK_DEPTH_M — stocked front to back.
 *   - Rows sit at x_j = rowX + side x (FACE_HALF_M - packDepth/2 - j x
 *     (packDepth + GAP_M)): the front row is flush with the shelf lip and
 *     every row stays on its own side of the centre plane / back panel.
 *     (A pack deeper than FACE_HALF_M would sit 1-deep against the centre
 *     plane; none exists today.)
 */
import { PRODUCTS } from "../data/products";
import { FALLBACK_PACK_SPEC, PACK_SPECS, unitsWideFor } from "../data/packSpecs";
import {
  FACE_HALF_M,
  FACE_USABLE_M,
  GONDOLA_XS,
  RUNS,
  SHELF_YS,
  STOCK_DEPTH_M,
  WALL_RUN_BACK_XS,
  bayCenterZs,
  shelfClearanceM,
  type RunId,
} from "./storeGeometry";

export { FACE_HALF_M, FACE_USABLE_M };

// ---------------------------------------------------------------------------
// Interfaces (task-brief contract).
// ---------------------------------------------------------------------------

export interface Facing {
  skuId: string;
  /** Front-to-back extent of the facing: depth × pack depth + (depth − 1) × GAP_M, in metres. */
  lengthM: number;
  /** Pack rows deep, 1..MAX_DEPTH; as many as fit STOCK_DEPTH_M. */
  depth: number;
  /** Packs side by side in this facing. */
  unitsWide: number;
  /** widthM = unitsWide × pack width of the SKU, in metres. */
  widthM: number;
}

/** One planned facing: a SKU id (default unit count) or a SKU with an explicit unit count. */
export type FaceEntry = string | { sku: string; units: number };

/** SKU id of a face entry. */
export function entrySku(entry: FaceEntry): string {
  return typeof entry === "string" ? entry : entry.sku;
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
  depth: number;
  rotationY: number;
}

// ---------------------------------------------------------------------------
// Named constants.
// ---------------------------------------------------------------------------

/** Gap between depth rows within a facing (keeps unit rows readable). */
export const GAP_M = 0.005;
/** 1 cm between facings (units inside a facing sit flush) — tight packing. */
export const FACING_GAP_M = 0.01;
/** Deepest a facing is stocked, front to back. */
export const MAX_DEPTH = 6;
/** Minimum acceptable fill ratio for every face. */
export const MIN_FACE_FILL_RATIO = 0.96;
/** Lift products a hair off the board top to avoid z-fighting. */
export const PACK_Y_EPSILON_M = 0.002;

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

export type Department =
  | "drinks"
  | "snacks"
  | "noodles"
  | "canned"
  | "condiments"
  | "staples"
  | "dairy"
  | "household"
  | "personal";

/**
 * Department per run, keyed unit:run — gondolas g0..g6 west to east,
 * wW / wE the wall runs. Front runs sell the impulse buys (snacks, drinks),
 * back runs the staples and household goods.
 */
export const RUN_DEPARTMENTS: Record<string, Department> = {
  "g0:front": "drinks", "g1:front": "drinks", "g2:front": "snacks", "g3:front": "snacks",
  "g4:front": "noodles", "g5:front": "canned", "g6:front": "condiments",
  "wW:front": "drinks", "wE:front": "snacks",
  "g0:back": "staples", "g1:back": "staples", "g2:back": "condiments", "g3:back": "dairy",
  "g4:back": "household", "g5:back": "household", "g6:back": "personal",
  "wW:back": "staples", "wE:back": "household",
};

/** SKU groups per department; a face takes one group (see faceSkus). */
export const DEPARTMENT_GROUPS: Record<Department, string[][]> = {
  drinks: [
    ["isotonic-1-5l", "mineral-1-5l", "sirap-ros-2l"],
    ["soya-1l", "milo-400g", "kopi-3in1", "teh-tarik-3in1"],
    ["mineral-1-5l", "isotonic-1-5l", "soya-1l"],
  ],
  snacks: [
    ["cream-crackers", "keropok-ikan", "kuih-bahulu"],
    ["nasi-lemak-bungkus", "kuih-bahulu", "cream-crackers"],
    ["roti-putih", "kaya-pandan", "keropok-ikan"],
  ],
  noodles: [
    ["maggi-curry", "mi-ayam-5pk", "mee-hoon"],
    ["mi-ayam-5pk", "maggi-curry"],
  ],
  canned: [
    ["sardin-425g", "susu-pekat", "sambal-bilis"],
    ["sardin-425g", "kaya-pandan", "susu-pekat"],
  ],
  condiments: [
    ["kicap-manis", "sos-cili", "sambal-bilis"],
    ["belacan-250g", "ikan-bilis-200g", "kicap-manis"],
  ],
  staples: [
    ["beras-5kg", "minyak-2kg", "gula-1kg"],
    ["tepung-1kg", "garam-500g", "minyak-2kg", "gula-1kg"],
  ],
  // Chilled lines sit on a gondola until stage 2 adds the chillers.
  dairy: [
    ["susu-fullcream", "butter-250g", "telur-10pk"],
    ["telur-30-tray", "roti-canai-frozen", "susu-fullcream"],
  ],
  household: [
    ["detergent-1-8kg", "tisu-tandas-10"],
    ["pencuci-pinggan", "bicarbonate-250g", "detergent-1-8kg"],
  ],
  personal: [
    ["soap-bar", "ubat-gigi"],
    ["ubat-gigi", "soap-bar", "bicarbonate-250g"],
  ],
};

/** Small packs allowed to top up a face's last gap. */
const FILLER_SKUS: readonly string[] = [
  "soap-bar", "bicarbonate-250g", "garam-500g", "susu-pekat", "belacan-250g", "ubat-gigi",
];

/** Narrowest / widest frontage a planned facing may take. */
const MIN_FRONTAGE_M = 0.2;
const MAX_FRONTAGE_M = 0.45;
/** Knapsack bonus (mm-equivalent) per facing of the face's own group. */
const GROUP_BONUS_MM = 15;

/** Every (sku, units) facing option with a frontage in [MIN, MAX]; at least one unit. */
function facingOptions(sku: string): { sku: string; units: number; widthM: number }[] {
  const w = SKU_PACK_SIZE_M[sku][0];
  const options: { sku: string; units: number; widthM: number }[] = [];
  for (let units = 1; units * w <= MAX_FRONTAGE_M + FIT_EPSILON_M; units += 1) {
    if (units * w >= MIN_FRONTAGE_M - FIT_EPSILON_M || units === 1) options.push({ sku, units, widthM: units * w });
  }
  return options;
}

/**
 * Plan one face: the lead SKU takes the first facing, then an unbounded
 * knapsack (1 mm resolution) packs the rest of the face from (sku, units)
 * options of the group, the wider department and the small filler packs.
 * Value = filled mm plus a small bonus for the face's own group, so fill
 * comes first and the department look second. Every chosen facing fits by
 * construction, so computeFacings reproduces the plan exactly.
 */
function fillFaceList(group: readonly string[], department: readonly string[] = group): FaceEntry[] {
  if (group.length === 0) return [];
  const lead = facingOptions(group[0]).reduce((a, o) => (Math.abs(o.widthM - 0.3) < Math.abs(a.widthM - 0.3) ? o : a));
  const cursor = lead.widthM + FACING_GAP_M;
  // Capacity includes the trailing gap the last facing doesn't need.
  const options = [...new Set([...group, ...department, ...FILLER_SKUS])].flatMap(facingOptions);
  const capacityMm = Math.floor((FACE_USABLE_M - cursor + FACING_GAP_M) * 1000 + 1e-6);
  const weights = options.map((o) => Math.ceil((o.widthM + FACING_GAP_M) * 1000 - 1e-6));
  const values = options.map(
    (o, k) => weights[k] + (group.includes(o.sku) ? GROUP_BONUS_MM : department.includes(o.sku) ? GROUP_BONUS_MM / 2 : 0),
  );
  const best = new Array<number>(capacityMm + 1).fill(0);
  const choice = new Array<number>(capacityMm + 1).fill(-1);
  for (let c = 1; c <= capacityMm; c += 1) {
    best[c] = best[c - 1];
    choice[c] = -2; // inherit from c − 1
    for (let k = 0; k < options.length; k += 1) {
      const w = weights[k];
      if (w <= c && best[c - w] + values[k] > best[c]) {
        best[c] = best[c - w] + values[k];
        choice[c] = k;
      }
    }
  }
  const tail: { sku: string; units: number }[] = [];
  let c = capacityMm;
  while (c > 0) {
    const k = choice[c];
    if (k === -2) {
      c -= 1;
      continue;
    }
    if (k < 0) break;
    tail.push({ sku: options[k].sku, units: options[k].units });
    c -= weights[k];
  }
  // Group SKUs first, then the department, fillers last; same SKU side by side.
  const rank = (sku: string): number => (group.includes(sku) ? 0 : department.includes(sku) ? 1 : 2);
  tail.sort((x, y) => rank(x.sku) - rank(y.sku) || x.sku.localeCompare(y.sku));
  return [{ sku: lead.sku, units: lead.units }, ...tail];
}

export interface FaceSlot {
  /** g0..g6 (gondolas west to east), wW / wE (wall runs). */
  unit: string;
  run: RunId;
  /** 0..2 along the run, north to south. */
  bay: number;
  /** 0..4, bottom deck to top shelf. */
  shelf: number;
  /** x sign of the face normal (1 = east face). */
  side: 1 | -1;
  /** Centre plane (gondola) or back panel (wall run) x. */
  rowX: number;
  /** Bay centre z. */
  centerZ: number;
  /** Board top the packs stand on. */
  boardY: number;
}

function buildFaceSlots(): FaceSlot[] {
  const units: { unit: string; x: number; sides: (1 | -1)[] }[] = [
    ...GONDOLA_XS.map((x, i) => ({ unit: `g${i}`, x, sides: [1, -1] as (1 | -1)[] })),
    { unit: "wW", x: WALL_RUN_BACK_XS[0], sides: [1] },
    { unit: "wE", x: WALL_RUN_BACK_XS[1], sides: [-1] },
  ];
  const slots: FaceSlot[] = [];
  for (const { unit, x, sides } of units) {
    for (const { id: run } of RUNS) {
      bayCenterZs(run).forEach((centerZ, bay) => {
        SHELF_YS.forEach((boardY, shelf) => {
          for (const side of sides) slots.push({ unit, run, bay, shelf, side, rowX: x, centerZ, boardY });
        });
      });
    }
  }
  return slots;
}

/** Every stocked shelf face in the store, ordered unit, run, bay, shelf, side. */
export const FACE_SLOTS: readonly FaceSlot[] = buildFaceSlots();

const faceListCache = new Map<string, FaceEntry[]>();

/** The planned facings for one face: its department's group, minus packs too tall for the shelf. */
export function faceSkus(slot: FaceSlot): FaceEntry[] {
  const groups = DEPARTMENT_GROUPS[RUN_DEPARTMENTS[`${slot.unit}:${slot.run}`]];
  const n = slot.bay * SHELF_YS.length + slot.shelf;
  const group = groups[n % groups.length];
  // Rotate which SKU leads so neighbouring shelves don't repeat the same front facing.
  const lead = Math.floor(n / groups.length) % group.length;
  const key = `${slot.unit}:${slot.run}:${n % groups.length}:${lead}:${slot.shelf}`;
  let list = faceListCache.get(key);
  if (!list) {
    const clearance = shelfClearanceM(slot.shelf);
    const fits = (sku: string): boolean => SKU_PACK_SIZE_M[sku][1] <= clearance;
    const rotated = [...group.slice(lead), ...group.slice(0, lead)];
    list = fillFaceList(rotated.filter(fits), [...new Set(groups.flat())].filter(fits));
    faceListCache.set(key, list);
  }
  return list;
}

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
export function computeFacings(faceSkus: readonly FaceEntry[], usableM: number): Facing[] {
  const facings: Facing[] = [];
  if (!Number.isFinite(usableM) || usableM <= 0) return facings;

  let cursor = 0; // occupied width so far, including inter-facing gaps
  for (const entry of faceSkus) {
    const skuId = entrySku(entry);
    const unitsWide = typeof entry === "string" ? UNITS_WIDE[skuId] : entry.units;
    const size = SKU_PACK_SIZE_M[skuId];
    if (unitsWide === undefined || size === undefined) {
      throw new Error(`[planogram] Unknown SKU id "${skuId}" in face list`);
    }
    const widthM = unitsWide * size[0];
    if (cursor + widthM > usableM + FIT_EPSILON_M) continue; // skip what does not fit; keep walking
    const packDepthM = size[2];
    let depth = 1;
    for (let d = MAX_DEPTH; d >= 2; d -= 1) {
      if (d * packDepthM + (d - 1) * GAP_M <= STOCK_DEPTH_M + FIT_EPSILON_M) {
        depth = d;
        break;
      }
    }
    facings.push({ skuId, lengthM: depth * packDepthM + (depth - 1) * GAP_M, depth, unitsWide, widthM });
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
    const unitsWide = facing.unitsWide;
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
