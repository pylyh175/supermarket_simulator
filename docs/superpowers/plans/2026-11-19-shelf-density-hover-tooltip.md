# Shelf Density + Hover Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shelves read fully stocked like a real supermarket, and looking at an item shows its name and price — nothing else permanently visible.

**Architecture:** Extend the existing Three.js scene (`storeLayout.ts`, `assets.ts`) for density + identity tagging; add a pure hover-logic module (`src/game/hover.ts`, unit-tested) that maps a tagged clone to its tooltip text; wire a screen-center crosshair + DOM tooltip into `index.html`/`main.ts`.

**Tech Stack:** TypeScript strict, Three.js 0.187, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-supermarket-sim-design.md` (settled via grilling on 2026-11-19 — decisions listed under Global Constraints)

## Global Constraints

- TypeScript strict; `npx tsc --noEmit` clean; `npm test` green (53 pre-existing tests must keep passing).
- Integer sen everywhere; display via `formatRinggit` (`src/register/money.ts`).
- No runtime dependencies beyond Three.js (Phaser gone).
- Grilling decisions (binding):
  - Fill every viable slot; spacing `SLOT_SPACING_M = 0.35` (was 0.62); drop the ~1/11 empty-slot skip; top board stays bare per existing cap rule; products keep archetype size; both faces stocked.
  - Permanent name labels stripped from shelf pack textures; faux barcode + pack colors stay.
  - Screen-center **crosshair** (subtle permanent dot, DOM, always visible while pointer-locked); center ray range **~2.2 m**; first-hit wins (shelves occlude).
  - Tooltip: DOM pill **~14 px below crosshair**, cream style matching `#money-hud`; content **name + price only** (`formatRinggit(priceSen)`).
  - The **single** hovered item gets a subtle emissive lift; restored on unhover.
  - Crosshair + tooltip **hidden while the register overlay is open**; ray occludes (first-hit) — no X-ray.
  - Clones tagged **`clone.userData.productId = <catalog id>`** at placement; name/price looked up from `PRODUCTS` at hover time — never from `.name`.
  - Draw-call increase accepted; **no optimization pass** in this plan.
  - Info-only hover: no clicking, no taking. Scope: shelf-stock items only.
  - Done = unit tests + human browser playtest (feel gate).
- **Commit rule:** subagents never commit; the human reviews and commits the working tree.

## Review Focus

The failure modes most likely to bite a player, each pinned to its owning task:

1. **Shared materials light up globally** — clones share archetype materials; naive `material.emissive = …` on hover turns every Milo tin in the store glowing. Expect: hover path swaps in a cloned material for exactly the one hovered mesh and restores on exit. Test in Task 3.
2. **Tooltip outside range / through walls** — shows through shelves or across the room. Expect: ray range capped at 2.2 m, first-hit-only. Test in Tasks 2–3.
3. **Crosshair remains visible/interactive over the register overlay** — overlay covers the screen but the dot still floats above/below it. Expect: crosshair + tooltip hidden whenever `#register-ui` is open. Test in Task 3.
4. **Price drift** — tooltip prices disagree with the till. Expect: tooltip text built from `PRODUCTS` via unit test; never from textures or `.name`. Test in Task 1.
5. **Shelf stock explosion breaks perf catastrophically** — ~290 groups with 6-material boxes ≈ heavy draw calls. Target: record approximate group count in the report; no other perf work. Test in Task 2.

---

### Task 1: Pure hover-logic module + tests (TDD)

**Files:**
- Create: `src/game/hover.ts`, `tests/hover.test.ts`

**Interfaces:**
- Consumes: `PRODUCTS` (`src/data/products.ts`), `formatRinggit` (`src/register/money.ts`).
- Produces: `TOOLTIP_MAX_DISTANCE_M: number` (= 2.2); `resolveTooltip(productId: string | null | undefined): { title: string; price: string } | null` — null for unknown/missing ids or null/undefined input; `tagProduct(clone: { userData: Record<string, unknown> }, productId: string): void` — sets `userData.productId`.

```ts
// src/game/hover.ts
import { PRODUCTS } from "../data/products";
import { formatRinggit } from "../register/money";
export const TOOLTIP_MAX_DISTANCE_M = 2.2;
export function resolveTooltip(productId) {
  const p = productId == null ? undefined : PRODUCTS.find((x) => x.id === productId);
  return p ? { title: p.name, price: formatRinggit(p.priceSen) } : null;
}
export function tagProduct(clone, productId) {
  clone.userData.productId = productId;
}
```

The bodies above are the complete intended implementation; the implementer writes tests first, then the module.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hover.test.ts
import { describe, it, expect } from "vitest";
import { resolveTooltip, tagProduct, TOOLTIP_MAX_DISTANCE_M } from "../src/game/hover";
// ...
```

Required assertions:
- `resolveTooltip("milo-300g")` → `{ title: "Milo 300g", price: "RM14.90" }` (spec prices: milo 1490 sen; others per catalog)
- `resolveTooltip("soap-bar")` → `{ title: "Soap Bar", price: "RM1.65" }`
- `resolveTooltip("nonsense-id")` → `null`; `resolveTooltip(undefined)` → `null`; `resolveTooltip(null)` → `null`
- `TOOLTIP_MAX_DISTANCE_M` → `2.2`
- `tagProduct(obj, "maggi-curry")` sets `obj.userData.productId === "maggi-curry"` and doesn't touch other keys

- [ ] **Step 2:** Run `npm test` — new tests FAIL (module missing).

- [ ] **Step 3:** Implement `src/game/hover.ts` per the interface; all tests pass; pre-existing 53 stay green.

- [ ] **Step 4:** `npx tsc --noEmit` clean.

- [ ] **Step 5:** **Do not commit.** Report.

---

### Task 2: Dense stocked shelves + identity tagging + label strip

**Files:**
- Modify: `src/three/storeLayout.ts`, `src/three/assets.ts`
- Test: none beyond existing suite (placement is visual/positions; logic helpers already tested in Task 1). Verify against `tests/` unchanged + count cloned groups.

**Interfaces:**
- Consumes: `tagProduct` (Task 1) — the only behavioral change to placement.
- Produces: denser shelves; clones carry `userData.productId`; `makeProductLabel` draws **no text** (barcode + accent stripe + pack colors only).

- [ ] **Step 1:** In `assets.ts` `makeProductLabel`: remove brand/variant/detail text rendering and the wide/narrow width branch chosen for text (keep canvas sized for the barcode; default 256×256). Keep: accent pinstripe, faux barcode, `SRGBColorSpace`, anisotropy 4. Product groups keep `name` AND now also `userData.productId` (set at build for the archetype itself).

- [ ] **Step 2:** In `storeLayout.ts`: `SLOT_SPACING_M = 0.35`; delete the `STOCK_SKIP_MOD` / 1-in-11 skip (every viable slot places); use `tagProduct` on each placed clone; keep board-raycast filtering (`ROW_TOP_EXCLUDE_M`) unchanged. Report the resulting clone count (target ballpark: tall rows 13 × 2 × 3 × 3 ≈ 234, low 13 × 2 × 2 = 52, ≈ 286 total, minus no skips).

- [ ] **Step 3:** Sanity check the stocking loop for zero/negative slot spans at the new spacing (`slotSpan = (13-1) × 0.35 = 4.2 m` still fits inside usable 4.6 m — margin intact).

- [ ] **Step 4:** Verify: `npm test` green; `npx tsc --noEmit` clean; `npm run build` succeeds. Start dev server briefly → HTTP 200 → stop.

- [ ] **Step 5:** **Do not commit.** Report (incl. clone count and any surprises).

---

### Task 3: Crosshair + raycast + tooltip + emissive lift

**Files:**
- Modify: `index.html`, `src/style.css`, `src/three/main.ts`
- Test: none beyond suite (thin glue; logic in Task 1 is tested)

**Interfaces:**
- Consumes: `resolveTooltip`, `tagProduct` find-by `userData.productId` at render time (Task 1); `#register-ui` visibility (existing id); camera from main.ts; `bundle.products` not needed (look up `PRODUCTS` via hover module).

- [ ] **Step 1:** `index.html`: add `<div id="crosshair"></div>` (a ~6 px dot, cream fill + thin dark ring) and `<div id="item-tooltip" hidden><div class="tip-title"></div><div class="tip-price"></div></div>` after `#money-hud`/`#lock-hint`. No other DOM changes.

- [ ] **Step 2:** `src/style.css`: `#crosshair` fixed center (left/top 50%, translate −50%), subtle, `pointer-events:none`, `z-index:10`; hidden when `#register-ui` visible (main toggles `#crosshair[hidden]`; CSS `[hidden] { display:none !important; }` already page-wide). `#item-tooltip` fixed, `left:50%`, `top:calc(50% + 14px)` translateX(−50%), cream pill (match `#money-hud`), `pointer-events:none`; `text-align:center`; two lines (title small-caps, price bold).

- [ ] **Step 3:** `src/three/main.ts` wiring:
  - Collect `hoverCandidates: THREE.Mesh[]` in `animate()`'s first frame (or in `buildStore().then()`): `scene.traverse` once, collecting every `Mesh` whose ancestor group carries `userData.productId` (Task 2 sets it on the placed clones). Cache the list — one traverse per page boot, not per frame.
  - Per frame (in `animate`): raycaster from `camera`; first hit within 2.2 m with an ancestor carrying `productId` → show tooltip with `resolveTooltip(id)`; else hide. Only while `!playerFrozen && #register-ui` hidden; otherwise hide crosshair + tooltip.
  - Hover highlight: **material swap**, never mutate shared materials — on hover, for the single hovered **mesh**, clone its primary material once, set `emissive` to a warm lift (e.g. `#3a2a00`); restore the original material reference on unhover/no-hit. Keep every original material reference to restore exactly (single-slot cache; store `{ mesh, material }`).
  - Escape/registration flows unchanged; overlay open ⇒ crosshair hidden.

- [ ] **Step 4:** Manual checklist: look at a Milo tin within 2.2 m → tooltip "Milo 300g / RM14.90" appears and the tin glows faintly; look away → both revert; walk back beyond 2.2 m → hidden; through-shelf → hidden; till opens → crosshair gone; Esc closes → returns after close gesture.

- [ ] **Step 5:** `npm test` green; `npx tsc --noEmit` clean; `npm run build` succeeds; dev server HTTP 200. **Do not commit.** Report.

---

### Task 4: README + final gate

**Files:**
- Modify: `README.md` (controls: mention looking at items shows name + price; crosshair), `ATTRIBUTION.md` untouched (no new assets)
- Verify: everything

- [ ] **Step 1:** `README.md` — add one line to Controls: `Aim at a shelf item: name + price appear` (≤20 lines total).

- [ ] **Step 2:** `npm run build`; `npm test` (53); `npx tsc --noEmit`; greet the human with the playtest checklist: shelves read fully stocked; hover shows name+price at close range; glow subtle; crosshair behaves with overlay open; density looks good, no stutter.

- [ ] **Step 3:** **Do not commit.** Report; gate = human playtest verdict.
---

## Definition of Done

- Suite green; build green; tsc clean; tooltip shows **exactly** name + price from catalog; density visibly ~2×; human playtest passes; no 2D artifacts reintroduced; working tree left for the human's commit.
