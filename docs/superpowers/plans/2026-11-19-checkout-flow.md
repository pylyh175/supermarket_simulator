# Checkout Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A physical cashier pipeline: the customer places packs onto the belt from their tote, items slide east to the scanner, the player scans each with E, the LCD + payment flow runs unchanged in a shrunk "POS readout" strip, and the kraft bag at the east end fills up per sale.

**Architecture:** Pure belt logic (`src/game/belt.ts`, unit-tested) drives placement/advance/scan-gate semantics; a three-scene controller (`src/three/checkoutFlow.ts`) owns props (tote, belt case, scanner glow, kraft bag) and item tweens; the register overlay degrades to a "POS readout" strip (remove conveyor chips; LCD/change pad/hint intact); session, money, saves and till flow are untouched. WebAudio plip/beep cues added.

**Tech Stack:** TypeScript strict, Three.js 0.187, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-supermarket-sim-design.md`; decisions from grilling 2026-11-19 (all binding — see Global Constraints).

## Global Constraints

- TypeScript strict; `npx tsc --noEmit` clean; `npm test` green (87 pre-existing tests keep passing).
- No runtime deps beyond Three.js.
- Integer sen everywhere; `formatRinggit` for display; catalog ids only.
- **Belt orientation `[-x → +x]`: input west (x west of TILL_X), scan at the scanner mat (`cx + MAT_X_FRACTION·size`, existing), bagging at east end.** Belt sits ON the counter at the mat/conveyor heights. (Grilling Q2 — confirmed.)
- **The 3D belt replaces the chips** in the register overlay; session, payment beat, change pad, HUD, saves, till station, abandon flow all UNCHANGED. (Q1, Q4, Q6, Q10 confirmed.)
- **Scan input = `E` scans the item waiting at the scanner** (frontmost), not aiming. (Q4 confirmed.)
- **Abandon (Esc / `completed:false`):** belt items + arcs cleared, session discarded, no credit, customer walks away — today's abandon rule, extended. (Q7 confirmed.)
- **Kraft-paper band tote** on the customer (grill Q3): plain, beige, holds basket clone visuals only.
- **Bag prop (kraft paper bag standing on the counter east end): persists full between sales.** (Q2 confirmed.)
- **Register readout = shrunk "POS strip"** anchored lower-centre of the view; LCD, hint button, customer line, change pad, footer with Esc hint keep working; conveyor chips REMOVED; crosshair/pointer free as today. (Q1, Q10 confirmed.)
- **Sound:** tiny synthesized cues (place "plip", scan "beep") via WebAudio; no files, no deps; never throws; silently no-ops if AudioContext absent. (Q9 confirmed.)
- **Belt speed ~0.9 m/s; spacing ≥ 0.28 m; max ~5 items on belt; placement arcs ≈ 0.6 s; one item place per ≈ 0.75 s while customer places.** (Builder-tuned within these bounds, documented in report.)
- **Commit rule:** subagents never commit; human reviews and commits the working tree.

## Review Focus

1. **Belt items drift/fall through the counter** — props placed on the wrong Y tier (belt surface vs counter top) intersect or float. Expect: belt surface == counter top props height (existing conveyor/mat tops y). Test in Task 3.
2. **Session scans out of order vs items** — belt scans must flip items in the same order `scanNext` fires (basket order) or the wrong item despawns mid-E. Expect: single source of order (belt mirrors basket order). Test in Task 1 and Task 6.
3. **Abandon leaves ghost items** — items left parented on the belt after Esc. Expect: `abandon()` removes every belt item + clears scheduled arcs. Test in Task 3/6.
4. **POS strip breaks identity with overlay** — after removing chips, the `render()` still references chip elements → runtime `requireElement` throw. Expect: chips code removed, `#conveyor` ids gone from skeleton, CSS consistent. Test in Task 4.
5. **AudioContext denies autoplay policy** — cues throw or spam console. Expect: lazy `AudioContext`, resume on first user gesture, silent no-op on failure. Test in Task 5.

---

### Task 1: Pure belt logic + tests (TDD)

**Files:**
- Create: `src/game/belt.ts`, `tests/belt.test.ts`

**Interfaces:**
- Consumes: nothing (pure; catalog `priceSen` passed through callers).
- Produces: `BELT_SPEED_MPS` (0.9), `BELT_SPACING_M` (0.28), `SCAN_WAIT_X_M` (0), `BAG_EXIT_X_M` (1.05), `BELT_MAX_ITEMS` (5) — units measured from belt western lip; `BeltItem = { id, name, priceSen, x, state }`; `state ∈ "sliding" | "waiting" | "bagging"`; `createBelt(): Belt` (empty); `queueLength(b)`; `canPlace(b): boolean`; `placeNext(b, item: { id, name, priceSen }): Belt` (appends item in basket order at x = 0, state "sliding" — callers decide WHEN to place, belt never seeds); `advance(b, dt): Belt`; `scanFront(b): { belt: Belt; item: BeltItem } | null`; `stripBagging(b): Belt` (drops items with x ≥ BAG_EXIT_X_M).

Behavior contract:

```text
createBelt()               → empty
placeNext(b, item)         → items+item at x=0 "sliding"   (caller controls cadence)
advance(b, dt)             → sliding: x = min(x + v·dt, SCAN_WAIT_X_M → "waiting");
                              waiting stays at SCAN_WAIT;
                              bagging: x += v·1.4·dt;
                              stripBagging removes x ≥ BAG_EXIT_X_M
scanFront(b)               → max-x item with state sliding|waiting → "bagging"
```

Tests (all required): empty creation; placeNext appends in order; advance moves items monotonically; front item stops at SCAN_WAIT_X_M and becomes "waiting"; canPlace false at cap; scanFront returns the correct (max-x) item and flips it to bagging in one call; bagging slides faster than sliding; stripBagging drops x ≥ BAG_EXIT_X_M; advance no-ops are stable.

- [ ] **Step 1:** Write the failing tests.
- [ ] **Step 2:** `npm test` — FAIL (module missing).
- [ ] **Step 3:** Implement `src/game/belt.ts` per the interface above.
- [ ] **Step 4:** `npm test` green; `npx tsc --noEmit` clean.
- [ ] **Step 5:** **Do not commit.** Report.

---

### Task 2: Checkout prop builders (bag, tote, belt case)

**Files:**
- Create: `src/three/checkoutProps.ts`

**Interfaces:**
- Produces: `buildBeltProps(scene): { bagGroup, toteGroup, beltGroup }` — belt case = dark slab matching MAT style on the counter's conveyor span (x from western lip to scanner), flat shading; kraft bag = open-top prism with kraft-brown Lambert; tote = kraft-brown prism with rolled top rim, positioned west end of the counter so the customer (at QUEUE_HEAD_Z, north of counter) holds it at hip height on their RIGHT side (west); all procedural, no assets, no disposals needed at hide time (they persist).

- [ ] **Step 1:** Implement the three builders per the interface (constants named; hint: bag/tote ≈ 0.34 × 0.3 × 0.22 m, belt case ≈ same footprint as the existing conveyor).
- [ ] **Step 2:** `npm test` green; `npx tsc --noEmit` clean; dev server HTTP 200. **Do not commit.** Report.

---

### Task 3: Belt 3D runtime — placement arc, items, slide, bag tip-in

**Files:**
- Create: `src/three/checkoutFlow.ts`

**Interfaces:**
- Consumes: `createBelt`/`advance`/`scanFront`/`stripBagging`, `BELT_*` constants (Task 1); `buildBeltProps` (Task 2); `bundle.products` (existing `Map<id, Group>` — clone for belt items; never dispose); TILL anchors imported from `src/three/storeLayout.ts` (`TILL_X`, `interval`)/construct from counter props via `measureBox`? — no: just place by named constants relative to TILL_X/TILL_Z; document them.
- Produces: `CheckoutFlow` class — `begin(customer): void` (west-side tote visible with items as clones created but hidden inside tote; one item placed every ~0.75 s via a parabolic arc: y0 = hip height → apex 0.35 m above belt surface → drop onto belt lip, y ends at belt surface y; belt item cloned at placement position), `update(dt): void` (advance pure state; sync cloned mesh positions; front item waits at scan x; bagging items tween tip-in arc into the bag then destroy), `onItemScanned(): void` (flip front item to bagging), `baggedCount(): number`, `abandon(): void` (clear everything), `isActive(): boolean`, plus the bag prop persists (nothing resets it).
- No per-frame allocations beyond reused Matrix4/Vector3/Quaternion scratch.

- [ ] **Step 1:** Implement belt surface y from counter/mat (belt top ≈ counter top props y + 0.02) — verify with code inspection only.
- [ ] **Step 2:** Implement `begin(customer)`, `update(dt)`, `onItemScanned()`, `abandon()` per the interfaces — item spawn cadence 0.75 s; arc param ~0.6 s; belt-vs-arc sync via pure state ticks (placed-at-belt items copy x from state; arc items tween separately then hand off to sliding).
- [ ] **Step 3:** `npm test` green; `npx tsc --noEmit` clean; dev server HTTP 200. **Do not commit.** Report with item count, coords, belt bounds (world), tote anchor, bag anchor, and the sag/feel values chosen.

---

### Task 4: POS readout strip (remove chips from the overlay)

**Files:**
- Modify: `index.html`, `src/ui/register.css`, `src/ui/RegisterController.ts`

**Interfaces:**
- Consumes: session API unchanged; LCD rendering code unchanged.
- Produces: `RegisterController.onItemScanned(cb)` (or a public field/emitter — choose the minimal wiring: a callback property `onItemScanned` called in `scanFrontmost()`/E path right after `scanNext`); chips removed; `#conveyor` gone from index.html skeleton; `#register-ui` becomes a compact strip anchored lower-center (`position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); width: min(640px, 96vw)`); everything else (LCD, pad, hint, thank-you, footer) intact; overlay still covers the till but NOT the belt.

- [ ] **Step 1:** index.html — remove the conveyor block; restructure `#register-ui` markup to the strip; keep id inventory minimal and consistent with `requireElement` calls.
- [ ] **Step 2:** register.css — rewrite `#register-ui` block for the strip (bottom-anchored, width-capped); delete `.conveyor*`/`.chip*`/`.scanner-arch`/`.conveyor-label` rules; keep everything else.
- [ ] **Step 3:** RegisterController.ts — remove chip build/render/scan/hover logic, remove `chip*` ids, keep `render()` (now LCD-focused) and `scanFrontmost` (E path) calling `onItemScanned()` after `scanNext` when it consumed an item (track scanned length before/after).
- [ ] **Step 4:** Manual check: ESC still abandons (no chips referenced); thank-you still fires; code inspection only — say so in report. `npm test` green; `npx tsc --noEmit`; `npm run build`; dev server HTTP 200. **Do not commit.** Report.

---

### Task 5: WebAudio cues

**Files:**
- Create: `src/audio/cues.ts`

**Interfaces:**
- Produces: `primeAudio()` (lazy, resume-on-gesture safe), `playPlip(): void` (short 500 → 700 Hz, 80 ms, gain low), `playBeep(): void` (short 900 Hz, 120 ms), all no-ops on missing AudioContext/failure.

- [ ] **Step 1:** Implement with `AudioContext`, oscillator/gain, try/catch everywhere.
- [ ] **Step 2:** `npm test` green; `npx tsc --noEmit` clean; dev server HTTP 200. **Do not commit.** Report.

---

### Task 6: Wire the checkout flow into the game loop

**Files:**
- Modify: `src/three/main.ts`

**Interfaces:**
- Consumes: `CheckoutFlow` (Task 3), `cues` (Task 5), session/till paths unchanged.
- Produces: on till open (customer waiting → serving): `checkoutFlow.begin(customer)` + `cues.primeAudio()` on that gesture; each `E` press while serving: `cues.playPlip()`? no — beep on scan: the RegisterController already knows; wiring in main.ts: pass the same `customers` basket; after `customers.beginService()` returns true, call `checkoutFlow.begin(customer)`; in the register close handler call `checkoutFlow.update`/`checkoutFlow.abandon()` depending on `completed` (abandon on Escape; keep bag as-is otherwise); in `animate` call `checkoutFlow.update(dt)` after `customers.update(dt)`.
- RegisterController callsites: `registerController.onItemScanned = () => { checkoutFlow.onItemScanned(); cues.playBeep(); }`.

- [ ] **Step 1:** Wire the three anchor points (begin on till-open; scanned hook; update in loop; abandon on non-completed close).
- [ ] **Step 2:** `npm test` green; `npx tsc --noEmit` clean; `npm run build` succeeds; dev server HTTP 200 briefly. **Do not commit.** Report.

---

### Task 7: README + final gate

**Files:**
- Modify: `README.md` (+ one line: "At the till: watch the belt, press E to scan"), ATTRIBUTION.md untouched (no new assets)
- Verify: everything

- [ ] **Step 1:** `npm run build`; `npm test`; `npx tsc --noEmit`.
- [ ] **Step 2:** Playtest checklist into report: customer with tote stands at till; items arc onto belt one at a time; slide east; front item waits; E scans → LCD flashes name + RM price + plip/beep; tips into bag; bag stays; Escape mid-sale clears belt; change pad still works; persistence intact.
- [ ] **Step 3:** **Do not commit.** Report; gate = human playtest.
---

## Definition of Done

- Suite green; build green; tsc clean; order integrity verified; abandon-clears-belt; belt animations continuous; bag persists; POS readout unobstructed; human playtest verdict recorded.
