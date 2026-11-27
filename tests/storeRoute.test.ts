import { describe, expect, it } from "vitest";
import { BROWSE_STOPS, QUEUE_SLOTS, ROUTE_NODES, findPath, pathPoints, type Point } from "../src/game/storeRoute";
import { CROSS_AISLE_Z, TILL_X, TILL_Z, solidFootprints } from "../src/game/storeGeometry";

const SOLIDS = solidFootprints();

/** Distance from a point to the nearest solid footprint (0 when inside). */
function clearance(p: Point): number {
  let best = Infinity;
  for (const b of SOLIDS) {
    const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
    const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Smallest clearance along a straight walk from a to b, sampled every 5 cm. */
function segmentClearance(a: Point, b: Point): number {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
  let worst = Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    worst = Math.min(worst, clearance({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }));
  }
  return worst;
}

/** Every graph edge, once, as node-id pairs. */
function edges(): [string, string][] {
  const out: [string, string][] = [];
  const ids = Object.keys(ROUTE_NODES);
  for (const a of ids) {
    for (const b of ids) {
      if (a < b && findPath(a, b).length === 2) out.push([a, b]);
    }
  }
  return out;
}

describe("store routes", () => {
  it("every browse stop and every queue slot is reachable from the door", () => {
    for (const stop of BROWSE_STOPS) expect(findPath("door", stop.node).length, stop.node).toBeGreaterThan(0);
    expect(findPath("door", "Sc").length).toBeGreaterThan(0);
    expect(findPath("exit", "door").length).toBeGreaterThan(0);
  });

  it("no route edge passes within 0.3 m of a solid", () => {
    for (const [a, b] of edges()) {
      expect(segmentClearance(ROUTE_NODES[a], ROUTE_NODES[b]), `${a} → ${b}`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("browse stands are clear and face a shelf lip, and the step off the lane is clear", () => {
    for (const stop of BROWSE_STOPS) {
      expect(clearance(stop.stand), `stand at ${stop.node}`).toBeGreaterThanOrEqual(0.3);
      expect(Math.abs(stop.stand.x - stop.look.x)).toBeCloseTo(0.55, 6);
      expect(segmentClearance(ROUTE_NODES[stop.node], stop.stand), `${stop.node} → stand`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("queue slots are clear of solids and off the front cross-aisle", () => {
    for (const slot of QUEUE_SLOTS) {
      expect(clearance(slot)).toBeGreaterThanOrEqual(0.4);
      expect(Math.abs(slot.z - CROSS_AISLE_Z.front)).toBeGreaterThanOrEqual(0.6);
    }
    // Walking from the join node to any slot, and from the till to the exit, stays clear.
    for (const slot of QUEUE_SLOTS) expect(segmentClearance(ROUTE_NODES.Sc, slot)).toBeGreaterThanOrEqual(0.3);
    expect(segmentClearance(QUEUE_SLOTS[0], ROUTE_NODES.exit)).toBeGreaterThanOrEqual(0.3);
  });

  it("queue slot 0 is where checkoutFlow expects the customer", () => {
    expect(QUEUE_SLOTS[0]).toEqual({ x: TILL_X, z: TILL_Z - 0.85 });
    expect(QUEUE_SLOTS).toHaveLength(6);
  });

  it("exit leads straight out, not back through the store", () => {
    expect(findPath("exit", "door")).toEqual(["exit", "exitLane", "door"]);
    expect(pathPoints(["door"])[0]).toEqual(ROUTE_NODES.door);
  });
});
