/**
 * Cash drawer contents — a count per denomination (integer sen keys).
 * Pure and immutable: every function returns a new drawer.
 *
 * Each day starts with an RM200 float. When a slot runs low the supervisor
 * brings a bundle / coin roll (topUp) so the cashier never gets stuck — the
 * cash added is tracked so the end-of-day count still balances.
 */
import { DENOMS_SEN } from "../data/denominations";

export type Drawer = Readonly<Record<number, number>>;

/** Opening float: RM200 in a mix that can make any change. */
const FLOAT_COUNTS: Readonly<Record<number, number>> = {
  10000: 0,
  5000: 0,
  2000: 2, // RM40
  1000: 5, // RM50
  500: 10, // RM50
  100: 20, // RM20
  50: 40, // RM20
  20: 50, // RM10
  10: 60, // RM6
  5: 80, // RM4
};

export const FLOAT_SEN = 20000;

/** Bundle / roll the supervisor brings per denomination. */
const TOP_UP_COUNTS: Readonly<Record<number, number>> = {
  2000: 5,
  1000: 10,
  500: 10,
  100: 20,
  50: 20,
  20: 40,
  10: 40,
  5: 40,
};

/** Below this many pieces a slot counts as "running low". */
function lowThreshold(denomSen: number): number {
  if (denomSen >= 1000) return 2;
  return denomSen >= 100 ? 3 : 6;
}

export function startingFloat(): Drawer {
  return { ...FLOAT_COUNTS };
}

export function drawerTotalSen(d: Drawer): number {
  let total = 0;
  for (const denom of DENOMS_SEN) total += denom * (d[denom] ?? 0);
  return total;
}

export function deposit(d: Drawer, pieces: readonly number[]): Drawer {
  const next: Record<number, number> = { ...d };
  for (const p of pieces) next[p] = (next[p] ?? 0) + 1;
  return next;
}

/** Take one piece out; null when that slot is empty. */
export function withdraw(d: Drawer, denomSen: number): Drawer | null {
  const count = d[denomSen] ?? 0;
  if (count <= 0) return null;
  return { ...d, [denomSen]: count - 1 };
}

/** Change-giving slots (RM20 and below) that are running low. */
export function lowDenominations(d: Drawer): number[] {
  return DENOMS_SEN.filter(
    (denom) => TOP_UP_COUNTS[denom] !== undefined && (d[denom] ?? 0) < lowThreshold(denom),
  );
}

export function topUp(d: Drawer, denomSen: number): { drawer: Drawer; addedSen: number } {
  const pieces = TOP_UP_COUNTS[denomSen] ?? 0;
  return {
    drawer: { ...d, [denomSen]: (d[denomSen] ?? 0) + pieces },
    addedSen: pieces * denomSen,
  };
}
