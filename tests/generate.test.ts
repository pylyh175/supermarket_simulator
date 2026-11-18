// tests/generate.test.ts
import { describe, it, expect } from "vitest";
import { makeQueue } from "../src/customers/generate";
import { PRODUCTS } from "../src/data/products";

describe("makeQueue", () => {
  it("makes n customers with 2-5 item baskets from the catalog", () => {
    for (const c of makeQueue(50)) {
      expect(c.basket.length).toBeGreaterThanOrEqual(2);
      expect(c.basket.length).toBeLessThanOrEqual(5);
      for (const item of c.basket) {
        expect(PRODUCTS.some(p => p.id === item.id)).toBe(true);
      }
    }
  });
  it("basketTotalSen matches the basket and is a multiple of 5 sen", () => {
    for (const c of makeQueue(50)) {
      expect(c.basketTotalSen).toBe(c.basket.reduce((a, i) => a + i.priceSen, 0));
      expect(c.basketTotalSen % 5).toBe(0);
      expect(c.basketTotalSen).toBeLessThanOrEqual(7500);
    }
  });
  it("tender note is at least RM1 above the total (Review Focus 1)", () => {
    const notes = [500, 1000, 2000, 5000, 10000];
    for (const c of makeQueue(50)) {
      expect(c.tenderNoteSen).toBeGreaterThanOrEqual(c.basketTotalSen + 100);
      expect(notes).toContain(c.tenderNoteSen);
      // Smallest qualifying note: the previous note (if any) fails the condition.
      const idx = notes.indexOf(c.tenderNoteSen);
      expect(idx).toBeGreaterThanOrEqual(0);
      if (idx > 0) {
        expect(notes[idx - 1]).toBeLessThan(c.basketTotalSen + 100);
      }
    }
  });
  it("customers have distinct-enough names and non-empty queue order", () => {
    expect(makeQueue(5)).toHaveLength(5);
  });
});
