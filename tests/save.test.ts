import { describe, it, expect } from "vitest";
import { saveGame, loadGame } from "../src/state/save";

const stub = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void m.clear(),
    key: () => null, length: 0,
  } as Storage;
};

describe("save/load", () => {
  it("round-trips money", () => {
    const s = stub();
    saveGame({ version: 1, moneySen: 3235 }, s);
    expect(loadGame(s)).toEqual({ version: 1, moneySen: 3235 });
  });
  it("returns null on corrupt JSON", () => {
    const s = stub();
    s.setItem("supermarket-sim-save", "{not json");
    expect(loadGame(s)).toBeNull();
  });
  it("returns null on wrong version", () => {
    const s = stub();
    s.setItem("supermarket-sim-save", JSON.stringify({ version: 99, moneySen: 1 }));
    expect(loadGame(s)).toBeNull();
  });
  it("returns null when empty", () => {
    expect(loadGame(stub())).toBeNull();
  });
});
