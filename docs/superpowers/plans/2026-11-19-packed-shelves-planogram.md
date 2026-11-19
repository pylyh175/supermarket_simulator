# Packed Shelves (Planogram) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shelves read like the Supermarket Simulator reference — façings of identical products, grouped, hand-curated planogram, rail price tags — structured for future restocking.

**Architecture:** Stocking switches from cloned Groups to **one `InstancedMesh` per SKU** (identity via shared `userData.productId` on the instance, count = placements). A pure planogram module (`src/game/planogram.ts`) computes named facing placements from a hand-authored table; `storeLayout.ts` applies them. Hover logic is unchanged except the single-item highlight becomes `instanceColor` brighten. Rail tags are canvas-texture planes, one per facing region.

**Tech Stack:** TypeScript strict, Three.js 0.187, Vitest. No new dependencies.

**Spec:** grilling outcome in `docs/superpowers/specs/2026-11-18-supermarket-sim-design.md` + the grilling recap approved 2026-11-19.

## Global Constraints

- TypeScript strict; `npx tsc --noEmit` clean; `npm test` green (60 pre-existing tests must stay green).
- No runtime dependencies beyond Three.js. All money integer sen; display `formatRinggit`.
- Binding decisions (from grilling, 2026-11-19):
  - Facings of identical units per SKU — 2–5 units wide where depth ≤ 0.15 m packs ×2–3 deep; ≥ 0.2 m packs ×2 deep.
  - **Hand-authored planogram** per shelf-face; grouped regions (no 12-SKU slicing); 4–6 regions per board face; fill as much of the 4.6 m usable width as the chosen facings allow — tuned by implementer with named constants, documented in report.
  - **Rail tags**: one per facing region with name + price from the catalog (same source as the tooltip and the till).
  - **One InstancedMesh per SKU**, capacity = total facings of that SKU; matrices composed per placement; all instances visible; future depletion = scale-to-zero edit, no rebuild.
  - Single-item hover highlight = **`instanceColor` brighten** of the hovered instance; restore to base 1.0/1.0/1.0 on unhover. Shared materials untouched.
  - Draw calls target: ≤ ~400 from stocked shelves (from ~1.5k); verify r187 Lambert + instanceColor at implementation time (grep node_modules/three for the instancing-color chunk); if absent, switch shelf-stock materials to one that carries it (or report glow as broken — do not let it silently regress; overlay-mesh fallback only as last resort).
  - Restock gameplay is NOT in this plan (full stock, no empty states).
  - Existing hover semantics unchanged: reticle, ~2.2 m, first-hit wins, catalog-sourced name + price, pill below crosshair, shelves occlude.
  - `userData.productId` on the InstancedMesh carries the SKU id; `resolveTooltip` stays the tooltip source.
  - Draw-call consolidation measured and reported, not optimized further.
- **Commit rule:** subagents never commit; human commits the working tree.

## Review Focus

1. **Facings overlap or leave the face** — greedy fill must never place a facing beyond the 4.6 m edge or overlap its neighbors. Test in Task 1 (pure filler tests) and spot-check in Task 2.
2. **instanceColor unavailability loses the hover highlight** — verify at build time by grepping node_modules/three for the instancing-color chunk in the Lambert shader (or swapping materials); report findings. Test in Task 4.
3. **Hover breaks under instancing** — `productIdOf` walks ancestors to the InstancedMesh's userData; raycaster returns instanceId; the brighten writes the correct index. Test in Tasks 4–5.
4. **Rail tags mirrored or floating** — facing text would be unreadable from behind or misaligned. Test in Task 3 (two planes or single-sided, facing outward per side) — oneFocused check.
5. **Capacity lies** — InstancedMesh allocated with count > placements = uninitialized matrices (invisible void OR garbled garbage at scale 0). Test in Task 2 (matrices all composed before render; count exact).

---

### Task 1: Pure planogram module + tests (TDD)

**Files:**
- Create: `src/game/planogram.ts`, `tests/planogram.test.ts`

**Interfaces:**
- Consumes: `PRODUCTS` (catalog, for pack widths — pack sizes live in `SKU_SIZE_M: Record<string, [number, number, number]>` duplicating PRODUCT_SPECS widths is NOT allowed — import the widths from `src/three/assets.ts` if exported, else define the planogram table with explicit widths per SKU within this module and assert SKU ids ⊆ catalog ids in a test).
- Produces:

```ts
export interface Facing { skuId: string; lengthM: number; depth: 2 | 3; widthM: number } // widthM = unitsWide * packWidthM
export interface BoardFace { unitsWide: number }            // per facing — but placement computed by fill
export interface Placement { skuId: string; x: number; y: number; z: number; depth: 2 | 3; rotationY: number }
export const PLANOGRAM: Record<string, string[][]>;           // [rowIndex][boardIndex][sideIndex(0|1)] → ordered skus
export function computeFacings(faceSkus: string[], usableM: number): Facing[]      // greedy fill: walk SKU list; pack each into a facing of UNITS_PER_SKU units wide (constant), depth per SKU depth class; stop when usableM is filled or list exhausted
export function computePlacements(facings: Facing[], face: "front" | "back", cell: { rowX: number; boardY: number; centerZ: number }, side: 1 | -1): Placement[]
```

Keep the module pure (no three). The tables carry your hand-authored planogram (example shape — finalize per your judgment within the brief's spirit, document choices):

```ts
// unitsWide default per SKU (narrow packs more, wide packs fewer); depth 2 for ≥0.20 m packs else 3
export const UNITS_WIDE: Record<string, number> = {
  "milo-300g": 6, "maggi-curry": 4, "roti-canai-frozen": 4, "nasi-lemak-bungkus": 5,
  "tens-egg": 3, "kuih-bahulu": 5, "susu-fullcream": 7, "mee-hoon": 3,
  "telur-10pk": 3, "kopi-3in1": 5, "bicarbonate-250g": 6, "soap-bar": 6,
};
export const PACK_DEPTH_TWO_M = 0.20;
export const PLANOGRAM: string[][] = [
  ["milo-300g", "kopi-3in1", "maggi-curry", "nasi-lemak-bungkus", "bicarbonate-250g"],
  ["susu-fullcream", "kuih-bahulu", "maggi-curry", "milo-300g", "soap-bar"],
  ["telur-10pk", "roti-canai-frozen", "kopi-3in1", "bicarbonate-250g", "tens-egg"],
  ["mee-hoon", "telur-10pk", "nasi-lemak-bungkus", "soap-bar", "kopi-3in1"],
  ["susu-fullcream", "maggi-curry", "milo-300g", "kuih-bahulu", "nasi-lemak-bungkus"],
  ["kopi-3in1", "kuih-bahulu", "roti-canai-frozen", "bicarbonate-250g", "maggi-curry"],
  ["bicarbonate-250g", "nasi-lemak-bungkus", "tens-egg", "soap-bar", "telur-10pk"],
  ["milo-300g", "susu-fullcream", "kopi-3in1", "maggi-curry", "kuih-bahulu"],
  ["tens-egg", "maggi-curry", "bicarbonate-250g", "milo-300g", "kopi-3in1"],
  ["roti-canai-frozen", "kuih-bahulu", "telur-10pk", "nasi-lemak-bungkus", "soap-bar"],
];
```

Each board face draws its ordered face-SKU list from `PLANOGRAM[faceIndex]` (faces: tall rows 3 boards × 2 sides = 18 faces + low row 1 board × 2 sides = 2 → 20 faces; 10 lists cover 12 SKUs; wrap index modulo). The filler fills from z = face start toward the face end, computing each facing as `UNITS_WIDE × packWidthM` wide and `UNITS_WIDE deep` 2/3 by width class, placing packs adjacent (zero gap between units within a facing, ~0.1 m gap between facings), stopping when the face width is filled or the SKU list is exhausted; regions with fewer than the minimum packs are dropped.

**Tests (all required):**
- every SKU id in `PLANOGRAM` and `UNITS_WIDE` exists in `PRODUCTS` (cross-module check)
- `computeFacings` returns facings whose widths sum ≤ usableM, ≥ 96% filled for every face list (or asserts the reason)
- no overlapping facings: placed facings are strictly increasing in extent, pairwise disjoint
- `computePlacements` emits one placement per unit per facing (`UNITS_WIDE × depth` units), all inside the face span
- renders correct facing counts (deterministic; literal expected counts per face)

- [ ] **Step 1:** Write the failing tests.
- [ ] **Step 2:** `npm test` — FAIL (module missing).
- [ ] **Step 3:** Implement `src/game/planogram.ts`.
- [ ] **Step 4:** `npm test` green; `npx tsc --noEmit` clean.
- [ ] **Step 5:** **Do not commit.** Report.

---

### Task 2: Rework stocking to InstancedMesh + planogram

**Files:**
- Modify: `src/three/storeLayout.ts`

**Interfaces:**
- Consumes: `computeFacings`, `computePlacements`, `PLANOGRAM`, `UNITS_WIDE` (Task 1); `PRODUCT_SPECS` (may export widths for planogram — but planogram module does NOT import assets; storeLayout maps `PRODUCTS` via `buildAssetBundle` archetype sizes or via importing `PRODUCT_SPECS` — read assets.ts and choose one; keep the constraint "no circular imports").
- Produces: `buildStore` returns the same `Aabb[]` collider list as before (signature unchanged — unrelated code untouched). `buildStore` now builds `InstancedMesh`es instead of clones for stock; each carries `userData.productId`.

- [ ] **Step 1:** In `stockShelfRow`: faces are enumerated in fixed order per row (row 0 board 0 side +1, row 0 board 0 side −1, row 0 board 1 side +1, …, row 3); each face gets its ordered SKU list from `PLANOGRAM[faceIndex % PLANOGRAM.length]` (24 faces cycle through 10 lists — all 12 SKUs appear); for each board the ray detects and each side, `computeFacings(list, usableM)`, `computePlacements(...)`, transform to world coords (current rotation sign flip kept).

- [ ] **Step 2:** Collect all placements per SKU; build one `THREE.InstancedMesh(geometry, material, count)` per SKU; compose matrices (`Matrix4().compose(pos, quaternion for rotationY ±π/2, unit scale)`); set `userData.productId`; add to scene; **count exact — assert placements.length === mesh.count**.

- [ ] **Step 3:** Shared geometry/materials: use the archetype product's own geometry/materials (bundle.products is Map<id, Group> — the single child Mesh carries the BoxGeometry/CylinderGeometry and the material array — `geometry` and `material` shared into the InstancedMesh); dispose nothing.

- [ ] **Step 4:** Remove the per-clone `tagProduct` calls in the stocking loop (InstancedMesh tagging replaces them); `hover.ts` still exports `tagProduct` (used elsewhere? grep usage — if unused, leave it; it's the tested API the tooltip feature may still use for other stock types later).

- [ ] **Step 5:** Report: number of instanced meshes created, total instance count per row, draw-call estimate from product meshes (~`12` for SKU meshes + tags, vs previous ~1.5k), the replaced code paths. `npm test` green; `npx tsc --noEmit` clean; `npm run build` succeeds; dev server HTTP 200 briefly.

- [ ] **Step 6:** **Do not commit.** Report.

---

### Task 3: Rail tags (one per facing region)

**Files:**
- Create: `src/game/railTags.ts`
- Modify: `src/three/storeLayout.ts`

**Interfaces:**
- Consumes: `computeFacings`, `computePlacements` (Task 1); catalog via `PRODUCTS`; `formatRinggit` (register/money); `makeCanvas`/`toTexture` helpers (assets.ts, may import or copy minimal helpers — NO re-export needed).
- Produces: `buildRailTags(scene, facings, face, cell, side): void` — places one canvas-texture plane per facing region on the board's front edge (rails persist through rows).

- [ ] **Step 1:** Implement `buildRailTags`: one plane (~0.28 × 0.095 m) per facing region flush with the board's front lip, facing outward (single-sided, normal outward — text never mirrored from behind), text: `NAME` small-caps top line + `RM…` bottom line (formatRinggit), cream background with thin border (match the KEDAI rail-label style; keep minimal).

- [ ] **Step 2:** In `storeLayout.ts`, call `buildRailTags` per stocked board-face after placements; plane y at board surface + 0.05 (half height 0.048 + 0.002); x via face span from facing data; z flush with the board lip − 0.01; both side faces stocked → both get tags.

- [ ] **Step 3:** `npm test` green; `npx tsc --noEmit` clean; `npm run build` succeeds; dev server HTTP 200. **Do not commit.** Report.

---

### Task 4: Hover under instancing — instanceColor highlight

**Files:**
- Modify: `src/three/main.ts`

**Interfaces:**
- Consumes: `hoverCandidates` collection logic (now filters `InstancedMesh` — or simply meshes with `isInstancedMesh === true` plus previous list, per your judgment — keep the current ancestor-walk, InstancedMesh.userData.productId works identically), the existing `liftHovered`/`unliftHovered` structure to replace.
- Produces: hover highlights exactly the hovered instance via `instanceColor`; base color restored on unhover; tooltip unchanged (`resolveTooltip` via tagged mesh's `userData.productId`).

- [ ] **Step 1:** Verify Lambert + instanceColor in the r187 tree (grep node_modules/three for `USE_INSTANCING_COLOR` / `instanceColor` in the lambert shader chunk); proceed with `instanceColor` if present; otherwise switch stocked-pack materials to `MeshLambertMaterial` where it exists or `MeshStandardMaterial` with instanceColor support, and document.
- [ ] **Step 2:** In the hover path, detect `hit.object.isInstancedMesh` + `hit.instanceId != null`; lazily init `instanceColor` to white for all indices if unset (or do it in Task 2 — either fine); set hovered index to `new THREE.Color(1.35, 1.25, 1.12)`; `instanceColor.needsUpdate = true`.

- [ ] **Step 3:** On unhover restore that index to `(1,1,1)`. Keep the old swap path as fallback when the hit is NOT an InstancedMesh (defensive; there are no per-clone product meshes left — implement anyway, short).

- [ ] **Step 4:** Verify: `npm test` green; `npx tsc --noEmit` clean; `npm run build` succeeds; report exact file touched. **Do not commit.** Report with the manual checklist note (no browser here).

---

### Task 5: README/docs + final gate prep

**Files:**
- Modify: `README.md` (one line: restock arrives later? no — current README mentions hover; keep it accurate), and the spec design doc if a line is stale (optional, skip unless wrong)
- Verify: everything

- [ ] **Step 1:** `npm run build`; `npm test` (60); `npx tsc --noEmit`; draw-call target check: ~380 from shelves + tags; report.
- [ ] **Step 2:** Playtest checklist for the human: shelves look packed (aim at slibe facings; rail tags readable; hover shows name+price; single-item glow subtle; no stutter).
- [ ] **Step 3:** **Do not commit.** Report; gate = human playtest.
---

## Definition of Done

- Suite green; build green; tsc clean; draw calls from shelved stock ≤ ~400; every facing tagged; hover brighten verified in a browser; human playtest verdict recorded.
