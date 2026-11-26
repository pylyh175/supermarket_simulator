/**
 * Walkable routes for customers — a small waypoint graph over the store's
 * aisles (pure, no three.js). Customers only walk along these lanes, so they
 * never clip through shelves.
 *
 * Store (x −10..10, z −7..7): entrance doorway at (0, −7); shelf rows run
 * along z (−5.2..0.2) at x = −6.75, −2.25, 2.25, 6.75; the till's customer
 * spot is (0, 2.2) with the queue trailing back-west toward the aisles.
 *
 *   door ─ Nc ─ Nw / Ne                     (north cross-aisle, z = −6.1)
 *   lanes x = −4.5, 0, 4.5 run Nx → Sx      (aisles between rows)
 *   outer lanes x = ±8.6 dead-end at z = −4.4
 *   Sww ─ Sw ─ Sc ─ Se ─ See                (south cross-aisle, z = 0.9)
 */

export interface Point {
  x: number;
  z: number;
}

export interface BrowseStop {
  /** Lane node the shopper steps out from. */
  node: string;
  /** Where they stand, an arm's length from the shelf face. */
  stand: Point;
  /** Point they look at (the shelf). */
  look: Point;
}

const nodes: Record<string, Point> = {
  door: { x: 0, z: -6.75 },
  Nw: { x: -4.5, z: -6.1 },
  Nc: { x: 0, z: -6.1 },
  Ne: { x: 4.5, z: -6.1 },
  Sww: { x: -8.6, z: 0.9 },
  Sw: { x: -4.5, z: 0.9 },
  Sc: { x: 0, z: 0.9 },
  Se: { x: 4.5, z: 0.9 },
  See: { x: 8.6, z: 0.9 },
  exit: { x: 1.1, z: 1.75 },
};

const edges: [string, string][] = [
  ["door", "Nc"],
  ["Nw", "Nc"],
  ["Nc", "Ne"],
  ["Sww", "Sw"],
  ["Sw", "Sc"],
  ["Sc", "Se"],
  ["Se", "See"],
  ["exit", "Sc"],
];

const LANE_ZS = [-4.4, -2.5, -0.7];
const lanes: { x: number; north: string | null; south: string; key: string }[] = [
  { x: -4.5, north: "Nw", south: "Sw", key: "w" },
  { x: 0, north: "Nc", south: "Sc", key: "c" },
  { x: 4.5, north: "Ne", south: "Se", key: "e" },
  { x: -8.6, north: null, south: "Sww", key: "ww" },
  { x: 8.6, north: null, south: "See", key: "ee" },
];

/** Shelf faces either side of each lane: [standX, faceX] pairs. */
const LANE_SHELVES: Record<string, [number, number][]> = {
  w: [[-5.9, -6.5], [-3.1, -2.5]],
  c: [[-1.45, -2.0], [1.45, 2.0]],
  e: [[3.1, 2.5], [5.9, 6.5]],
  ww: [[-7.6, -7.0]],
  ee: [[7.6, 7.0]],
};

const browseStops: BrowseStop[] = [];

for (const lane of lanes) {
  let previous = lane.north;
  LANE_ZS.forEach((z, i) => {
    const id = `L${lane.key}${i}`;
    nodes[id] = { x: lane.x, z };
    if (previous) edges.push([previous, id]);
    previous = id;
    for (const [standX, faceX] of LANE_SHELVES[lane.key]) {
      browseStops.push({ node: id, stand: { x: standX, z }, look: { x: faceX, z } });
    }
  });
  if (previous) edges.push([previous, lane.south]);
}

const adjacency = new Map<string, string[]>();
for (const [a, b] of edges) {
  if (!adjacency.has(a)) adjacency.set(a, []);
  if (!adjacency.has(b)) adjacency.set(b, []);
  adjacency.get(a)!.push(b);
  adjacency.get(b)!.push(a);
}

export const ROUTE_NODES: Readonly<Record<string, Point>> = nodes;
export const BROWSE_STOPS: readonly BrowseStop[] = browseStops;

/** Till customer spot, then the queue trailing west. Index 0 = being served. */
export const QUEUE_SLOTS: readonly Point[] = [
  { x: 0, z: 2.2 },
  { x: -0.85, z: 1.7 },
  { x: -1.6, z: 1.45 },
  { x: -2.35, z: 1.2 },
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
