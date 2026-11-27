import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COUNTER_D_M,
  COUNTER_W_M,
  DOOR,
  FACE_HALF_M,
  GONDOLA_XS,
  RUNS,
  SHELF_YS,
  SPAWN,
  STORE_WIDTH_M,
  TILL_X,
  TILL_Z,
  TILL_ZONE,
  shelfClearanceM,
  solidFootprints,
} from "../src/game/storeGeometry";

type Box = { minX: number; minZ: number; maxX: number; maxZ: number };
const inside = (b: Box, x: number, z: number, pad = 0): boolean =>
  x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;
const overlaps = (a: Box, b: Box): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe("store geometry", () => {
  it("aisles between gondolas are at least 1.8 m clear", () => {
    for (let i = 1; i < GONDOLA_XS.length; i += 1) {
      expect(GONDOLA_XS[i] - GONDOLA_XS[i - 1] - 2 * FACE_HALF_M).toBeGreaterThanOrEqual(1.8);
    }
  });

  it("every shelf fits the tallest pack (0.30 m)", () => {
    for (let i = 0; i < SHELF_YS.length; i += 1) expect(shelfClearanceM(i)).toBeGreaterThanOrEqual(0.3);
  });

  it("runs leave a cross-aisle of at least 1.8 m and an open front area of 3–4.5 m", () => {
    expect(RUNS[1].minZ - RUNS[0].maxZ).toBeGreaterThanOrEqual(1.8);
    const open = TILL_Z - COUNTER_D_M / 2 - RUNS[1].maxZ;
    expect(open).toBeGreaterThanOrEqual(3);
    expect(open).toBeLessThanOrEqual(4.5);
  });

  it("spawn and the till zone are clear of every solid", () => {
    for (const box of solidFootprints()) {
      expect(inside(box, SPAWN.x, SPAWN.z, 0.35), `spawn inside ${JSON.stringify(box)}`).toBe(false);
      expect(overlaps(box, TILL_ZONE), `till zone overlaps ${JSON.stringify(box)}`).toBe(false);
    }
  });

  it("the door is in the front wall, west of the player's counter", () => {
    expect(DOOR.x - DOOR.widthM / 2).toBeGreaterThan(-STORE_WIDTH_M / 2);
    expect(DOOR.x).toBeLessThan(TILL_X - COUNTER_W_M / 2 - 1.2);
  });

  it("module is pure", () => {
    const src = readFileSync(new URL("../src/game/storeGeometry.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "three"/);
    expect(src).not.toMatch(/document/);
  });
});
