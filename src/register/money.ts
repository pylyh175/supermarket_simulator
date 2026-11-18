/**
 * Money helpers. All money is integer sen — never floats, never strings in
 * logic. Display formatting is the only place sen become text.
 */

/** Format integer sen as a Malaysian ringgit string, e.g. 1345 -> "RM13.45". */
export function formatRinggit(sen: number): string {
  return `RM${(sen / 100).toFixed(2)}`;
}
