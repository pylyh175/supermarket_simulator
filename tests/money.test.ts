import { describe, it, expect } from "vitest";
import { formatRinggit } from "../src/register/money";
import { PRODUCTS } from "../src/data/products";

describe("formatRinggit", () => {
  it("formats sen", () => { expect(formatRinggit(1345)).toBe("RM13.45"); });
  it("pads to two decimals", () => { expect(formatRinggit(1300)).toBe("RM13.00"); });
  it("formats zero", () => { expect(formatRinggit(0)).toBe("RM0.00"); });
});

describe("PRODUCTS", () => {
  it("is a starter catalog of 12 items", () => {
    expect(PRODUCTS).toHaveLength(12);
  });

  it("has stable kebab-case ids", () => {
    const ids = PRODUCTS.map((p) => p.id);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has valid entries", () => {
    for (const p of PRODUCTS) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.priceSen % 5).toBe(0);
      expect(p.priceSen).toBeGreaterThanOrEqual(5);
      expect(p.priceSen).toBeLessThanOrEqual(1500);
    }
  });

  it("includes the exact prices given in the brief", () => {
    const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
    expect(byId.get("milo-300g")?.priceSen).toBe(1490);
    expect(byId.get("maggi-curry")?.priceSen).toBe(620);
    expect(byId.get("roti-canai-frozen")?.priceSen).toBe(995);
    expect(byId.get("nasi-lemak-bungkus")?.priceSen).toBe(450);
    expect(byId.get("tens-egg")?.priceSen).toBe(1345);
    expect(byId.get("kuih-bahulu")?.priceSen).toBe(880);
    expect(byId.get("susu-fullcream")?.priceSen).toBe(715);
    expect(byId.get("mee-hoon")?.priceSen).toBe(525);
  });
});
