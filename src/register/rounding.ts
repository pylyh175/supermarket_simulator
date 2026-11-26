/**
 * Malaysia's rounding mechanism (Bank Negara, since 2008): with no 1-sen
 * coin in circulation, a CASH bill total is rounded to the nearest 5 sen.
 * Card / e-wallet payments pay the exact amount.
 *
 *   last digit 1, 2 → down to 0     last digit 6, 7 → down to 5
 *   last digit 3, 4 → up to 5       last digit 8, 9 → up to 10
 *
 * All values are integer sen.
 */

/** Round a cash total to the nearest 5 sen, Malaysian style. */
export function roundToFiveSen(sen: number): number {
  return sen + cashRoundingAdjustment(sen);
}

/** The "Rounding Adj" receipt line in sen: -2, -1, 0, +1 or +2. */
export function cashRoundingAdjustment(sen: number): number {
  const r = ((sen % 5) + 5) % 5;
  if (r === 0) return 0;
  return r <= 2 ? -r : 5 - r;
}
