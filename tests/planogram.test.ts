import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "../src/data/products";
import {
  computeFacings,
  computePlacements,
  entrySku,
  FACE_HALF_M,
  FACE_SLOTS,
  FACE_USABLE_M,
  FACING_GAP_M,
  faceSkus,
  GAP_M,
  MAX_DEPTH,
  MIN_FACE_FILL_RATIO,
  SKU_PACK_SIZE_M,
  UNITS_WIDE,
  type FaceEntry,
  type Facing,
  type Placement,
} from "../src/game/planogram";
import { STOCK_DEPTH_M, shelfClearanceM } from "../src/game/storeGeometry";

const PRODUCT_IDS = new Set(PRODUCTS.map((product) => product.id));
const EPS = 1e-6;

/** Every distinct face list the store stocks. */
const FACE_LISTS: FaceEntry[][] = [...new Map(FACE_SLOTS.map((s) => [JSON.stringify(faceSkus(s)), faceSkus(s)])).values()];

/** Extent a facing list occupies on the face (widths + inter-facing gaps). */
function facingExtentM(facings: readonly Facing[]): number {
  const widths = facings.reduce((sum, facing) => sum + facing.widthM, 0);
  return widths + FACING_GAP_M * Math.max(0, facings.length - 1);
}

/** Group the consecutive placements that belong to each facing. */
function groupPlacementsPerFacing(facings: readonly Facing[], placements: readonly Placement[]): Placement[][] {
  const groups: Placement[][] = [];
  let cursor = 0;
  for (const facing of facings) {
    const count = facing.unitsWide * facing.depth;
    groups.push(placements.slice(cursor, cursor + count));
    cursor += count;
  }
  return groups;
}

describe("planogram tables (cross-module checks)", () => {
  it("every SKU id on a face exists in the PRODUCTS catalog", () => {
    for (const list of FACE_LISTS) {
      for (const skuId of list.map(entrySku)) expect(PRODUCT_IDS.has(skuId), `unknown SKU "${skuId}"`).toBe(true);
    }
  });

  it("every SKU id in UNITS_WIDE and SKU_PACK_SIZE_M exists in the catalog", () => {
    for (const skuId of [...Object.keys(UNITS_WIDE), ...Object.keys(SKU_PACK_SIZE_M)]) {
      expect(PRODUCT_IDS.has(skuId), skuId).toBe(true);
    }
  });

  it("every catalog SKU appears on some face", () => {
    const seen = new Set(FACE_LISTS.flat().map(entrySku));
    for (const product of PRODUCTS) {
      expect(seen.has(product.id), `catalog SKU "${product.id}" never appears on a face`).toBe(true);
    }
  });
});

describe("face slots", () => {
  it("enumerates 7 × 2 × 3 × 5 × 2 + 2 × 2 × 3 × 5 = 480 faces", () => {
    expect(FACE_SLOTS).toHaveLength(480);
  });

  it("wall runs only stock their interior side", () => {
    for (const slot of FACE_SLOTS) {
      if (slot.unit === "wW") expect(slot.side).toBe(1);
      if (slot.unit === "wE") expect(slot.side).toBe(-1);
    }
  });

  it("every placement fits under the shelf above", () => {
    for (const slot of FACE_SLOTS) {
      for (const skuId of faceSkus(slot).map(entrySku)) {
        expect(SKU_PACK_SIZE_M[skuId][1], `${skuId} on shelf ${slot.shelf}`).toBeLessThanOrEqual(shelfClearanceM(slot.shelf));
      }
    }
  });

  it("fills ≥ 96 % of every face", () => {
    for (const slot of FACE_SLOTS) {
      const fill = facingExtentM(computeFacings(faceSkus(slot), FACE_USABLE_M)) / FACE_USABLE_M;
      expect(fill, `${slot.unit}:${slot.run} bay ${slot.bay} shelf ${slot.shelf} filled ${(100 * fill).toFixed(1)}%`).toBeGreaterThanOrEqual(
        MIN_FACE_FILL_RATIO,
      );
    }
  });
});

describe("computeFacings", () => {
  it("never overflows the face", () => {
    for (const list of FACE_LISTS) {
      expect(facingExtentM(computeFacings(list, FACE_USABLE_M))).toBeLessThanOrEqual(FACE_USABLE_M + EPS);
    }
  });

  it("sizes each facing as unitsWide × pack width and stocks as deep as the shelf allows", () => {
    const expectedDepth = (packDepthM: number): number => {
      for (let d = MAX_DEPTH; d >= 2; d -= 1) if (d * packDepthM + (d - 1) * GAP_M <= STOCK_DEPTH_M + 1e-9) return d;
      return 1;
    };
    for (const list of FACE_LISTS) {
      for (const facing of computeFacings(list, FACE_USABLE_M)) {
        const size = SKU_PACK_SIZE_M[facing.skuId];
        expect(facing.widthM).toBeCloseTo(facing.unitsWide * size[0], 10);
        expect(facing.depth).toBe(expectedDepth(size[2]));
        expect(facing.lengthM).toBeCloseTo(facing.depth * size[2] + (facing.depth - 1) * GAP_M, 10);
      }
    }
  });

  it("stocks front to back", () => {
    expect(computeFacings(["milo-400g"], FACE_USABLE_M)[0].depth).toBe(3);
    expect(computeFacings(["kopi-3in1"], FACE_USABLE_M)[0].depth).toBe(6);
  });

  it("stops cleanly when the SKU list is exhausted", () => {
    const facings = computeFacings(["milo-400g"], FACE_USABLE_M);
    expect(facings.map((f) => f.skuId)).toEqual(["milo-400g"]);
  });

  it("drops a facing that would overflow the face instead of overflowing", () => {
    // Mee-hoon facing = 0.28 m + 0.01 m gap: 0.6 m fits two (0.57 m) but not three.
    const facings = computeFacings(["mee-hoon", "mee-hoon", "mee-hoon"], 0.6);
    expect(facings.map((f) => f.skuId)).toEqual(["mee-hoon", "mee-hoon"]);
  });

  it("skips a non-fitting SKU and still places the smaller tail that fits", () => {
    // beras-5kg (0.30 m) doesn't fit 0.25 m; cream-crackers (0.21 m) does.
    const facings = computeFacings(["beras-5kg", "cream-crackers", "beras-5kg"], 0.25);
    expect(facings.map((f) => f.skuId)).toEqual(["cream-crackers"]);
  });

  it("throws a clear error for an unknown SKU id", () => {
    expect(() => computeFacings(["not-a-real-sku"], FACE_USABLE_M)).toThrow(/not-a-real-sku/);
  });

  it("returns no facings for a zero-width face", () => {
    expect(computeFacings(FACE_LISTS[0], 0)).toEqual([]);
  });
});

describe("computePlacements", () => {
  const cell = { rowX: -5.6, boardY: 0.91, centerZ: 0.525 };

  function facingZSpans(side: 1 | -1, face: "front" | "back") {
    const facings = computeFacings(FACE_LISTS[0], FACE_USABLE_M);
    return groupPlacementsPerFacing(facings, computePlacements(facings, face, cell, side)).map((group) => {
      const zs = group.map((p) => p.z);
      return { min: Math.min(...zs), max: Math.max(...zs) };
    });
  }

  it("facings are 1 cm apart and never overlap (front fills +z, back mirrors)", () => {
    expect(FACING_GAP_M).toBe(0.01);
    const front = facingZSpans(1, "front");
    for (let i = 1; i < front.length; i += 1) expect(front[i].min).toBeGreaterThan(front[i - 1].max);
    const back = facingZSpans(-1, "back");
    for (let i = 1; i < back.length; i += 1) expect(back[i].max).toBeLessThan(back[i - 1].min);
  });

  it("emits one placement per unit per facing (UNITS_WIDE × depth)", () => {
    for (const list of FACE_LISTS) {
      const facings = computeFacings(list, FACE_USABLE_M);
      const expected = facings.reduce((n, f) => n + f.unitsWide * f.depth, 0);
      expect(computePlacements(facings, "front", cell, 1)).toHaveLength(expected);
    }
  });

  it("keeps every placement inside the bay face and on the board", () => {
    for (const list of FACE_LISTS) {
      for (const p of computePlacements(computeFacings(list, FACE_USABLE_M), "front", cell, 1)) {
        expect(Math.abs(p.z - cell.centerZ)).toBeLessThanOrEqual(FACE_USABLE_M / 2 + EPS);
        expect(p.y).toBeGreaterThanOrEqual(cell.boardY);
      }
    }
  });

  it("faces packs outward: rotationY follows the side sign", () => {
    const facings = computeFacings(FACE_LISTS[0], FACE_USABLE_M);
    for (const p of computePlacements(facings, "front", cell, 1)) expect(p.rotationY).toBeCloseTo(Math.PI / 2, 10);
    for (const p of computePlacements(facings, "back", cell, -1)) expect(p.rotationY).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("keeps every pack on the producing side of the centre plane / back panel", () => {
    for (const list of FACE_LISTS) {
      const facings = computeFacings(list, FACE_USABLE_M);
      for (const side of [1, -1] as const) {
        for (const p of computePlacements(facings, side > 0 ? "front" : "back", cell, side)) {
          const inner = side * (p.x - cell.rowX) - SKU_PACK_SIZE_M[p.skuId][2] / 2;
          expect(inner, `${p.skuId} inner face`).toBeGreaterThanOrEqual(-EPS);
        }
      }
    }
  });

  it("keeps the front row's outer face flush with the shelf lip", () => {
    const seen = new Set<string>();
    for (const p of computePlacements(computeFacings(FACE_LISTS[0], FACE_USABLE_M), "front", cell, 1)) {
      if (seen.has(p.skuId)) continue;
      seen.add(p.skuId);
      expect(p.x - cell.rowX + SKU_PACK_SIZE_M[p.skuId][2] / 2).toBeCloseTo(FACE_HALF_M, 10);
    }
  });

  it("is deterministic: identical inputs produce identical placements", () => {
    const facings = computeFacings(FACE_LISTS[1], FACE_USABLE_M);
    expect(computePlacements(facings, "back", cell, -1)).toEqual(computePlacements(facings, "back", cell, -1));
  });
});

describe("module purity", () => {
  it("has no three.js or DOM imports", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/game/planogram.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from\s+["']three/);
    expect(source).not.toMatch(/\b(document|window|HTMLElement|HTMLCanvasElement)\b/);
  });
});
