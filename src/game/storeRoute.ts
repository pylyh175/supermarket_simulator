/**
 * Walkable routes for customers — a small waypoint graph over the store's
 * aisles (pure, no three.js), built from src/game/storeGeometry.ts so it
 * always matches the shelves. Customers only walk along these edges, so they
 * never clip through shelves or counters (see tests/storeRoute.test.ts).
 *
 *   door (front-left) ─ west outer aisle ─ front cross-aisle (z 3.6)
 *   every aisle: front cross-aisle → front-run bays → middle cross-aisle
 *                → back-run bays → back cross-aisle
 *   queue: Sc (front cross-aisle) → 6 slots, L-shaped, slot 0 at the till
 *   exit:  till → exit → exitLane (beside the counter) → door
 */
import {
  COUNTER_W_M,
  CROSS_AISLE_Z,
  DOOR,
  FACE_HALF_M,
  FRONT_Z,
  GONDOLA_XS,
  TILL_X,
  TILL_Z,
  WALL_RUN_BACK_XS,
  bayCenterZs,
} from "./storeGeometry";

export interface Point {
  x: number;
  z: number;
}

export interface BrowseStop {
  /** Lane node the shopper steps out from. */
  node: string;
  /** Where they stand, an arm's length from the shelf face. */
  stand: Point;
  /** Point they look at (the shelf lip). */
  look: Point;
}

/** How far from the shelf lip a browsing shopper stands. */
const STAND_FROM_LIP_M = 0.55;

const nodes: Record<string, Point> = {};
const edges: [string, string][] = [];
const browseStops: BrowseStop[] = [];

// Aisles west → east: the outer aisles between the wall runs and the outer
// gondolas, and one between each pair of gondolas. Each knows its two shelf lips.
const westLip = WALL_RUN_BACK_XS[0] + FACE_HALF_M;
const eastLip = WALL_RUN_BACK_XS[1] - FACE_HALF_M;
const gondolaLips = GONDOLA_XS.map((x) => [x - FACE_HALF_M, x + FACE_HALF_M] as const);
const aisles: { x: number; lips: [number, number] }[] = [];
aisles.push({ x: (westLip + gondolaLips[0][0]) / 2, lips: [westLip, gondolaLips[0][0]] });
for (let i = 1; i < GONDOLA_XS.length; i += 1) {
  aisles.push({ x: (GONDOLA_XS[i - 1] + GONDOLA_XS[i]) / 2, lips: [gondolaLips[i - 1][1], gondolaLips[i][0]] });
}
aisles.push({ x: (gondolaLips[GONDOLA_XS.length - 1][1] + eastLip) / 2, lips: [gondolaLips[GONDOLA_XS.length - 1][1], eastLip] });

const laneZs = [CROSS_AISLE_Z.front, ...bayCenterZs("front").reverse(), CROSS_AISLE_Z.middle, ...bayCenterZs("back").reverse(), CROSS_AISLE_Z.back];
const crossIndex = new Set([0, 4, 8]); // front, middle, back cross-aisle positions in laneZs

aisles.forEach((aisle, a) => {
  laneZs.forEach((z, k) => {
    const id = `A${a}_${k}`;
    nodes[id] = { x: aisle.x, z };
    if (k > 0) edges.push([`A${a}_${k - 1}`, id]);
    if (crossIndex.has(k)) {
      if (a > 0) edges.push([`A${a - 1}_${k}`, id]);
      return;
    }
    for (const lip of aisle.lips) {
      const dir = Math.sign(aisle.x - lip); // from the lip into the aisle
      browseStops.push({ node: id, stand: { x: lip + dir * STAND_FROM_LIP_M, z }, look: { x: lip, z } });
    }
  });
});

// Door at the front-left, joined to the west outer aisle's front cross-aisle node.
nodes.door = { x: DOOR.x, z: FRONT_Z - 0.45 };
edges.push(["door", "A0_0"]);

// Queue join node: the front cross-aisle node nearest the queue's tail.
const queueTailX = TILL_X + 2.25;
let scIndex = 0;
aisles.forEach((aisle, a) => {
  if (Math.abs(aisle.x - queueTailX) < Math.abs(aisles[scIndex].x - queueTailX)) scIndex = a;
});
nodes.Sc = { ...nodes[`A${scIndex}_0`] };
edges.push(["Sc", `A${scIndex}_0`]);

// Paid customers leave through the lane beside the player's counter.
const exitX = TILL_X - COUNTER_W_M / 2 - 0.8;
nodes.exit = { x: exitX, z: TILL_Z - 0.85 };
nodes.exitLane = { x: exitX, z: FRONT_Z - 0.7 };
edges.push(["exit", "exitLane"], ["exitLane", "door"]);

const adjacency = new Map<string, string[]>();
for (const [a, b] of edges) {
  if (!adjacency.has(a)) adjacency.set(a, []);
  if (!adjacency.has(b)) adjacency.set(b, []);
  adjacency.get(a)!.push(b);
  adjacency.get(b)!.push(a);
}

export const ROUTE_NODES: Readonly<Record<string, Point>> = nodes;
export const BROWSE_STOPS: readonly BrowseStop[] = browseStops;

/** Till customer spot, then the queue: straight back, then east. Index 0 = being served. */
export const QUEUE_SLOTS: readonly Point[] = [
  { x: TILL_X, z: TILL_Z - 0.85 },
  { x: TILL_X, z: TILL_Z - 1.6 },
  { x: TILL_X, z: TILL_Z - 2.35 },
  { x: TILL_X + 0.75, z: TILL_Z - 2.35 },
  { x: TILL_X + 1.5, z: TILL_Z - 2.35 },
  { x: TILL_X + 2.25, z: TILL_Z - 2.35 },
];

/** Shortest node path (inclusive) by BFS; [] when unreachable. */
export function findPath(from: string, to: string): string[] {
  if (!adjacency.has(from) || !adjacency.has(to)) return [];
  if (from === to) return [from];
  const previous = new Map<string, string>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        let step = to;
        while (step !== from) {
          step = previous.get(step)!;
          path.unshift(step);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

/** Node path → world points. */
export function pathPoints(path: readonly string[]): Point[] {
  return path.map((id) => ({ ...nodes[id] }));
}
