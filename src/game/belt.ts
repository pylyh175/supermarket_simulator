// src/game/belt.ts
//
// Pure belt logic for the checkout flow. No three.js, no DOM — this module is
// importable from the unit-test suite and drives the 3D checkout controller.
//
// Coordinate frame: x is measured in metres from the belt's WESTERN lip.
// The belt runs west → east (−x → +x). Items spawn at x = 0 in "sliding"
// state (callers decide WHEN to place them; the belt never seeds items),
// slide east until they reach the scan-wait position, wait to be scanned,
// then — once scanned — slide east faster as "bagging" and are dropped from
// the belt (stripBagging) once they pass the bag exit. All functions are pure:
// they return new belt/item objects and never mutate their inputs.
//
// Distances come from a BeltGeometry. DEFAULT_BELT_GEOMETRY keeps the values
// the unit suite pins; the 3D checkout passes its own geometry because the
// shipped glTF counter is far narrower than the procedural fallback.
//
// scanFront tie-break: placeNext always spawns at x = 0 and advance clamps at
// the scan-wait position, so a max-x tie can only happen between freshly
// spawned items. scanFront resolves ties by taking the FIRST-placed candidate
// (basket order), which is stable.
//
// advance never drops items; stripBagging is the explicit drop step — call it
// after observing items at x ≥ bagExitX (e.g. once the bag tip-in tween has
// started for a bagging item).
//
// advance enforces BELT_SPACING_M between neighbours: only the frontmost
// sliding item can reach SCAN_WAIT_X_M — followers queue at least
// BELT_SPACING_M behind the item ahead, so the belt never stacks packs on the
// scanner. Spawn positions overlap only when a caller ignores placement
// cadence; advance never moves an item backwards to "fix" that.

export const BELT_SPEED_MPS = 0.9;
export const BELT_SPACING_M = 0.28;
export const BELT_MAX_ITEMS = 5;
export const SCAN_WAIT_X_M = 1.3;
export const BAG_EXIT_X_M = 1.6;

/** Bagging items move at this multiple of BELT_SPEED_MPS. */
const BAGGING_SPEED_FACTOR = 1.4;

/**
 * Physical distances used by the state machine. The constants below are the
 * defaults (and the values the unit suite pins); the 3D checkout derives its
 * own geometry from the measured counter, because the shipped glTF counter is
 * much narrower than the procedural fallback.
 */
export interface BeltGeometry {
  /** Scan-wait position, measured from the western lip. */
  scanWaitX: number;
  /** Bagging items are dropped once x ≥ this distance from the lip. */
  bagExitX: number;
}

export const DEFAULT_BELT_GEOMETRY: BeltGeometry = {
  scanWaitX: SCAN_WAIT_X_M,
  bagExitX: BAG_EXIT_X_M,
};

export type BeltItemState = "sliding" | "waiting" | "bagging";

export interface BeltItem {
  id: string;
  name: string;
  priceSen: number;
  x: number;
  state: BeltItemState;
}

export interface Belt {
  items: BeltItem[];
}

/** Create an empty belt. */
export function createBelt(): Belt {
  return { items: [] };
}

/** Number of items currently on the belt. */
export function queueLength(belt: Belt): number {
  return belt.items.length;
}

/** True while the belt holds fewer than BELT_MAX_ITEMS items. */
export function canPlace(belt: Belt): boolean {
  return belt.items.length < BELT_MAX_ITEMS;
}

/**
 * Append `item` in basket order at x = 0 in "sliding" state. Callers control
 * placement cadence; the belt never seeds items on its own.
 */
export function placeNext(
  belt: Belt,
  item: { id: string; name: string; priceSen: number },
): Belt {
  const beltItem: BeltItem = { ...item, x: 0, state: "sliding" };
  return { ...belt, items: [...belt.items, beltItem] };
}

/**
 * Advance all items by `dt` seconds.
 * - sliding: x = min(x + BELT_SPEED_MPS · dt, scanWaitX, cap); on reaching
 *   scanWaitX the item becomes "waiting". `cap` is the item ahead minus
 *   BELT_SPACING_M (∞ for the frontmost item), so followers queue behind the
 *   scanner instead of stacking on it.
 * - waiting: stays at scanWaitX.
 * - bagging: x += BELT_SPEED_MPS · 1.4 · dt (still capped by the item ahead).
 * Items never move backwards: overlapping spawn positions (callers should
 * gate cadence) simply separate as the item ahead moves off.
 * Never drops items — see stripBagging.
 */
export function advance(
  belt: Belt,
  dt: number,
  geometry: BeltGeometry = DEFAULT_BELT_GEOMETRY,
): Belt {
  if (belt.items.length === 0) return belt;
  const scanWaitX = geometry.scanWaitX;

  const items: BeltItem[] = new Array<BeltItem>(belt.items.length);
  for (let i = 0; i < belt.items.length; i += 1) {
    const item = belt.items[i];
    const cap =
      i === 0 ? Number.POSITIVE_INFINITY : items[i - 1].x - BELT_SPACING_M;
    // Never step backwards when a caller spawned items closer than the
    // spacing (placeNext always spawns at x = 0).
    const limit = Math.max(item.x, cap);

    switch (item.state) {
      case "sliding": {
        const target = Math.min(item.x + BELT_SPEED_MPS * dt, scanWaitX);
        const nextX = Math.min(target, limit);
        items[i] =
          nextX >= scanWaitX
            ? { ...item, x: scanWaitX, state: "waiting" }
            : { ...item, x: nextX };
        break;
      }
      case "waiting":
        items[i] = { ...item, x: scanWaitX };
        break;
      case "bagging":
        items[i] = {
          ...item,
          x: Math.min(item.x + BELT_SPEED_MPS * BAGGING_SPEED_FACTOR * dt, limit),
        };
        break;
    }
  }
  return { ...belt, items };
}

/**
 * Flip the frontmost (max-x) "sliding" or "waiting" item to "bagging".
 * Ties (only possible at spawn x = 0) resolve to the FIRST-placed candidate
 * — stable basket order. Returns null when no such item exists.
 */
export function scanFront(belt: Belt): { belt: Belt; item: BeltItem } | null {
  let frontIndex = -1;
  for (let i = 0; i < belt.items.length; i++) {
    const item = belt.items[i];
    if (item.state !== "sliding" && item.state !== "waiting") continue;
    if (frontIndex === -1 || item.x > belt.items[frontIndex].x) {
      frontIndex = i; // strictly greater → first-placed wins ties
    }
  }
  if (frontIndex === -1) return null;
  const item: BeltItem = { ...belt.items[frontIndex], state: "bagging" };
  const items = belt.items.slice();
  items[frontIndex] = item;
  return { belt: { ...belt, items }, item };
}

/** Drop items with x ≥ bagExitX (typically bagging items past the bag). */
export function stripBagging(
  belt: Belt,
  geometry: BeltGeometry = DEFAULT_BELT_GEOMETRY,
): Belt {
  return {
    ...belt,
    items: belt.items.filter((item) => item.x < geometry.bagExitX),
  };
}
