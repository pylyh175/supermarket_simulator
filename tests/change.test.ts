// tests/change.test.ts
import { describe, it, expect } from "vitest";
import { makeChange } from "../src/register/change";
import { DENOMS_SEN } from "../src/data/denominations";

describe("makeChange", () => {
  it("breaks RM36.55 greedily", () => {
    expect(makeChange(3655)).toEqual([2000, 1000, 500, 100, 50, 5]);
  });
  it("sums back to the input", () => {
    for (const due of [5, 95, 1905, 4955]) {
      expect(makeChange(due).reduce((a, b) => a + b, 0)).toBe(due);
    }
  });
  it("throws on non-multiple of 5 sen", () => {
    expect(() => makeChange(1342)).toThrow();
  });
  it("throws on negative", () => {
    expect(() => makeChange(-5)).toThrow();
  });
  it("every possible change is payable with DENOMS_SEN", () => {
    for (let sen = 5; sen <= 7500; sen += 5) {
      expect(() => makeChange(sen)).not.toThrow();
    }
  });
});
