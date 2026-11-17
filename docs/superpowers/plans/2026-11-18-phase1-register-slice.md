# Phase 1: Register Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable register-only slice of the Malaysian supermarket sim: walk a small store, serve customers at the till (scan items, take payment, give exact change), with a persistent money tally.

**Architecture:** Phaser 3 renders the store and player movement; the till is an HTML/CSS overlay driven by a pure TypeScript state machine. All money logic is integer sen. Game logic (catalog, change math, session, customer generation, save) lives in dependency-free modules under `src/` that Vitest can test; Phaser scenes and the DOM overlay are thin glue verified by manual playtest.

**Tech Stack:** TypeScript 5, Vite, Phaser ^3.87, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-supermarket-sim-design.md`

## Global Constraints

- TypeScript + Vite + Phaser 3; **no runtime dependencies beyond Phaser** (dev deps: vite, typescript, vitest only).
- All money is **integer sen** — never floats, never strings in logic. Display formatting is the only place sen become text.
- Prices are multiples of 5 sen; denominations (sen): notes 5000, 2000, 1000, 500, 100; coins 50, 20, 10, 5.
- Desktop keyboard + mouse: WASD/arrows move, E/Space interact, mouse for UI.
- Cozy tone: no fail states, no timers, no penalties — feedback is gentle.
- Phase 1 art = flat colored shapes/placeholder sprites (clean, colorful); asset-pack integration is a later phase.
- Saves in localStorage; corrupt/missing storage must never block boot.

## Review Focus

The failure modes most likely to bite a player, each pinned by a test in its owning task:

1. **Money not a multiple of 5 sen** (float artifacts, bad catalog data) — a customer could be owed change the player cannot physically give. Expect: `makeChange` throws on invalid input; catalog data validated at load. Test in Task 2/3.
2. **Customer pays less than the total** — expect the session to refuse the payment and stay in `paying`. Test in Task 4.
3. **Double-scanning or scanning after payment starts** — total must not change and phase must not regress. Expect: `scanNext` is a no-op once all items are scanned. Test in Task 4.
4. **Overshooting the change** — player taps one note too many. Expect: overshoot is allowed (register shows "Too much"), undo takes the last denomination back, customer only leaves when given == changeDue exactly. Test in Task 4.
5. **Corrupt or missing localStorage** — expect the game boots with defaults, never crashes. Test in Task 9.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/scenes/BootScene.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: runnable `npm run dev` (Vite + Phaser canvas), runnable `npm test` (Vitest). `BootScene` registered in `src/main.ts` as the pattern all later scenes follow.

- [ ] **Step 1: Scaffold the project**

Run: `npm init -y && npm i phaser@^3.87 && npm i -D typescript vite vitest`
Then write minimal `tsconfig.json` (`strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `include: src`), `vite.config.ts`, `index.html` (fullscreen `<div id="game">`, black background), `src/main.ts` creating a `Phaser.Game` (WebGL/auto, scale mode RESIZE) with `BootScene` (clears to warm cream `#f5efe0`, shows text "Phase 1").

- [ ] **Step 2: Write the smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";
describe("scaffold", () => {
  it("runs vitest", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 3: Run test**

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 4: Verify dev server**

Run: `npm run dev` (background) — open the printed URL.
Expected: cream-colored canvas fills the window, "Phase 1" text visible.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + typescript + phaser + vitest"
```

---

### Task 2: Money module + product catalog

**Files:**
- Create: `src/register/money.ts`, `src/data/products.ts`
- Test: `tests/money.test.ts`

**Interfaces:**
- Produces: `formatRinggit(sen: number): string` — always two decimals (`formatRinggit(1345)` → `"RM13.45"`, `formatRinggit(1300)` → `"RM13.00"`, negative never occurs). `src/data/products.ts` exports `PRODUCTS: Product[]` and `Product = { id: string; name: string; priceSen: number }` where `id` is a stable kebab-case string, `priceSen` a multiple of 5, between 5 and 1500. Starter catalog of ~12 Malaysian items (e.g. milo-300g RM18.90, maggi-curry RM6.20, roti-canai-frozen RM9.95, nasi-lemak-bungkus RM4.50, tens-egg RM13.45, kuih-bahulu RM8.80, susu-fullcream RM7.15, mee-hoon RM5.25, telur-10pk, kopi-3in1, bicarbonate-250g, soap-bar — exact names/prices are the implementer's choice within the Product rules above).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/money.test.ts
import { describe, it, expect } from "vitest";
import { formatRinggit } from "../src/register/money";

describe("formatRinggit", () => {
  it("formats sen", () => { expect(formatRinggit(1345)).toBe("RM13.45"); });
  it("pads to two decimals", () => { expect(formatRinggit(1300)).toBe("RM13.00"); });
  it("formats zero", () => { expect(formatRinggit(0)).toBe("RM0.00"); });
});
```

Plus a catalog validity test: every `PRODUCTS` entry has non-empty `name`, `priceSen % 5 === 0`, `5 <= priceSen <= 1500`.

- [ ] **Step 2: Run tests — expect FAIL** (`Cannot find module .../money`)

Run: `npm test`

- [ ] **Step 3: Implement `src/register/money.ts` and `src/data/products.ts`**

`formatRinggit`: `(sen / 100).toFixed(2)` prefixed with `RM`. Catalog per the Interface spec above.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ringgit formatting and starter product catalog"
```

---

### Task 3: Change calculator

**Files:**
- Create: `src/register/change.ts`, `src/data/denominations.ts`
- Test: `tests/change.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (self-contained).
- Produces: `src/data/denominations.ts` exports `DENOMS_SEN: number[]` = `[10000, 5000, 2000, 1000, 500, 50, 20, 10, 5]` (RM100 is tender-only — see Task 5's tender list — but stays here so the change pad is complete) and `DENOM_LABELS: Record<number, string>` (e.g. `5000 → "RM50"`, `50 → "50 sen"`). `src/register/change.ts` exports `makeChange(changeDueSen: number): number[]` — greedy breakdown, returned largest-first as a flat list of denominations, e.g. `makeChange(3655)` → `[2000, 1000, 500, 100, 50, 5]` (RM36.55 = 20+10+5+1 + 50+5 sen). Throws `Error` if `changeDueSen % 5 !== 0`, negative, or greedy cannot represent it exactly.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests — expect FAIL** (`Cannot find module .../change`)

Run: `npm test`

- [ ] **Step 3: Implement `src/data/denominations.ts` and `src/register/change.ts`**

`makeChange`: greedy pass over `DENOMS_SEN` descending; after the pass, verify the collected list sums to the input, else throw.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: exact change calculator with validation"
```

---

### Task 4: Register session state machine

**Files:**
- Create: `src/register/session.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: nothing (pure logic; item totals arrive as `priceSen`).
- Produces — the contract the UI (Task 7) and scenes (Task 8) build on:

```ts
type Phase = "scanning" | "paying" | "change" | "done";
interface Session {
  readonly items: { id: string; name: string; priceSen: number }[];
  readonly scanned: number;      // items scanned so far
  readonly totalSen: number;     // sum of scanned items
  readonly tenderedSen: number | null;
  readonly changeDueSen: number; // 0 until payment
  readonly given: number[];      // denominations dispensed, in tap order
  readonly givenSen: number;     // sum of given
  readonly phase: Phase;
}
createSession(items: Session["items"]): Session
scanNext(s: Session): Session        // scans items[scanned]; no-op unless phase === "scanning" && scanned < items.length
receivePayment(s: Session, noteSen: number): Session // only when all scanned; note >= total required; sets tenderedSen, changeDueSen = noteSen - totalSen, phase "change"; refuses (no-op) otherwise
dispense(s: Session, denomSen: number): Session      // only in "change"; allows overshoot; when givenSen === changeDueSen → phase "done"
undoDispense(s: Session): Session    // pops last denomination; no-op if given is empty or phase !== "change"
```

All functions return a **new** Session (no mutation). Phase transitions: after the last scan the phase becomes `paying` (waiting for the customer to hand over a note); `receivePayment` moves `paying → change`; exact `dispense` moves `change → done`.

- [ ] **Step 1: Write the failing tests**

Pin each Review Focus rule plus the happy path:

```ts
// tests/session.test.ts
import { describe, it, expect } from "vitest";
import { createSession, scanNext, receivePayment, dispense, undoDispense } from "../src/register/session";

const basket = [
  { id: "milo", name: "Milo 300g", priceSen: 1890 },
  { id: "tens", name: "Tens eggs", priceSen: 1345 },
];
const paid = (s: ReturnType<typeof createSession>) =>
  receivePayment(scanNext(scanNext(s)), 5000);

describe("session", () => {
  it("scans items and totals in sen", () => {
    const s1 = scanNext(createSession(basket));
    expect(s1.totalSen).toBe(1890);
    expect(s1.phase).toBe("scanning");
    const s2 = scanNext(s1);
    expect(s2.totalSen).toBe(3235);
    expect(s2.phase).toBe("paying");
  });
  it("refuses to scan past the end (Review Focus 3)", () => {
    const s = scanNext(scanNext(createSession(basket)));
    expect(scanNext(s)).toEqual(s);
  });
  it("computes change due", () => {
    const s = paid(createSession(basket));
    expect(s.changeDueSen).toBe(5000 - 3235);
    expect(s.phase).toBe("change");
  });
  it("refuses a note smaller than the total (Review Focus 2)", () => {
    const s = scanNext(scanNext(createSession(basket)));
    expect(receivePayment(s, 1000)).toEqual(s);
  });
  it("dispenses to exact and finishes", () => {
    const s = paid(createSession(basket));                  // change due: 5000 - 3235 = 1765
    const due = s.changeDueSen;
    const s2 = dispense(dispense(s, 1000), 500);            // 1500
    const s3 = s2.givenSen < due ? dispense(s2, 200) : s2;  // 1700
    const s4 = s3.givenSen < due ? dispense(s3, 50) : s3;   // 1750
    const s5 = s4.givenSen < due ? dispense(s4, 10) : s4;   // 1760
    const s6 = s5.givenSen < due ? dispense(s5, 5) : s5;    // 1765 = due
    expect(s6.givenSen).toBe(1765);
    expect(s6.phase).toBe("done");
  });
  it("allows overshoot and undo takes it back (Review Focus 4)", () => {
    const s = paid(createSession(basket));
    const over = dispense(s, 2000);
    expect(over.givenSen).toBe(2000);
    expect(over.phase).toBe("change"); // not done
    expect(undoDispense(over)).toEqual(s);
  });
  it("dispense and undo are no-ops outside the change phase", () => {
    const s = createSession(basket);
    expect(dispense(s, 100)).toEqual(s);
    expect(undoDispense(s)).toEqual(s);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL** (`Cannot find module .../session`)

Run: `npm test`

- [ ] **Step 3: Implement `src/register/session.ts`**

Pure functions exactly per the Interface block. No Phaser, no DOM, no imports from other tasks.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: till session state machine (scan, pay, change)"
```

---

### Task 5: Customer generation

**Files:**
- Create: `src/customers/generate.ts`
- Test: `tests/generate.test.ts`

**Interfaces:**
- Consumes: `PRODUCTS: Product[]` (Task 2).
- Produces: `makeQueue(n: number): Customer[]` and `Customer = { name: string; basket: { id: string; name: string; priceSen: number }[]; basketTotalSen: number; tenderNoteSen: number }`. `basket` is 2–5 items drawn from `PRODUCTS` (repeats allowed). `tenderNoteSen` is the smallest note from `[500, 1000, 2000, 5000, 10000]` that is ≥ `basketTotalSen + 100` (so every customer needs change of at least RM1). `name` from a friendly Malaysian list (e.g. Aisyah, Wei Ming, Ravi, Siti, Daniel, Mei Ling, Farhan, Nurul — implementer's choice of 8+ names).

- [ ] **Step 1: Write the failing tests**

```ts
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
    for (const c of makeQueue(50)) {
      expect(c.tenderNoteSen).toBeGreaterThanOrEqual(c.basketTotalSen + 100);
      expect([500, 1000, 2000, 5000, 10000]).toContain(c.tenderNoteSen);
      expect(c.tenderNoteSen - 100).toBeGreaterThan(c.basketTotalSen - 500); // smallest such note
    }
  });
  it("customers have distinct-enough names and non-empty queue order", () => {
    expect(makeQueue(5)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test`

- [ ] **Step 3: Implement `src/customers/generate.ts`**

Random basket draw; note selection per Interface. (Deterministic seeding not required — randomness is fine for the game; tests only assert ranges/relations.)

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: customer and basket generation"
```

---

### Task 6: Store scene — walkable floor and till zone

**Files:**
- Create: `src/scenes/StoreScene.ts`, `src/entities/Player.ts`
- Modify: `src/main.ts` (register `StoreScene`, start it after `BootScene`)

**Interfaces:**
- Produces: `StoreScene` with a till interaction zone; when the player stands in it and presses E/Space, the scene calls `this.scene.launch("RegisterOverlay")` (Task 7's key) and pauses player movement; when the overlay signals completion (`this.events.emit("till:closed")`), movement resumes. `Player` handles WASD/arrow movement with simple rectangle bounds (store walls) at speed ~160 px/s. Placeholder art: cream floor, 3–4 gray shelf rectangles, a wooden counter rectangle, red-circle player.
- No unit tests (thin Phaser glue). **Verification is the manual checklist below.**

- [ ] **Step 1: Implement `Player` and `StoreScene`**

Player: velocity movement, clamped to store bounds. StoreScene: small single-room layout — entrance at top, shelves left/right, counter at bottom-center with a highlighted till zone (subtle pulsing border when the player is inside). "Press E" hint text above the counter when in the zone.

- [ ] **Step 2: Manual playtest checklist**

Run: `npm run dev` (background), open the URL:
- WASD/arrows move the player; arrows and WASD both work.
- Player cannot walk through walls/shelves/counter.
- Entering the till zone shows the "Press E" hint; pressing E launches the (empty-for-now) overlay path and freezes movement; emitting `till:closed` (temporary debug: press Escape to emit it) restores movement.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: walkable store scene with till interaction zone"
```

---

### Task 7: Register overlay UI

**Files:**
- Create: `src/scenes/RegisterOverlay.ts`, `src/ui/register.css`, and the overlay skeleton in `index.html` (a `#register-ui` div hidden by default)
- Test: none (DOM glue over tested logic). **Verification: checklist.**

**Interfaces:**
- Consumes: everything in Tasks 2–5 — `PRODUCTS`, `formatRinggit`, `DENOMS_SEN`, `DENOM_LABELS`, `makeChange` (for a hint tooltip only — the display itself shows only the change **due**, computed by the session), `createSession/scanNext/receivePayment/dispense/undoDispense`, `Customer` (Task 5).
- Produces: Phaser Scene `"RegisterOverlay"` (`this.scene.launch("RegisterOverlay", { customer })`). Renders as a full-screen HTML overlay; on completion emits `this.events.emit("till:closed")` and shuts itself down (`this.scene.stop`).

- [ ] **Step 1: Implement the overlay**

Layout (top to bottom):
1. **Conveyor strip** — the customer's items as colored chips sliding left→right (CSS animation); each unscanned chip is clickable, and E also scans the frontmost unscanned item; scanned chips turn green with a tick.
2. **Register display** — big, dark LCD-style panel: running total while scanning; after payment: "Paid RM50.00 — Change due RM36.55", plus a "Given so far: RMxx.xx" line and a "Too much!" flash (soft amber, never red/error) when `givenSen > changeDueSen`.
3. **Change pad** — appears only in `phase: "change"`: buttons for each denomination (`DENOM_LABELS`), tapping calls `dispense`; an **Undo** button calls `undoDispense`. When `phase: "done"`: show "Thank you!" for ~1s, then emit `till:closed`.
4. **Customer line** — customer name and what they hand over: "Aisyah pays with RM50".

All rendering is a `render(session, customer)` function called after every state change (no framework).

- [ ] **Step 2: Manual playtest checklist**

Wire a temporary debug entry: pressing E at the till launches the overlay with a hard-coded customer.
- Chips slide, click scans one at a time, total updates live, E scans frontmost.
- After the last scan, the customer "pays" automatically after a 1-second beat; change due appears.
- Change pad buttons update "Given so far"; tapping until exact shows "Thank you!" and closes.
- Tapping one denomination too many shows the soft "Too much!" flash; Undo removes it; exact match still completes.
- Escape closes the overlay at any time (till session abandoned — the customer simply leaves).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: register overlay UI (conveyor, display, change pad)"
```

---

### Task 8: Customer loop — the playable slice

**Files:**
- Modify: `src/scenes/StoreScene.ts`, `src/scenes/RegisterOverlay.ts`
- Test: none beyond Tasks 4–5's logic tests. **Verification: checklist.**

**Interfaces:**
- Consumes: `makeQueue` (Task 5) for an endless queue (generate 10, refill when low), the full session flow (Task 4).
- Produces: the Phase 1 vertical slice end-to-end.

- [ ] **Step 1: Wire the loop**

`StoreScene` keeps a customer queue; one at a time, a customer sprite (colored capsule + name label) walks from the entrance to the counter (simple tween, unhurried pace — ~3 s). When the player presses E at the till, the head customer's data launches `RegisterOverlay`. On `till:done` (exact change given), the customer walks out, the store's money tally increases by the total, the next customer walks up. On overlay-abandoned (`Escape`), the current customer walks away and the queue advances. A small HUD (top-left, DOM): "Money: RMxxx.xx".

- [ ] **Step 2: Manual playtest — the full Phase 1 checklist**

Run: `npm run dev`:
- Walk to the till, serve a full customer end-to-end (scan → pay → exact change → leave).
- Serve 3 customers in a row; money tally increases by each total.
- Walk away mid-service (Escape); customer leaves unhurried; the next one comes.
- Confirm nothing can be stress-y: no timers, no red errors, customers wait patiently forever.
- Reload the page — money tally persists (Task 9) or, if Task 9 is not done yet, note the gap and proceed to Task 9.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: end-to-end customer loop at the till"
```

---

### Task 9: Save and load

**Files:**
- Create: `src/state/save.ts`
- Modify: `src/scenes/StoreScene.ts` (load on create, save on money change)
- Test: `tests/save.test.ts`

**Interfaces:**
- Consumes: nothing (pure logic with an injectable storage).
- Produces: `SaveData = { version: 1; moneySen: number }`; `saveGame(data: SaveData, storage?: Storage): void` and `loadGame(storage?: Storage): SaveData | null`. `storage` defaults to `localStorage`. Unknown/missing version, unparseable JSON, or missing key → `null`. `saveGame` always writes `version: 1`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/save.test.ts
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
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test`

- [ ] **Step 3: Implement `src/state/save.ts` and wire it into `StoreScene`**

Load on scene create (null → `{ version: 1, moneySen: 0 }`); save whenever money changes.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test`

- [ ] **Step 5: Manual check + commit**

Run: `npm run dev` — serve customers, reload the page, confirm the money tally survived.

```bash
git add -A && git commit -m "feat: persistent money tally via localStorage"
```

---

## Phase 1 Definition of Done

- All Vitest suites pass (`npm test`).
- Task 8's full manual checklist passes, including "nothing about it feels stressful".
- `npm run build` succeeds with no TypeScript errors.
- The human has playtested and approved the slice's cozy feel.
