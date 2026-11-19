import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "../src/data/products";
import {
  computeFacings,
  computePlacements,
  FACE_ENUMERATION,
  FACE_HALF_M,
  FACE_USABLE_M,
  FACING_GAP_M,
  GAP_M,
  MIN_FACE_FILL_RATIO,
  PLANOGRAM,
  SKU_PACK_SIZE_M,
  UNITS_WIDE,
  type Facing,
  type Placement,
} from "../src/game/planogram";

const PRODUCT_IDS = new Set(PRODUCTS.map((product) => product.id));
const EPS = 1e-6;

/** Extent a facing list occupies on the face (widths + inter-facing gaps). */
function facingExtentM(facings: readonly Facing[]): number {
  const widths = facings.reduce((sum, facing) => sum + facing.widthM, 0);
  return widths + FACING_GAP_M * Math.max(0, facings.length - 1);
}

/** Group the consecutive placements that belong to each facing. */
function groupPlacementsPerFacing(
  facings: readonly Facing[],
  placements: readonly Placement[],
): Placement[][] {
  const groups: Placement[][] = [];
  let cursor = 0;
  for (const facing of facings) {
    const count = UNITS_WIDE[facing.skuId] * facing.depth;
    groups.push(placements.slice(cursor, cursor + count));
    cursor += count;
  }
  return groups;
}

describe("planogram tables (cross-module checks)", () => {
  it("every SKU id used by PLANOGRAM exists in the PRODUCTS catalog", () => {
    for (const faceSkus of PLANOGRAM) {
      for (const skuId of faceSkus) {
        expect(PRODUCT_IDS.has(skuId), `PLANOGRAM references unknown SKU "${skuId}"`).toBe(true);
      }
    }
  });

  it("every SKU id in UNITS_WIDE exists in the PRODUCTS catalog", () => {
    for (const skuId of Object.keys(UNITS_WIDE)) {
      expect(PRODUCT_IDS.has(skuId), `UNITS_WIDE references unknown SKU "${skuId}"`).toBe(true);
    }
  });

  it("every SKU id in SKU_PACK_SIZE_M exists in the PRODUCTS catalog", () => {
    for (const skuId of Object.keys(SKU_PACK_SIZE_M)) {
      expect(PRODUCT_IDS.has(skuId), `SKU_PACK_SIZE_M references unknown SKU "${skuId}"`).toBe(true);
    }
  });

  it("covers all 12 catalog SKUs across PLANOGRAM (including via the modulo-wrap)", () => {
    const seen = new Set<string>();
    for (const slot of FACE_ENUMERATION) {
      for (const skuId of PLANOGRAM[slot.faceIndex % PLANOGRAM.length]) seen.add(skuId);
    }
    for (const product of PRODUCTS) {
      expect(seen.has(product.id), `catalog SKU "${product.id}" never appears on a face`).toBe(true);
    }
  });

  it("has UNITS_WIDE and SKU_PACK_SIZE_M entries for every catalog SKU", () => {
    for (const product of PRODUCTS) {
      expect(UNITS_WIDE[product.id]).toBeGreaterThanOrEqual(1);
      expect(SKU_PACK_SIZE_M[product.id]).toHaveLength(3);
    }
  });
});

describe("computeFacings", () => {
  it("returns facings whose widths sum to at most usableM for every face list", () => {
    for (const faceSkus of PLANOGRAM) {
      const facings = computeFacings(faceSkus, FACE_USABLE_M);
      const widthSum = facings.reduce((sum, facing) => sum + facing.widthM, 0);
      expect(widthSum).toBeLessThanOrEqual(FACE_USABLE_M + EPS);
      // Face span (widths + inter-facing gaps) must never overflow either.
      expect(facingExtentM(facings)).toBeLessThanOrEqual(FACE_USABLE_M + EPS);
    }
  });

  it("fills at least 96% of every hand-authored face list", () => {
    for (const [index, faceSkus] of PLANOGRAM.entries()) {
      const facings = computeFacings(faceSkus, FACE_USABLE_M);
      const fill = facingExtentM(facings) / FACE_USABLE_M;
      expect(fill, `face list #${index} only filled ${(100 * fill).toFixed(2)}%`).toBeGreaterThanOrEqual(
        MIN_FACE_FILL_RATIO,
      );
    }
  });

  it("sizes each facing as UNITS_WIDE × pack width and clamps depth to the half-board", () => {
    // Largest d ∈ {3,2,1} with d × packDepth + (d − 1) × GAP_M ≤ FACE_HALF_M;
    // packs deeper than a half-board go 1-deep (centre-plane flush).
    const expectedDepth = (packDepthM: number): 1 | 2 | 3 => {
      for (const d of [3, 2] as const) {
        if (d * packDepthM + (d - 1) * GAP_M <= FACE_HALF_M + 1e-9) return d;
      }
      return 1;
    };
    for (const faceSkus of PLANOGRAM) {
      for (const facing of computeFacings(faceSkus, FACE_USABLE_M)) {
        const size = SKU_PACK_SIZE_M[facing.skuId];
        expect(facing.widthM).toBeCloseTo(UNITS_WIDE[facing.skuId] * size[0], 10);
        expect(facing.depth).toBe(expectedDepth(size[2]));
        expect(facing.lengthM).toBeCloseTo(facing.depth * size[2] + (facing.depth - 1) * GAP_M, 10);
      }
    }
  });

  it("assigns the hand-checked per-SKU depth table", () => {
    const expected: Record<string, 1 | 2 | 3> = {
      "milo-300g": 2, "maggi-curry": 2, "susu-fullcream": 2,
      "kopi-3in1": 3, "bicarbonate-250g": 3, "soap-bar": 3,
      "roti-canai-frozen": 1, "nasi-lemak-bungkus": 1, "tens-egg": 1,
      "kuih-bahulu": 1, "telur-10pk": 1, "mee-hoon": 1,
    };
    for (const [skuId, depth] of Object.entries(expected)) {
      const [facing] = computeFacings([skuId], FACE_USABLE_M);
      expect(facing.depth, `${skuId} depth`).toBe(depth);
    }
  });

  it("stops cleanly when the SKU list is exhausted", () => {
    const facings = computeFacings(["milo-300g"], FACE_USABLE_M);
    expect(facings).toHaveLength(1);
    expect(facings[0].skuId).toBe("milo-300g");
  });

  it("drops a facing that would overflow the face instead of overflowing", () => {
    // Mee-hoon facing = 0.90 m + 0.1 m gap: 2.0 m fits two (extent 1.9 m) but not three.
    const facings = computeFacings(["mee-hoon", "mee-hoon", "mee-hoon"], 2.0);
    expect(facings.map((f) => f.skuId)).toEqual(["mee-hoon", "mee-hoon"]);
    expect(facingExtentM(facings)).toBeLessThanOrEqual(2.0 + EPS);
  });

  it("skips a non-fitting SKU and still places the smaller tail that fits", () => {
    // mee-hoon (0.90 m) and roti-canai (0.80 m) don't fit 0.6 m; bicarbonate (0.51 m) does.
    const facings = computeFacings(["mee-hoon", "bicarbonate-250g", "roti-canai-frozen"], 0.6);
    expect(facings.map((f) => f.skuId)).toEqual(["bicarbonate-250g"]);
    expect(facingExtentM(facings)).toBeLessThanOrEqual(0.6 + EPS);
  });

  it("throws a clear error for an unknown SKU id", () => {
    expect(() => computeFacings(["not-a-real-sku"], FACE_USABLE_M)).toThrow(/not-a-real-sku/);
  });

  it("returns no facings for a zero-width face", () => {
    expect(computeFacings(PLANOGRAM[0], 0)).toEqual([]);
  });
});

describe("no overlapping facings", () => {
  const cell = { rowX: 2.25, boardY: 0.35, centerZ: -2.5 };

  function facingZSpans(side: 1 | -1, face: "front" | "back") {
    const facings = computeFacings(PLANOGRAM[0], FACE_USABLE_M);
    const placements = computePlacements(facings, face, cell, side);
    return groupPlacementsPerFacing(facings, placements).map((group) => {
      const zs = group.map((placement) => placement.z);
      return { min: Math.min(...zs), max: Math.max(...zs) };
    });
  }

  it("front faces: facing extents are strictly increasing and pairwise disjoint", () => {
    const spans = facingZSpans(1, "front");
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].min).toBeGreaterThanOrEqual(spans[i - 1].max + FACING_GAP_M - EPS);
    }
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        expect(spans[j].min).toBeGreaterThan(spans[i].max);
      }
    }
  });

  it("back faces mirror the fill direction and stay pairwise disjoint", () => {
    const spans = facingZSpans(1, "back");
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].max).toBeLessThanOrEqual(spans[i - 1].min - FACING_GAP_M + EPS);
    }
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        expect(spans[j].max).toBeLessThan(spans[i].min);
      }
    }
  });
});

describe("computePlacements", () => {
  const cell = { rowX: -6.75, boardY: 0.95, centerZ: -2.5 };

  it("emits one placement per unit per facing (UNITS_WIDE × depth)", () => {
    for (const faceSkus of PLANOGRAM) {
      const facings = computeFacings(faceSkus, FACE_USABLE_M);
      for (const side of [1, -1] as const) {
        for (const face of ["front", "back"] as const) {
          const placements = computePlacements(facings, face, cell, side);
          const expected = facings.reduce(
            (count, facing) => count + UNITS_WIDE[facing.skuId] * facing.depth,
            0,
          );
          expect(placements).toHaveLength(expected);
        }
      }
    }
  });

  it("keeps every placement inside the face span", () => {
    for (const slot of FACE_ENUMERATION) {
      const faceSkus = PLANOGRAM[slot.faceIndex % PLANOGRAM.length];
      const facings = computeFacings(faceSkus, FACE_USABLE_M);
      const placements = computePlacements(facings, slot.face, cell, slot.sideIndex === 0 ? 1 : -1);
      for (const placement of placements) {
        expect(Math.abs(placement.z - cell.centerZ)).toBeLessThanOrEqual(FACE_USABLE_M / 2 + EPS);
        expect(placement.y).toBeGreaterThanOrEqual(cell.boardY);
      }
    }
  });

  it("faces packs outward: rotationY follows the side sign", () => {
    const facings = computeFacings(PLANOGRAM[0], FACE_USABLE_M);
    for (const placement of computePlacements(facings, "front", cell, 1)) {
      expect(placement.rotationY).toBeCloseTo(Math.PI / 2, 10);
    }
    for (const placement of computePlacements(facings, "front", cell, -1)) {
      expect(placement.rotationY).toBeCloseTo(-Math.PI / 2, 10);
    }
  });

  it("keeps every placement on the producing face's half of the board", () => {
    for (const faceSkus of PLANOGRAM) {
      const facings = computeFacings(faceSkus, FACE_USABLE_M);
      for (const face of ["front", "back"] as const) {
        for (const placement of computePlacements(facings, face, cell, 1)) {
          expect(placement.x - cell.rowX, `${placement.skuId} crossed into the −x face`).toBeGreaterThanOrEqual(-EPS);
        }
        for (const placement of computePlacements(facings, face, cell, -1)) {
          expect(placement.x - cell.rowX, `${placement.skuId} crossed into the +x face`).toBeLessThanOrEqual(EPS);
        }
      }
    }
  });

  it("keeps every pack's inner face on the producing side of the centre plane", () => {
    for (const faceSkus of PLANOGRAM) {
      const facings = computeFacings(faceSkus, FACE_USABLE_M);
      for (const face of ["front", "back"] as const) {
        for (const placement of computePlacements(facings, face, cell, 1)) {
          const innerFace = placement.x - cell.rowX - SKU_PACK_SIZE_M[placement.skuId][2] / 2;
          expect(innerFace, `${placement.skuId} inner face`).toBeGreaterThanOrEqual(-EPS);
        }
        for (const placement of computePlacements(facings, face, cell, -1)) {
          const innerFace = placement.x - cell.rowX + SKU_PACK_SIZE_M[placement.skuId][2] / 2;
          expect(innerFace, `${placement.skuId} inner face`).toBeLessThanOrEqual(EPS);
        }
      }
    }
  });

  it("places overhang packs (roti-canai 0.28 m, tens-egg 0.265 m) 1-deep flush with the centre plane", () => {
    // Both packs are deeper than a half-board (FACE_HALF_M) — the only two.
    for (const skuId of ["roti-canai-frozen", "tens-egg"] as const) {
      const [facing] = computeFacings([skuId], FACE_USABLE_M);
      expect(facing.depth, `${skuId} depth`).toBe(1);
      const packDepth = SKU_PACK_SIZE_M[skuId][2];
      for (const side of [1, -1] as const) {
        const placements = computePlacements([facing], "front", cell, side);
        for (const placement of placements) {
          expect(placement.x - cell.rowX).toBeCloseTo(side * (packDepth / 2), 10);
        }
      }
    }
  });

  it("keeps the front row's outer face flush with the board lip", () => {
    const facings = computeFacings(PLANOGRAM[0], FACE_USABLE_M); // includes depth-1/2/3 SKUs
    const seen = new Set<string>();
    for (const placement of computePlacements(facings, "front", cell, 1)) {
      if (seen.has(placement.skuId)) continue; // front row only
      seen.add(placement.skuId);
      const packDepth = SKU_PACK_SIZE_M[placement.skuId][2];
      if (packDepth > FACE_HALF_M) continue; // overhang packs sit centre-plane flush by design
      expect(placement.x - cell.rowX + packDepth / 2).toBeCloseTo(FACE_HALF_M, 10);
    }
  });

  it("is deterministic: identical inputs produce identical placements", () => {
    const facings = computeFacings(PLANOGRAM[3], FACE_USABLE_M);
    const a = computePlacements(facings, "front", cell, -1);
    const b = computePlacements(facings, "front", cell, -1);
    expect(a).toEqual(b);
  });
});

describe("face enumeration and facing counts (deterministic, literal)", () => {
  // 20 faces: row 0 (tall, 3 boards), row 1 (low, 1 board), rows 2–3 (tall,
  // 3 boards) × 2 sides (sideIndex 0 = front, 1 = back). Face order is
  // row-major: row → board → side. PLANOGRAM wraps modulo (10 lists → 20 faces).
  const EXPECTED_FACING_COUNTS = [
    6, 6, 6, 5, 6, 6, // row 0 (face 0..5): lists 0..5
    6, 6, //             row 1 (face 6..7, low): lists 6..7
    6, 5, 6, 6, 6, 5, // row 2 (face 8..13): lists 8,9,0,1,2,3
    6, 6, 6, 6, 6, 5, // row 3 (face 14..19): lists 4..9
  ];

  it("enumerates exactly the 20 faces of the 4 shelf rows", () => {
    expect(FACE_ENUMERATION).toHaveLength(20);
    expect(FACE_ENUMERATION.map((slot) => slot.faceIndex)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    );
    const boardsPerRow = [3, 1, 3, 3];
    for (const slot of FACE_ENUMERATION) {
      expect(slot.boardIndex).toBeLessThan(boardsPerRow[slot.rowIndex]);
      expect([0, 1]).toContain(slot.sideIndex);
      expect(slot.face).toBe(slot.sideIndex === 0 ? "front" : "back");
    }
  });

  it("renders the literal expected facing count per face", () => {
    const counts = FACE_ENUMERATION.map(
      (slot) => computeFacings(PLANOGRAM[slot.faceIndex % PLANOGRAM.length], FACE_USABLE_M).length,
    );
    expect(counts).toEqual(EXPECTED_FACING_COUNTS);
  });
});

describe("module purity", () => {
  it("has no three.js or DOM imports", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/game/planogram.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from\s+["']three/);
    expect(source).not.toMatch(/\b(document|window|HTMLElement|HTMLCanvasElement)\b/);
  });
});
