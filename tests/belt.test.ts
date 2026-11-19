// tests/belt.test.ts
import { describe, it, expect } from "vitest";
import {
  BELT_SPEED_MPS,
  BELT_SPACING_M,
  SCAN_WAIT_X_M,
  BAG_EXIT_X_M,
  BELT_MAX_ITEMS,
  DEFAULT_BELT_GEOMETRY,
  createBelt,
  queueLength,
  canPlace,
  placeNext,
  advance,
  scanFront,
  stripBagging,
  type Belt,
  type BeltItem,
} from "../src/game/belt";

const item = (id: string) => ({ id, name: `Item ${id}`, priceSen: 100 });

describe("belt constants", () => {
  it("pins the verbatim contract values", () => {
    expect(BELT_SPEED_MPS).toBe(0.9);
    expect(BELT_SPACING_M).toBe(0.28);
    expect(SCAN_WAIT_X_M).toBe(1.3);
    expect(BAG_EXIT_X_M).toBe(1.6);
    expect(BELT_MAX_ITEMS).toBe(5);
  });
});

describe("BeltGeometry", () => {
  const shortBelt = { scanWaitX: 0.37, bagExitX: 0.63 };

  it("defaults to the pinned contract values", () => {
    expect(DEFAULT_BELT_GEOMETRY).toEqual({
      scanWaitX: SCAN_WAIT_X_M,
      bagExitX: BAG_EXIT_X_M,
    });
  });

  it("advance respects a custom scan-wait position", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 10, shortBelt);
    expect(belt.items[0].x).toBeCloseTo(shortBelt.scanWaitX, 10);
    expect(belt.items[0].state).toBe("waiting");
  });

  it("stripBagging drops at a custom bag exit", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 10, shortBelt);
    belt = scanFront(belt)!.belt;
    belt = advance(belt, 0.3, shortBelt); // 0.37 + 0.378 = 0.748 ≥ 0.63
    expect(stripBagging(belt, shortBelt).items).toHaveLength(0);
    // The default geometry's bag exit is farther east, so it keeps the item.
    expect(stripBagging(belt).items).toHaveLength(1);
  });
});

describe("createBelt", () => {
  it("creates an empty belt", () => {
    const belt = createBelt();
    expect(belt.items).toEqual([]);
    expect(queueLength(belt)).toBe(0);
    expect(canPlace(belt)).toBe(true);
  });
});

describe("placeNext", () => {
  it("appends items in basket order at x = 0 as sliding", () => {
    let belt = createBelt();
    belt = placeNext(belt, item("a"));
    belt = placeNext(belt, item("b"));
    belt = placeNext(belt, item("c"));
    expect(belt.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    for (const i of belt.items) {
      expect(i.x).toBe(0);
      expect(i.state).toBe("sliding");
    }
    expect(queueLength(belt)).toBe(3);
  });

  it("does not mutate the previous belt", () => {
    const empty = createBelt();
    const placed = placeNext(empty, item("a"));
    expect(empty.items).toEqual([]);
    expect(placed.items).toHaveLength(1);
  });
});

describe("advance", () => {
  it("moves items monotonically toward the scanner", () => {
    let belt = placeNext(createBelt(), item("a"));
    const xs: number[] = [belt.items[0].x];
    for (let i = 0; i < 5; i++) {
      belt = advance(belt, 0.1);
      xs.push(belt.items[0].x);
    }
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
    expect(belt.items[0].x).toBeCloseTo(0.45, 10); // 5 × 0.1 s × 0.9 m/s
  });

  it("front item stops at SCAN_WAIT_X_M and becomes waiting", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 100);
    expect(belt.items[0].x).toBe(SCAN_WAIT_X_M);
    expect(belt.items[0].state).toBe("waiting");
    // waiting stays at SCAN_WAIT under further advance
    belt = advance(belt, 1);
    expect(belt.items[0].x).toBe(SCAN_WAIT_X_M);
    expect(belt.items[0].state).toBe("waiting");
  });

  it("advance on a full waiting belt is stable", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = placeNext(belt, item("b"));
    belt = advance(belt, 100); // front waits at the scanner, follower queues
    const after = advance(belt, 1);
    expect(after.items).toEqual(belt.items);
  });

  it("queues followers at least BELT_SPACING_M behind the front", () => {
    let belt = placeNext(createBelt(), item("front"));
    belt = placeNext(belt, item("back"));
    belt = advance(belt, 100);
    expect(belt.items[0].x).toBe(SCAN_WAIT_X_M);
    expect(belt.items[0].state).toBe("waiting");
    expect(belt.items[1].x).toBeCloseTo(SCAN_WAIT_X_M - BELT_SPACING_M, 10);
    expect(belt.items[1].state).toBe("sliding");
  });

  it("keeps a five-item queue spaced without stacking", () => {
    let belt = createBelt();
    for (let i = 0; i < BELT_MAX_ITEMS; i += 1) {
      belt = placeNext(belt, item(`i${i}`));
    }
    belt = advance(belt, 100);
    for (let i = 1; i < belt.items.length; i += 1) {
      const gap = belt.items[i - 1].x - belt.items[i].x;
      expect(gap).toBeGreaterThanOrEqual(BELT_SPACING_M - 1e-9);
    }
  });

  it("releases the follower once the scanned front moves away", () => {
    let belt = placeNext(createBelt(), item("front"));
    belt = placeNext(belt, item("back"));
    belt = advance(belt, 100); // front waiting at 1.3, back queued at 1.02
    belt = scanFront(belt)!.belt; // front → bagging
    belt = advance(belt, 0.5); // front pulls away, back reaches the scanner
    const back = belt.items.find((i) => i.id === "back")!;
    expect(back.x).toBe(SCAN_WAIT_X_M);
    expect(back.state).toBe("waiting");
  });

  it("never moves an overlapping follower backwards", () => {
    let belt = placeNext(createBelt(), item("front"));
    belt = placeNext(belt, item("back")); // both spawn at x = 0
    belt = advance(belt, 0.01);
    expect(belt.items[1].x).toBe(0);
  });

  it("no-ops are stable: empty belt, dt = 0, and repeated zero-advances", () => {
    const empty = createBelt();
    expect(advance(empty, 1).items).toEqual([]);
    expect(advance(empty, 0)).toEqual(empty);

    let belt = placeNext(createBelt(), item("a"));
    belt = placeNext(belt, item("b"));
    expect(advance(belt, 0).items).toEqual(belt.items);
  });
});

describe("canPlace", () => {
  it("is false at BELT_MAX_ITEMS", () => {
    let belt = createBelt();
    for (let i = 0; i < BELT_MAX_ITEMS; i++) {
      expect(canPlace(belt)).toBe(true);
      belt = placeNext(belt, item(`i${i}`));
    }
    expect(queueLength(belt)).toBe(BELT_MAX_ITEMS);
    expect(canPlace(belt)).toBe(false);
  });
});

describe("scanFront", () => {
  it("returns the max-x item, not just the oldest", () => {
    let belt = placeNext(createBelt(), item("early"));
    belt = advance(belt, 100); // early is at SCAN_WAIT, waiting
    belt = placeNext(belt, item("late")); // x = 0, sliding
    const result = scanFront(belt);
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("early");
    expect(result!.item.state).toBe("bagging");
    const updatedEarly = result!.belt.items.find((i) => i.id === "early")!;
    const untouchedLate = result!.belt.items.find((i) => i.id === "late")!;
    expect(updatedEarly.state).toBe("bagging");
    expect(untouchedLate.state).toBe("sliding");
  });

  it("flips the item to bagging in one call", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 100);
    const result = scanFront(belt)!;
    expect(result.item.state).toBe("bagging");
    const inBelt = result.belt.items.find((i) => i.id === "a")!;
    expect(inBelt.state).toBe("bagging");
    expect(inBelt.x).toBe(SCAN_WAIT_X_M);
  });

  it("breaks the spawn-x tie by first-placed (basket order)", () => {
    let belt = placeNext(createBelt(), item("first"));
    belt = placeNext(belt, item("second")); // both at x = 0
    const result = scanFront(belt)!;
    expect(result.item.id).toBe("first");
  });

  it("ignores bagging items and returns null when only bagging items remain", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 100);
    belt = scanFront(belt)!.belt; // a is bagging, slides east
    expect(scanFront(belt)).toBeNull();
  });
});

describe("bagging motion", () => {
  it("slides faster than sliding items (1.4× belt speed)", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 0.1);
    const slidingStep = belt.items[0].x; // 0.9 × 0.1 = 0.09
    expect(slidingStep).toBeCloseTo(BELT_SPEED_MPS * 0.1, 10);

    const scanned = scanFront(belt)!;
    const bagged = advance(scanned.belt, 0.1);
    const baggingStep = bagged.items[0].x - slidingStep;
    expect(baggingStep).toBeCloseTo(BELT_SPEED_MPS * 1.4 * 0.1, 10);
    expect(baggingStep).toBeCloseTo(slidingStep * 1.4, 10);
  });
});

describe("stripBagging", () => {
  it("drops items with x ≥ BAG_EXIT_X_M", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 100); // a waits at 1.3
    belt = scanFront(belt)!.belt; // a bagging
    belt = advance(belt, 10); // a: 1.3 + 1.4 × 0.9 × 10 = 13.9 ≥ 1.6
    expect(belt.items).toHaveLength(1); // advance does not drop
    belt = stripBagging(belt);
    expect(belt.items).toHaveLength(0);
    expect(queueLength(belt)).toBe(0);
  });

  it("keeps items with x < BAG_EXIT_X_M", () => {
    let belt = placeNext(createBelt(), item("a"));
    belt = advance(belt, 100);
    belt = scanFront(belt)!.belt; // bagging at 1.3 (< 1.6)
    belt = stripBagging(belt);
    expect(belt.items).toHaveLength(1);
    expect(belt.items[0].state).toBe("bagging");
  });
});
