# Store Re-layout — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the store as a 28 × 20 × 4.2 m Malaysian neighbourhood pasaraya: bright cool lighting, a front-wall glass shopfront, 7 double-sided gondolas plus wall shelving packed tight, 3 checkout counters, and customer routes rebuilt to match.

**Architecture:** A new pure module, `src/game/storeGeometry.ts`, holds every layout number: shell, gondolas, bays, shelf heights, checkouts, door, props and spawn. The shell, the layout builder, the planogram, the customer routes, `FpsController` and `TillStation` all read from it, so the coordinates can't drift apart. Gondolas become procedural merged meshes that replace the Kenney bookcases. Stock is still one `InstancedMesh` per SKU, but now split per run, so raycasts and frustum culling skip whole runs.

**Tech Stack:** TypeScript, three.js, Vite, Vitest.

**Spec:** The design agreed in the grilling session on 2026-11-27, summarised below. Stage 2 (chillers, freezer, pallets, promo row ends, aisle signs, terrazzo floor, baskets and trolleys, wall signs) and Stage 3 (about 40 new products) are out of scope.

### Agreed design (stage 1 slice)
- Interior 28 m (x −14..14) × 20 m (z −10..10), ceiling 4.2 m. Front wall = +Z (z = +10), back wall = −Z.
- White tiled ceiling grid with cool-white (~5000 K) strip-light fixtures in rows. Haze (fog) starts at 25 m.
- Front wall: glass shopfront with a frosted film band carrying posters and stickers, a painted street backdrop outside (covered shop walkway, parked motorbikes, road), and a door at the front-left with a rolled-up roller shutter.
- 7 double-sided gondolas (lip to lip ≈ 0.9 m, aisles ≈ 1.9 m clear), split by a middle cross-aisle into a back run and a front run. Single-sided wall shelving runs along both side walls on the same runs.
- Gondola unit: 2.1 m tall, steel uprights, perforated back, kick plate, 5 shelves, price strip on each shelf lip.
- Tight packing: 1 cm between facings, stocked front to back (up to 6 deep), no empty levels.
- Departments, front to back: snacks / biscuits / drinks → noodles / canned / condiments / dry staples → household / personal care. Chilled items stay on gondolas until stage 2 moves them.
- 3 checkout counters in a row. The player's counter is the one nearest the entrance, and each day starts behind it. The other two have "KAUNTER DITUTUP" signs. There is an open area of about 3–4 m between the shelf ends and the counters for the queue.
- Customers enter at the front-left door and leave through the lane beside the player's counter. Up to 8 in store; 6 queue slots.
- The Grab counter and the bench move beside the entrance. The storeroom door becomes a staff door on the back wall.
- Target 60 fps on an integrated laptop GPU.

## Global Constraints
- No new dependencies. Use `three/examples/jsm/utils/BufferGeometryUtils.js` (already ships with three) for merging.
- `src/game/storeGeometry.ts`, `src/game/planogram.ts` and `src/game/storeRoute.ts` stay pure: no three.js and no DOM imports.
- Coordinate conventions are unchanged: forward = −Z, right = +X, yaw 0 faces −Z, and the cashier stands on the +Z side of the counter facing −Z.
- Shadows stay off. Strip lights are emissive meshes, not real light sources.
- Malay copy is exact: `KAUNTER DITUTUP`, `PASARAYA MESRA` (existing sign).
- Baseline: 13 tests fail before this work (in `generate`, `hover`, `money`, `planogram` and `save`). The `planogram` failures are replaced by Task 4. The others are pre-existing and out of scope: their counts must not grow.
- Commit after each task (Conventional Commits, with the `Co-Authored-By` trailer).

## Review Focus
1. **Customers clip through solids.** A route edge passes through a gondola, a counter, the Grab counter or the bench. Expect every edge to keep ≥ 0.3 m clear of every footprint. Test in Task 7.
2. **Player trapped or till unreachable.** The spawn point lies inside a collider, or the till zone overlaps one. Expect the spawn to be clear by the player radius and the till zone to overlap no solid. Test in Task 1.
3. **Tall packs clip the shelf above.** A SKU taller than the shelf clearance gets placed on a shelf. Expect every placement's height to be ≤ the clearance of its shelf. Test in Task 4.
4. **Wall shelving stocked on the wall side.** Packs are placed facing into the wall. Expect wall runs to produce faces on the interior side only. Test in Task 4.
5. **Queue slot inside a solid, or on the cross-aisle line.** Expect every queue slot to be ≥ 0.4 m from every footprint and ≥ 0.6 m from the front cross-aisle z. Test in Task 7.

---

### Task 1: Pure store geometry

**Files:**
- Create: `src/game/storeGeometry.ts`
- Test: `tests/storeGeometry.test.ts`

**Interfaces:**
- Produces (all exported `const` unless noted; metres):
  - `STORE_WIDTH_M = 28`, `STORE_DEPTH_M = 20`, `WALL_THICKNESS_M = 0.4`, `CEILING_HEIGHT_M = 4.2`
  - `FRONT_Z = 10`, `BACK_Z = -10`
  - `DOOR = { x: -11.2, widthM: 2.4, heightM: 2.5 }` (gap in the front wall)
  - `GONDOLA_XS = [-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4]`
  - `WALL_RUN_BACK_XS = [-13.98, 13.98]` (the back-panel plane of each wall run; west faces +X, east faces −X)
  - `FACE_HALF_M = 0.44` (centre plane to shelf lip), `STOCK_DEPTH_M = 0.43` (depth budget for pack rows)
  - `BAY_W_M = 1.25`, `BAYS_PER_RUN = 3`, `UPRIGHT_W_M = 0.04`, `BAY_STOCK_MARGIN_M = 0.01`
  - `FACE_USABLE_M = BAY_W_M - UPRIGHT_W_M - 2 * BAY_STOCK_MARGIN_M` (= 1.19)
  - `RUNS: readonly { id: "back" | "front"; minZ: number; maxZ: number }[]` = `[{ id: "back", minZ: -6.9, maxZ: -3.15 }, { id: "front", minZ: -1.35, maxZ: 2.4 }]`
  - `CROSS_AISLE_Z = { front: 3.6, middle: -2.25, back: -8.05 }`
  - `SHELF_YS = [0.15, 0.53, 0.91, 1.29, 1.67]` (board top surfaces), `BOARD_T_M = 0.025`, `UNIT_HEIGHT_M = 2.1`, `KICK_H_M = 0.15`
  - `shelfClearanceM(shelfIndex: number): number`: the next `SHELF_YS` entry minus `BOARD_T_M` minus this one; for the top shelf, `UNIT_HEIGHT_M` minus this one.
  - `bayCenterZs(run: RunId): number[]`: 3 values, `minZ + BAY_W_M * (k + 0.5)`.
  - `TILL_X = -7.0`, `TILL_Z = 7.0`, `CHECKOUT_PITCH_M = 3.2`, `CHECKOUT_XS = [TILL_X, TILL_X + 3.2, TILL_X + 6.4]`
  - `COUNTER_W_M = 0.973`, `COUNTER_D_M = 0.475` (the kitchenBar GLB scaled to 0.95 m tall; `storeLayout` warns if the measured size differs by > 0.05 m), `STAND_OFFSET_X_M = COUNTER_W_M / 2 + 0.06 + 0.31` (POS stand centre, east of `TILL_X`)
  - `SPAWN = { x: TILL_X, z: TILL_Z + 1.2 }` (yaw 0)
  - `GRAB = { x: -13.72, z: 5.0, rotY: Math.PI / 2 }`, `BENCH = { x: -13.7, z: 7.6, rotY: Math.PI / 2 }`, `STAFF_DOOR_X = 11.0`
  - `type Footprint = Aabb` (import the type from `../player/colliders`), `solidFootprints(): Footprint[]`: every gondola run (x ± 0.46), every wall run (from the back plane to the lip + 0.02), every counter (`COUNTER_W_M × COUNTER_D_M`), the POS stand (`0.62 × 0.52` at `TILL_X + STAND_OFFSET_X_M`, `TILL_Z + 0.12`), the Grab counter (0.55 along x × 1.35 along z), and the bench (0.6 × 1.9).
  - `TILL_ZONE = { minX: TILL_X - 0.95, maxX: TILL_X + 0.95, minZ: TILL_Z + 0.5, maxZ: TILL_Z + 1.9 }`

- [ ] **Step 1: Write the failing tests** in `tests/storeGeometry.test.ts`:
  - `"aisles between gondolas are at least 1.8 m clear"`: for consecutive `GONDOLA_XS`, `b - a - 2 * FACE_HALF_M >= 1.8`.
  - `"every shelf fits the tallest pack (0.30 m)"`: `shelfClearanceM(i) >= 0.3` for i = 0..4.
  - `"runs leave a cross-aisle of at least 1.8 m and an open front area of 3–4.5 m"`: `RUNS[1].minZ - RUNS[0].maxZ >= 1.8`; `(TILL_Z - COUNTER_D_M / 2) - RUNS[1].maxZ` is between 3 and 4.5.
  - `"spawn and the till zone are clear of every solid"`: the spawn point lies outside every `solidFootprints()` box inflated by 0.35 m (player radius), and the `TILL_ZONE` rectangle overlaps no footprint, uninflated. The zone abuts the counter by design.
  - `"the door is in the front wall, west of the player's counter"`: `DOOR.x - DOOR.widthM / 2 > -STORE_WIDTH_M / 2`, and `DOOR.x < TILL_X - COUNTER_W_M / 2 - 1.2`.
  - `"module is pure"`: the file source contains no `from "three"` and no `document`.
- [ ] **Step 2:** Run `npx vitest run tests/storeGeometry.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/game/storeGeometry.ts` with the values above.
- [ ] **Step 4:** Run `npx vitest run tests/storeGeometry.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(store): add pure store geometry for the 28 x 20 m layout`.

### Task 2: Shell, shopfront, ceiling, lighting, spawn

**Files:**
- Modify: `src/three/storeShell.ts` (whole file), `src/three/main.ts:70-80` (background + lights), `src/player/FpsController.ts:26-32` (bounds + spawn)

**Interfaces:**
- Consumes: Task 1 constants.
- Produces: `storeShell.ts` keeps exporting `STORE_WIDTH_M`, `STORE_DEPTH_M`, `WALL_THICKNESS_M`, re-exported from `storeGeometry`, and `WALL_HEIGHT_M = CEILING_HEIGHT_M`, so existing imports keep compiling. `buildStoreShell(scene)` keeps its signature and return type (`Aabb[]` from `makeWallBoxes`, unchanged: the doorway is not walkable).

- [ ] **Step 1: Walls.** Back and side walls are solid boxes, off-white `#ebe8e1`. The front wall is built from these pieces:
  - A 0.4 m kick wall.
  - Glass from 0.4 to 2.7 m: `MeshBasicMaterial` `#cfe6ee`, opacity 0.18, `depthWrite: false`.
  - A frosted band from 0.4 to 1.3 m: a canvas texture at white 70 % alpha, with 3 promo posters ("JIMAT!", "HARGA ISTIMEWA", "BUKA 9PG–10MLM") in red and yellow.
  - A header wall from 2.7 to 4.2 m.
  - The door gap at `DOOR`.
  - Above the door: a shutter housing (box 2.6 × 0.3 × 0.3, at y = `DOOR.heightM + 0.15`) and a rolled shutter cylinder (r 0.12, grey `#9aa0a6`).
  - Remove the old north-wall doorway and its dark void plane.
- [ ] **Step 2: Outside.**
  - A walkway floor plane from z 10 to 14, full store width, in tile grey.
  - A covered-walkway roof plane at 3.2 m.
  - A backdrop plane at z = 14.5, 40 × 8 m: canvas-painted sky, a shophouse row opposite, a road strip, and 4 parked motorbike silhouettes. `MeshBasicMaterial`, `fog: false`.
- [ ] **Step 3: Ceiling.**
  - A ceiling plane at 4.2 m, with a canvas texture of 0.6 m white tiles and grey grid lines, repeated with `RepeatWrapping`.
  - Strip fixtures: `MeshBasicMaterial #ffffff` boxes 1.2 × 0.04 × 0.15, laid along z every 2.0 m over each aisle centre (midpoints of consecutive `GONDOLA_XS`, plus the two outer aisles) and over the front area.
  - Merge all fixtures into one mesh.
  - Floor stays a single plane resized to 28 × 20 in `#d6d3cc` (stage 2 adds terrazzo).
  - Fog `#eef2f5`, near 25, far 60.
- [ ] **Step 4: Lighting** in `main.ts`:
  - Background `#eef2f5`.
  - `HemisphereLight(0xf4f8ff, 0x8f969c, 1.15)`.
  - One `DirectionalLight(0xffffff, 0.9)` at (4, 12, 6).
  - Remove the warm fill light, and replace the "cozy warm" comment.
- [ ] **Step 5: Player.** In `FpsController`, set `DEFAULT_BOUNDS` from `STORE_WIDTH_M / STORE_DEPTH_M` and spawn at `SPAWN.x`, `SPAWN.z`.
- [ ] **Step 6: Verify.** Run `npx tsc --noEmit` and expect no errors. Then run `npm run dev` and check the shell by hand: the shopfront glass shows the street through it, the ceiling grid and strip lights are visible, and the far wall is not washed out.
- [ ] **Step 7:** Commit: `feat(store): 28 x 20 m shell with glass shopfront and strip lighting`.

### Task 3: Procedural gondola units

**Files:**
- Create: `src/three/gondola.ts`
- Modify: `src/three/assets.ts` (drop `shelfTall`/`shelfLow` from `GLTF_MANIFEST`, the `shelves` field from `AssetBundle`, and `buildShelfProcedural`), `src/three/storeLayout.ts` (replace `buildShelfRow` and the archetype clone/raycast board detection)

**Interfaces:**
- Consumes: Task 1 (`BAY_W_M`, `BAYS_PER_RUN`, `UPRIGHT_W_M`, `SHELF_YS`, `BOARD_T_M`, `UNIT_HEIGHT_M`, `KICK_H_M`, `FACE_HALF_M`).
- Produces: `buildRunMeshes(kind: "double" | "wall"): THREE.Group`. The group is centred at the origin with its length along z (`BAYS_PER_RUN × BAY_W_M`) and its faces along ±x. For `"wall"`, the back panel sits at x = 0 and the shelves extend to +x. It is built once per kind; `storeLayout` clones it per run (shared geometry) and places it with `position` (plus `rotation.y = π` for the east wall run).

- [ ] **Step 1: Geometry.** Build these parts, then merge them with `mergeGeometries` into one mesh per material:
  - Uprights at every bay boundary: steel `#8d949b`, `UPRIGHT_W_M × UNIT_HEIGHT_M × 0.04`, at the centre plane.
  - A back panel at the centre plane, 0.02 thick: canvas perforated texture (light grey with a 25 mm dot grid).
  - A kick plate per side: `KICK_H_M` tall, at the lip, `#5f666d`.
  - Each shelf: `#f2f2f0`, `FACE_HALF_M` deep, `BOARD_T_M` thick, top at `SHELF_YS[i]`.
  - A price strip on each shelf lip: 0.04 tall, `#2b2f33`.
  - A top header strip.

  There are 4 materials, all `MeshLambertMaterial`, shared module-wide.
- [ ] **Step 2: Layout.** In `storeLayout.ts`, place a `"double"` clone at each (`GONDOLA_XS[i]`, run centre z) and a `"wall"` clone at each (`WALL_RUN_BACK_XS[j]`, run centre z). Push one collider per run from `solidFootprints()` (no measured bounding boxes). Delete `ROW_X_POSITIONS`, `ROW_LENGTH_M`, `LOW_ROW_INDEX`, the raycast board detection and the drift warning.
- [ ] **Step 3: Verify.** Run `npx tsc --noEmit` and expect no errors. Run `npm run dev`: 14 gondola runs and 4 wall runs stand at the planned spots, the uprights line up between bays, and walking through any of them is blocked.
- [ ] **Step 4:** Commit: `feat(store): procedural 2.1 m gondola units replace bookcases`.

### Task 4: Planogram for bays — tight packing, departments

**Files:**
- Modify: `src/game/planogram.ts`, `src/three/storeLayout.ts` (`stockShelfRow` → `stockRuns`, `addInstancedProducts`)
- Test: `tests/planogram.test.ts` (replace the `face enumeration` block and the stale literal tables, keep the generic property tests)

**Interfaces:**
- Consumes: Task 1 (`FACE_HALF_M`, `STOCK_DEPTH_M`, `FACE_USABLE_M`, `SHELF_YS`, `shelfClearanceM`, `RUNS`, `bayCenterZs`, `GONDOLA_XS`, `WALL_RUN_BACK_XS`).
- Produces:
  - Remove the local `FACE_HALF_M` and `FACE_USABLE_M` and import them from `storeGeometry`. `FACING_GAP_M = 0.01`. `MAX_DEPTH = 6`. `Facing.depth` and `Placement.depth` become `number` (1..`MAX_DEPTH`). Depth = the largest `d ≤ MAX_DEPTH` with `d × packDepth + (d − 1) × GAP_M ≤ STOCK_DEPTH_M`.
  - `type Department = "drinks" | "snacks" | "noodles" | "canned" | "condiments" | "staples" | "dairy" | "household" | "personal"`.
  - `RUN_DEPARTMENTS: Record<string, Department>`, keyed `` `${unit}:${run}` `` with unit `g0`..`g6` (gondolas west → east) and `wW` / `wE` (the walls):
    - front runs: g0 drinks, g1 drinks, g2 snacks, g3 snacks, g4 noodles, g5 canned, g6 condiments, wW drinks, wE snacks
    - back runs: g0 staples, g1 staples, g2 condiments, g3 dairy, g4 household, g5 household, g6 personal, wW staples, wE household
  - `DEPARTMENT_GROUPS: Record<Department, string[][]>`, built from the existing `FACE_PLAN` groups and regrouped by department. Every one of the 39 catalog SKUs is in ≥ 1 group. Chilled SKUs (`susu-fullcream`, `butter-250g`, `telur-10pk`, `telur-30-tray`, `roti-canai-frozen`) go in `dairy`.
  - `interface FaceSlot { unit: string; run: RunId; bay: number; shelf: number; side: 1 | -1; rowX: number; centerZ: number; boardY: number }`.
  - `FACE_SLOTS: readonly FaceSlot[]`, in order unit → run → bay → shelf → side. Gondolas have both sides. The west wall has side +1 only and the east wall side −1 only. The `rowX` of a wall slot is its `WALL_RUN_BACK_XS` value.
  - `faceSkus(slot: FaceSlot): string[]` = `fillFaceList(group)`, where the group is `DEPARTMENT_GROUPS[dept][(bay × 5 + shelf) % groups.length]`, filtered to SKUs whose pack height ≤ `shelfClearanceM(slot.shelf)` (memoised per group and shelf).
- [ ] **Step 1: Write the failing tests:**
  - `"enumerates 7 × 2 × 3 × 5 × 2 + 2 × 2 × 3 × 5 = 480 faces"`: `FACE_SLOTS.length === 480`.
  - `"wall runs only stock their interior side"`: every `wW` slot has `side === 1` and every `wE` slot has `side === -1`.
  - `"every placement fits under the shelf above"`: for every slot, every SKU from `faceSkus(slot)` has pack height ≤ `shelfClearanceM(slot.shelf)`.
  - `"fills ≥ 96 % of every face"`: the sum of `computeFacings(faceSkus(slot), FACE_USABLE_M)` widths plus gaps ≥ 0.96 × `FACE_USABLE_M`.
  - `"facings are 1 cm apart"`: consecutive facing extents from `computePlacements` differ by `FACING_GAP_M` (within 1e-9).
  - `"stocks front to back"`: for `"milo-400g"` (pack depth 0.105 m), `depth === 3`; for `"kopi-3in1"` (0.065 m), `depth === 6`.
  - `"every catalog SKU appears on some face"` (replaces the stale "12 SKUs" test).
  - Delete `EXPECTED_FACING_COUNTS`, the 20-face test and the stale `milo-300g` references.
- [ ] **Step 2:** Run `npx vitest run tests/planogram.test.ts`. Expected: FAIL on the new tests.
- [ ] **Step 3:** Implement the `planogram.ts` changes. In `storeLayout.ts`, add `stockRuns(scene, bundle)` to replace `stockShelfRow`. It iterates `FACE_SLOTS` and builds a `PlacementCell` from each slot. It buckets placements by `` `${skuId}|${unit}:${run}` `` and creates one `InstancedMesh` per bucket, with `userData.productId = skuId`. It calls `computeBoundingSphere()` on each mesh so the raycast and frustum culling skip whole runs.
- [ ] **Step 4:** Run `npx vitest run tests/planogram.test.ts`, then `npm test`. Expected: planogram passes, and only the pre-existing failures in other files remain.
- [ ] **Step 5:** Run `npm run dev` and check by hand: shelves read packed with no empty levels, and hovering a pack still shows its name and price.
- [ ] **Step 6:** Commit: `feat(store): tight-packed bay planogram with departments`.

### Task 5: Rail price tags as instanced meshes

**Files:**
- Modify: `src/game/railTags.ts` (keep the path)

**Interfaces:**
- Consumes: Task 4 (`FaceSlot`, `computeFacings`, the same placement math).
- Produces: `buildRailTags(scene, slots: readonly FaceSlot[]): void`. It creates one `InstancedMesh` per SKU (shared `TAG_GEOMETRY` plus that SKU's cached tag texture), with one instance per facing. It replaces the per-facing `Mesh`, and tags still carry `userData.isRailTag = true`.

- [ ] **Step 1:** Change `TAG_WIDTH_M` to `min(0.28, facing.widthM - 0.01)` by scaling the instance in x, so tags never overlap the neighbouring facing at 1 cm gaps. Tag y = `boardY - 0.02` (on the price strip).
- [ ] **Step 2:** Run `npx tsc --noEmit` and `npm test`. Expected: no new failures.
- [ ] **Step 3:** Run `npm run dev` and check by hand: every facing has a readable tag on its strip, and the tags don't overlap.
- [ ] **Step 4:** Commit: `perf(store): instance rail price tags per SKU`.

### Task 6: Checkouts and relocated props

**Files:**
- Modify: `src/three/storeLayout.ts` (`TILL_X`/`TILL_Z` re-exported from `storeGeometry`, `buildCheckoutCounter`, `buildKedaiSign`, `buildGrabPickup`, `buildStoreroomDoor`, `buildBench`, and the header plan comment), `src/game/TillStation.ts` (use `TILL_ZONE`), `src/three/main.ts:643-644` (`standX = TILL_X + STAND_OFFSET_X_M`)

**Interfaces:**
- Consumes: Task 1 (`CHECKOUT_XS`, `TILL_X`, `TILL_Z`, `STAND_OFFSET_X_M`, `TILL_ZONE`, `GRAB`, `BENCH`, `STAFF_DOOR_X`, `COUNTER_W_M`).
- Produces: `storeLayout` still exports `TILL_X` and `TILL_Z` (re-exported) for `checkoutFlow.ts` and `main.ts`.

- [ ] **Step 1: Counters.** Build a counter, conveyor and mat at each of the `CHECKOUT_XS`. On the two closed counters, add:
  - A "KAUNTER DITUTUP" A-frame on the belt: a canvas texture with white text on red, 0.35 × 0.2 m, two planes leaning 15°.
  - A dummy monitor box (0.4 × 0.3 × 0.05) on a pole.

  Warn in the console if the measured counter width differs from `COUNTER_W_M` by > 0.05 m.
- [ ] **Step 2: PASARAYA MESRA sign.** Hang it at x = `CHECKOUT_XS[1]`, z = `TILL_Z - 1.28`, y = 3.1, with rods up to `CEILING_HEIGHT_M`. Make it double-sided: a second plane rotated π, so it reads both from the store floor and from the till.
- [ ] **Step 3: Props.**
  - Grab counter at `GRAB`, rotated so it faces into the store (east).
  - Bench at `BENCH`, facing east.
  - The storeroom door slab, renamed staff door, on the back wall at `STAFF_DOOR_X`, facing −Z into the store.
  - Use `solidFootprints()` entries for their colliders.
- [ ] **Step 4: Verify.** Run `npx tsc --noEmit` and `npm test`. Expected: no new failures.
- [ ] **Step 5: Check by hand** in `npm run dev`:
  - The game starts behind the till.
  - E serves a waiting customer.
  - The till camera, belt and POS stand are aligned on the new counter.
  - Both closed counters show their sign.
- [ ] **Step 6:** Commit: `feat(store): three checkout counters and relocated props`.

### Task 7: Customer routes, queue, crowd size

**Files:**
- Modify: `src/game/storeRoute.ts` (rebuild the graph from geometry), `src/game/customers3d.ts:37` (`MAX_IN_STORE = 8`)
- Test: `tests/storeRoute.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 (`GONDOLA_XS`, `FACE_HALF_M`, `WALL_RUN_BACK_XS`, `RUNS`, `bayCenterZs`, `CROSS_AISLE_Z`, `DOOR`, `FRONT_Z`, `TILL_X`, `TILL_Z`, `COUNTER_W_M`, `solidFootprints`).
- Produces: the same exports with the same names: `ROUTE_NODES`, `BROWSE_STOPS`, `QUEUE_SLOTS`, `findPath`, `pathPoints`, and node ids `"door"`, `"exit"`, `"Sc"`. `customers3d.ts` needs no other change.
  - Aisle xs: the midpoints of consecutive `GONDOLA_XS`, plus the outer aisles at (`WALL_RUN_BACK_XS[0] + FACE_HALF_M + GONDOLA_XS[0] - FACE_HALF_M`) / 2 and its mirror.
  - Per aisle: a front cross-aisle node, a lane node at each front-run bay z, a middle cross-aisle node, a lane node at each back-run bay z, and a back cross-aisle node, linked in that order. Cross-aisle nodes are linked to their neighbours along each cross-aisle.
  - `door` = (`DOOR.x`, `FRONT_Z - 0.45`), linked to the front cross-aisle node of the west outer aisle.
  - `exit` = (`TILL_X - COUNTER_W_M / 2 - 0.8`, `TILL_Z - 0.85`) → `exitLane` = (same x, `FRONT_Z - 0.7`) → `door`. `exit` has no other edges.
  - `Sc` = the front cross-aisle node nearest the queue tail (aisle x closest to `TILL_X + 2.25`).
  - `QUEUE_SLOTS` (6) = (`TILL_X`, `TILL_Z - 0.85`), (`TILL_X`, `TILL_Z - 1.6`), (`TILL_X`, `TILL_Z - 2.35`), then east at that z: `TILL_X + 0.75`, `+1.5`, `+2.25`.
  - Browse stops: at each lane node, one per adjacent shelf face. Stand at the face lip ± 0.55 m into the aisle; look at the lip.
- [ ] **Step 1: Write the failing tests** in `tests/storeRoute.test.ts`:
  - `"every browse stop and every queue slot is reachable from the door"`: `findPath("door", stop.node).length > 0`; and `findPath("door", "Sc")`, `findPath("exit", "door")`.
  - `"no route edge passes within 0.3 m of a solid"`: sample each edge every 0.05 m, and every sample lies outside all `solidFootprints()` boxes inflated by 0.3.
  - `"browse stands are clear and face a shelf lip"`: each stand lies outside every inflated footprint, and `|stand.x - look.x| ≈ 0.55`.
  - `"queue slots are clear of solids and off the front cross-aisle"`: ≥ 0.4 m from every footprint, and `|slot.z - CROSS_AISLE_Z.front| >= 0.6`.
  - `"queue slot 0 is where checkoutFlow expects the customer"`: `QUEUE_SLOTS[0]` equals (`TILL_X`, `TILL_Z - 0.85`).
  - `"exit leads straight out, not back through the store"`: `findPath("exit", "door")` equals `["exit", "exitLane", "door"]`.
- [ ] **Step 2:** Run `npx vitest run tests/storeRoute.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the rebuilt `storeRoute.ts`, and set `MAX_IN_STORE = 8`. Update the header diagram comment.
- [ ] **Step 4:** Run `npx vitest run tests/storeRoute.test.ts`, then `npm test`. Expected: storeRoute passes, and only the pre-existing failures remain.
- [ ] **Step 5:** Run `npm run dev` and watch for 3 in-game hours: shoppers enter at the door, browse aisles, queue in the L shape, pay, and leave through the lane. None walks through a shelf or counter.
- [ ] **Step 6:** Commit: `feat(customers): routes for the new layout, 8 shoppers, 6 queue slots`.

### Task 8: Performance pass and docs

**Files:**
- Modify: `src/three/main.ts` (add `renderer` to the dev-only `__sim` handle), `README.md` (store description), `src/three/storeLayout.ts` (only if over budget)

- [ ] **Step 1: Measure.** In `npm run dev`, read `__sim.renderer.info.render` from the dev console at 3 spots: behind the till, at the west aisle mouth, and at the back walkway. Budget: `calls ≤ 400` and `triangles ≤ 1,500,000`, with the Chrome performance panel showing frame time ≤ 16.7 ms on the target laptop.
- [ ] **Step 2: Only if over budget,** apply in this order and re-measure after each:
  1. `MAX_DEPTH = 4`.
  2. Drop the hidden back-row instances on the bottom shelf.
  3. Merge the rail-tag instanced meshes into a single atlas mesh.
- [ ] **Step 3: Docs.** README: replace the store description with the new layout (front entrance, 3 counters, departments). Then update the header comments in `storeLayout.ts` and `planogram.ts` (the plan diagrams).
- [ ] **Step 4: Full verification.** Run `npx tsc --noEmit && npm test && npm run build`. Expected: the type-check is clean, the build succeeds, and the test failures are pre-existing only (≤ 9, all outside `planogram`, `storeGeometry` and `storeRoute`).
- [ ] **Step 5:** Commit: `docs(store): document stage 1 layout; perf budget met`.
