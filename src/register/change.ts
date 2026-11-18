import { DENOMS_SEN } from "../data/denominations";

/**
 * Greedy breakdown of change due, returned largest-first as a flat list of
 * denominations. All arithmetic is integer sen.
 *
 * Throws if changeDueSen is negative, not a multiple of 5 sen, or cannot be
 * represented exactly by DENOMS_SEN.
 */
export function makeChange(changeDueSen: number): number[] {
  if (changeDueSen < 0) {
    throw new Error(`change due cannot be negative, got ${changeDueSen}`);
  }
  if (changeDueSen % 5 !== 0) {
    throw new Error(`change due must be a multiple of 5 sen, got ${changeDueSen}`);
  }

  const result: number[] = [];
  let remaining = changeDueSen;
  for (const denom of DENOMS_SEN) {
    while (remaining >= denom) {
      result.push(denom);
      remaining -= denom;
    }
  }

  if (remaining !== 0) {
    throw new Error(`cannot make exact change for ${changeDueSen} sen`);
  }
  return result;
}
