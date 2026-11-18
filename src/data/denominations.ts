// Denominations in sen. RM100 (10000) is tender-only downstream (Task 5) but
// stays in the list so the change pad is complete. Note: 100 sen (RM1) is a
// listed denomination per the brief's notes list and its makeChange(3655)
// example — the brief's DENOMS_SEN array omitted it; tests require it.
export const DENOMS_SEN: number[] = [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5];

export const DENOM_LABELS: Record<number, string> = {
  10000: "RM100",
  5000: "RM50",
  2000: "RM20",
  1000: "RM10",
  500: "RM5",
  100: "RM1",
  50: "50 sen",
  20: "20 sen",
  10: "10 sen",
  5: "5 sen",
};
