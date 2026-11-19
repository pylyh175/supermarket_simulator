import { describe, it, expect } from "vitest";
import {
  resolveTooltip,
  tagProduct,
  TOOLTIP_MAX_DISTANCE_M,
} from "../src/game/hover";

describe("resolveTooltip", () => {
  it("resolves milo-300g to its name and formatted price", () => {
    expect(resolveTooltip("milo-300g")).toEqual({ title: "Milo 300g", price: "RM14.90" });
  });

  it("resolves soap-bar to its name and formatted price", () => {
    expect(resolveTooltip("soap-bar")).toEqual({ title: "Soap Bar", price: "RM1.65" });
  });

  it("returns null for an unknown id", () => {
    expect(resolveTooltip("nonsense-id")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(resolveTooltip(undefined)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(resolveTooltip(null)).toBeNull();
  });
});

describe("TOOLTIP_MAX_DISTANCE_M", () => {
  it("is 2.2 meters", () => {
    expect(TOOLTIP_MAX_DISTANCE_M).toBe(2.2);
  });
});

describe("tagProduct", () => {
  it("sets userData.productId and leaves other keys untouched", () => {
    const obj = { userData: { productId: "old", other: "keep-me", count: 42 } };
    tagProduct(obj, "maggi-curry");
    expect(obj.userData.productId).toBe("maggi-curry");
    expect(obj.userData.other).toBe("keep-me");
    expect(obj.userData.count).toBe(42);
  });
});
