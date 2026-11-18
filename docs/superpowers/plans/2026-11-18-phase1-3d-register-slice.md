# Phase 1 (3D): First-Person Register Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 of the revised 3D design — a playable first-person, browser-based slice: walk a small Malaysian supermarket in 3D, serve customers at the till end-to-end (scan → pay → exact change → leave), money HUD, persistent localStorage tally, full store shell with inert later-phase props.

**Architecture:** Plain Three.js (no React, no engine) inside the existing Vite project; a new entry (`src/three/main.ts`) replaces the 2D bootstrap, whose Phaser files are deleted in Task 1 (decided 2026-11-18). The HTML/CSS register overlay (chips, LCD, change pad — built in the 2D phase, DOM-based) is reused by porting its logic off Phaser into a plain controller. All pure TypeScript logic modules (session, change, money, denominations, catalog, customer generation, save/load) and their unit tests carry forward unchanged.

**Tech Stack:** TypeScript strict, Vite 8, Three.js (pinned), Vitest. Phaser is uninstalled in Task 1; only Three.js ships at runtime.

**Spec:** `docs/superpowers/specs/2026-11-18-supermarket-sim-design.md` (revised 2026-11-18)

## Global Constraints

- TypeScript strict; **`npx tsc --noEmit` must stay clean**; `npm test` must stay green (all pre-existing logic tests pass — `tests/smoke.test.ts` is the only deleted test).
- All money is **integer sen**; display formatting only via `formatRinggit`.
- No runtime dependencies beyond Three.js. **Phaser is uninstalled** (decided 2026-11-18 — the 2D tree is deleted entirely as part of this plan's Task 1).
- Denominations from `src/data/denominations.ts` (includes 100, i.e. RM1).
- Desktop keyboard + mouse: **WASD/arrows** move, **E/Space** interact, pointer-lock mouse-look, male mouse for UI.
- Cozy tone: no fail states, no timers, no penalties. Customers wait patiently.
- Phase 1 art = **flat-shaded low-poly**, warm palette; **free CC0/CC-BY assets only** (downloads permitted at build time; licenses verified at download; attribution in `ATTRIBUTION.md`; CC0 preferred). No paid packs, no placeholders with "not implemented" signage — the store looks alive.
- Phase 1 store scope: **full small store shell** — till, stocked shelves, entrance, storeroom door, Grab pickup counter, break area — non-register systems **inert scenery only**.
- Saves land in the same localStorage key `supermarket-sim-save`; early saves **may be reset** at phase boundaries (decided) — do not write migrations.
- **Decided 2026-11-18 (human): the 2D Phaser tree is deleted, not retained.** Task 1 deletes `src/main.ts`, `src/scenes/BootScene.ts`, `src/scenes/StoreScene.ts`, `src/scenes/RegisterOverlay.ts`, `src/entities/Player.ts`, `tests/smoke.test.ts`, and uninstalls `phaser`. `docs/` keeps the project history. The DOM register overlay skeleton in `index.html` and `src/ui/register.css` are **reused** and must survive Task 1.
- **Known environment drift:** `package.json` currently contains a re-appeared `packageManager: yarn@…+sha512…` field despite the final review removing it (corepack re-pinned it locally). Task 1 removes it again. Not a code defect.

## Review Focus

The failure modes most likely to bite a player, each pinned to its owning task:

1. **Pointer lock exit/re-enter deadlock** — E to open the till exits pointer lock; Esc/overlay close must either re-request lock (needs user gesture) or leave the player free to click elsewhere without the game soft-locking with no Esc path and no HUD hint. Expect: opening the till always shows "Esc to close • click to look around"-style guidance; close flow requests pointer lock on the same gesture that closes. Test in Tasks 6–7.
2. **Asset load failure** — a missing/blocked pack file must degrade to hand-built primitive stand-ins, never a blank screen or unhandled exception on boot. Test in Tasks 4–5.
3. **Save corruption/reset** — corrupt localStorage must never block boot; Phase 1 may also reset early saves (decided) — the fallback is defaults, never a crash. Test in Task 8 (unit suite already covers `save.ts`) and manual check in Task 9.
4. **Double interaction at the till zone edge** — holding E must not toggle the overlay open/closed repeatedly, and a stray `till:closed` must not double-advance the queue. Test in Tasks 6–7 (the 2D idempotent-`closeTill` guard pattern, carried forward).
5. **WebGL unavailable / mid-range hardware** — no WebGL ⇒ readable fallback message; 60 fps target on mid-range; flat shading; no per-frame allocations (reuse `Vector3` temporaries). Test in Tasks 3 and 9.

---

### Task 1: Remove the 2D Phaser tree; scaffold the Three.js entry

**Files:**
- **Delete:** `src/main.ts`, `src/scenes/BootScene.ts`, `src/scenes/StoreScene.ts`, `src/scenes/RegisterOverlay.ts`, `src/entities/Player.ts`, `tests/smoke.test.ts`
- Create: `src/three/main.ts` (boots the 3D app; empty scene with warm background), `src/three/WebGLCheck.ts` (detects WebGL failure, shows fallback message)
- Modify: `index.html` (entry `<script type="module" src="/src/three/main.ts">`; keep the `#register-ui`/`#money-hud` skeleton untouched), `package.json` (add `three` + `@types/three`, **uninstall `phaser`**, remove `packageManager`)
- Test: none new (all pre-existing logic tests must stay green; `tests/smoke.test.ts` is the only deleted test)

**Interfaces:**
- Produces: `import * as THREE from "three"` works; `main.ts` creates `WebGLRenderer`, scene (background `#f5efe0` warm cream), perspective camera (`fov: 70`, near 0.1, far 100), resize handler (debounced optional), rAF animation loop, `WebGLCheck.assert()` returning boolean or showing `#webgl-fallback` div (in `index.html`, hidden by default).

- [ ] **Step 1:** Remove the 2D files (exact list above) and then `npm uninstall phaser`; install: `npm install three@<latest-stable>` and `npm install -D @types/three`. Record exact versions in the report.
- [ ] **Step 2:** Write `src/three/main.ts` and `src/three/WebGLCheck.ts` per the interface. If WebGL is missing, show the fallback (never throw).
- [ ] **Step 3:** Add `#webgl-fallback` in `index.html`; switch entry to `/src/three/main.ts`. Keep the `#register-ui` and `#money-hud` skeleton untouched.
- [ ] **Step 4:** Edit `package.json` per constraints (remove `packageManager`, keep `engines >=22.12`).
- [ ] **Step 5:** Verify: `npm test` → all remaining pre-existing tests green; `npx tsc --noEmit` → clean (deleted files gone); `npm run build` → succeeds; `npm run dev` serves the empty warm-cream 3D scene. (The 2D scenes must be gone and nothing references them — grep `phaser` and `scenes/` after deletion.)
- [ ] **Step 6:** **Do not commit** — leave the working tree for the user. Report.

---

### Task 2: Pure movement + AABB collision module (TDD)

**Files:**
- Create: `src/player/movement.ts`, `src/player/colliders.ts`, `tests/colliders.test.ts`
- Test: `tests/colliders.test.ts`

**Interfaces (all pure, no THREE imports — vectors as `[number, number, number]`):**

```ts
// movement.ts
export type MoveKeys = { forward: boolean; back: boolean; left: boolean; right: boolean };
export function moveVector(keys: MoveKeys, yawRad: number, speedMps: number): [number, number, number];
// normalized direction rotated by yaw; diagonal is NOT faster; zero vector when no keys
export function eyeHeightM(): number; // 1.6 — camera eye height

// colliders.ts
export interface Aabb { minX: number; minZ: number; maxX: number; maxZ: number; } // Y not collided; floor is flat
export function circleAabbResolve(pos: [number, number], radius: number, box: Aabb): [number, number]; // push-out, axis-separated-safe
export function clampToBounds(pos: [number, number], radius: number, bounds: Aabb): [number, number];
export function makeWallBoxes(widthM: number, depthM: number, wallThicknessM: number): Aabb[];
```

- [ ] **Step 1: Write the failing tests first** (name them, assert direction math for yaw 0/90/180/270, diagonal = normalized, zero when idle; push-out from inside each of four box faces; clamp inside bounds; wall boxes make exactly 4):

```ts
// tests/colliders.test.ts
import { describe, it, expect } from "vitest";
import { moveVector } from "../src/player/movement";
import { circleAabbResolve, clampToBounds, makeWallBoxes } from "../src/player/colliders";
// ... assert these exactly (invent literals from yaw math; yaw 0 ⇒ +z? Document your convention: forward = -Z, right = +X):
// moveVector({forward:true,...}, 0, 2.5) ⇒ [0, 0, -2.5]; diagonal normalizes to length 2.5;
// circleAabbResolve([0.5, 0], 0.3, box at [1, -1, 2, 1]) pushes out along -X with penetration accounted;
// clampToBounds keeps the player inside; makeWallBoxes(20, 14, 0.4) ⇒ 4 walls forming the shell.
```

- [ ] **Step 2:** Run `npm test` — new tests FAIL (module not found).
- [ ] **Step 3:** Implement `movement.ts` + `colliders.ts` (pure functions; no THREE).
- [ ] **Step 4:** Run `npm test` — all green (29 + yours); `npx tsc --noEmit` clean.
- [ ] **Step 5:** **Do not commit.** Report.

---

### Task 3: First-person scene — renderer, lights, shell, FPS controller

**Files:**
- Create: `src/player/FpsController.ts`, `src/three/storeShell.ts`
- Modify: `src/three/main.ts`

**Interfaces:**
- Consumes: `moveVector`, `eyeHeightM`, `circleAabbResolve`, `clampToBounds`, `makeWallBoxes` (Task 2).
- Produces: `FpsController` — pointer lock on canvas click; mouse-look (yaw+pitch clamped ±85°); WASD/arrow keys held; `update(dt)` integrates velocity, resolves collisions against `Aabb[]`, clamps to bounds; exposures `yaw()`, `pitch()`, `position()` for the camera rig (camera positioned at `(x, eyeHeightM(), z)` with rotation order `YXZ`). `storeShell.ts` builds floor (warm `#d9c39a` plane 20×14 m), walls (boxes `#c9a878`), and returns the collider list `Aabb[]` shared by the controller.

- [ ] **Step 1:** Implement scene bootstrap: `WebGLRenderer` (antialias, `outputColorSpace` default), hemisphere light (warm white, ground tan) + directional (soft, slight warm angle), shadows OFF for flat-shaded look or `shadowMap` enabled with one light (implementer's call, document), camera at eye height, `YXZ` rotation order.
- [ ] **Step 2:** Implement `FpsController` per the interface — pointer lock on click (`requestPointerLock`); mouse move updates yaw/pitch; keys set held state; `update(dt)` resolves.
- [ ] **Step 3:** Build store shell (floor, 4 walls with a doorway gap on north side left as opening but **bounded by invisible colliders** so the player can't leave; visual opening optional). Add warm ambient + subtle fog (`#f0e6cc`, 30 m) for depth.
- [ ] **Step 4:** Manual checklist: click canvas → pointer locks; WASD/arrows walk; turn 360° with mouse; diagonal not faster; walls block with push-out (no tunneling at 60 fps; also test holding a key during tab-switch resume via a 50 ms delta clamp); window resize keeps rendering; Esc exits pointer lock (browser default) without breaking the game.
- [ ] **Step 5:** `npm test` green; `npx tsc --noEmit` clean; **Do not commit.** Report.

---

### Task 4: Free-asset sourcing + attribution (or primitive fallback)

**Files:**
- Create: `ATTRIBUTION.md`, `public/assets/` (downloaded models/textures), `src/three/assets.ts` (manifest + loader)
- Modify: `src/three/main.ts` (loading screen: simple progress indicator)

**Interfaces:**
- Produces: `loadAssets(): Promise<AssetBundle>`; `AssetBundle = { products: Map<string, THREE.Group>; shelves; counter; signage; customers }` — every asset falls back to a color-coded placeholder group (box + CanvasTexture label) when absent or failed to load; the game boots either way (never throws).

- [ ] **Step 1:** Try downloading candidate CC0 packs (Kenney Furniture/City/Shopping kits, Quaternius furniture, KayKit adventurers — verify license at download). Record each file: source URL, license, author in `ATTRIBUTION.md`. Prefer committed-binary-free layout (`public/assets/...`).
- [ ] **Step 2:** If downloads fail (network blocks, licenses unclear), fall back to fully procedural primitives: product boxes with `CanvasTexture` labels (product name in Malaysian-style packaging colors) for the ~12 catalog items, shelf/counter boxes, capsule customers. This fallback must be complete, not partial.
- [ ] **Step 3:** Implement `assets.ts`: manifest-driven `GLTFLoader` (from `three/examples/jsm/loaders/GLTFLoader.js`), per-asset try/catch, placeholder fallback per asset, `ATTRIBUTION.md` lists everything shipped.
- [ ] **Step 4:** Loading screen: DOM overlay `#loading` with a warm progress bar; fades out when `AssetBundle` resolves; if WebGL fails, Task 1's fallback shows instead.
- [ ] **Step 5:** `npm test` green; `npx tsc --noEmit` clean; **Do not commit.** Report which assets or fallback are in place.

---

### Task 5: Store layout build-out — shelves, till, entrance, storeroom door, pickup counter, KEDAI sign

**Files:**
- Create: `src/three/storeLayout.ts`
- Modify: `src/three/main.ts`, `src/player/FpsController.ts` (feed collider list)

**Interfaces:**
- Produces: `buildStore(scene: THREE.Scene, assets: AssetBundle): Aabb[]` — builds the complete small store: back wall stocked shelves (3–4 double-sided shelf rows, stock colored boxes/cylinders with CanvasTexture Malaysian product labels), checkout counter bottom-center with till mat + conveyor block, entrance doorway top-center (visual door, collidable wall gap), storeroom door top-left (inert; plain door prop), Grab pickup counter top-right (inert; small counter + Grab green signage), "KEDAI RUNCIT" sign behind the till, one break-area bench bottom-left (inert). Returns merged collider list for FpsController.
- Malaysian flavor labels: KEDAI RUNCIT, MILO, MAGGI, ROTI, NASI LEMAK, TELUR, SABUN, KUIH — as CanvasTexture signage/labels (no external font files; system fonts on canvas).

- [ ] **Step 1:** Layout constants (positions, sizes, rotations) in `storeLayout.ts` — named constants, no magic numbers; colors: shelf wood `#8a5a2e`, counter cream `#e8e2d6`, Grab green `#00aa5b`, warm cream walls.
- [ ] **Step 2:** Build props + merge their AABBs into the collider list; pass colliders to FpsController at construction.
- [ ] **Step 3:** Lighting pass: soft directional warm key + hemisphere fill; materials `MeshLambertMaterial` or `MeshStandardMaterial` with `flatShading: true`; target 60 fps mid-range (single draw call per shelf row where feasible).
- [ ] **Step 4:** Manual checklist: every prop solid (no walking through shelves/counters/walls), entrance/storeroom/pickup all visible from spawn, store feels warm, spawn point inside facing the till.
- [ ] **Step 5:** `npm test` green; `npx tsc --noEmit` clean; **Do not commit.** Report.

---

### Task 6: Customer in 3D — queue, walk, till station (E to serve)

**Files:**
- Create: `src/game/customers3d.ts`, `src/game/TillStation.ts`
- Modify: `src/three/main.ts`

**Interfaces:**
- Consumes: `makeQueue` (`src/customers/generate`, unchanged), `Customer` type, `AssetBundle` (Task 4), `FpsController` (Task 3), DOM name labels (a `<div id="labels">` overlay; positions projected each frame via `Vector3.project(camera)`).
- Produces: `CustomerAvatar` (group: capsule/low-poly figure, name label via DOM), `spawnNextCustomer()`, `update(dt)` walking entrance → counter at ~1.2 m/s (unhurried), `TillStation` — an invisible box zone behind the till mat; on E/Space with `ServingState === "waiting"`, calls `game.openTill(customer)`.

- [ ] **Step 1:** Implement `customers3d.ts` — queue (reuse `makeQueue`, refill when ≤ 3), one walking-in customer, wait at counter (idle bob), leave after service; name label as DOM element positioned each frame (`labels` overlay, pointer-events none); remove on leave.
- [ ] **Step 2:** Implement `TillStation.ts` — zone volume behind till; `isPlayerInside(pos)`; E/Space handled by main loop: if inside & customer waiting → emit to game (`onOpenTill(customer)`); `ServingState` state machine `walking-in | waiting | walking-out | serving`.
- [ ] **Step 3:** Pointer-lock flow: on opening the till, `document.exitPointerLock()`; game sets `overlay open`; **never re-request lock until the overlay closes**, and the close gesture re-requests lock (UX boundary for Review Focus #1).
- [ ] **Step 4:** Manual checklist: customer walks in ~3–4 s, stands at till facing player; E at till freezes player + exits pointer lock + opens overlay (empty in this task — verify hook fires via log); customer leaves on close; next customer spawns; multiple E presses no double-launch; DOM name label readable and tracks the customer.
- [ ] **Step 5:** `npm test` green (29 + none new — thin glue); `npx tsc --noEmit` clean; **Do not commit.** Report.

---

### Task 7: Port the register overlay off Phaser into a plain DOM controller

**Files:**
- Create: `src/ui/RegisterController.ts` (the 2D overlay's DOM wiring — render(), chip chips, LCD, change pad, thank-you — written fresh against the existing `#register-ui` skeleton, without Phaser; `open(customer)`, `onClose(cb)`)
- Note: the 2D `RegisterOverlay.ts` was deleted in Task 1 — there is no scene to reuse; port the DOM logic, not the Phaser scene wrapper (its CSS, `index.html` skeleton, and the session logic it called all survive).
- Test: none (glue over the tested session module)

**Interfaces:**
- Consumes: everything from Task 7 (2D) — the `#register-ui` skeleton in `index.html`, `register.css`, `createSession/scanNext/receivePayment/dispense/undoDispense`, `DENOM_LABELS`, `formatRinggit`, `makeChange` (hint only).
- Produces: `RegisterController` — on `mount(customer)`, wires the existing DOM (chips, LCD, change pad, thank-you, Escape) to a session; exposes `open(customer)`, `close()`; emits `onClose({ completed: boolean })`; on close: hide overlay (root hidden), remove key listeners, call cb.

- [ ] **Step 1:** Port the overlay DOM logic (render(), chip creation/rescan, LCD display modes, change-pad wiring, thank-you banner, Escape handling, the `[hidden]`-safe markup usage) into `RegisterController.ts` with no Phaser imports — `document`/`window` only; replace the scene's emit with the `onClose({ completed })` closure; Escape → `onClose({ completed: false })`; completion → 1 s thank-you → `onClose({ completed: true })`. The `#register-ui` skeleton and `register.css` are already in the tree — verified present and complete; only wire them.
- [ ] **Step 2:** Wire `main.ts`: on `game.openTill(customer)` → `controller.open(customer)`; on `controller.onClose(cb)` → hide overlay, game resumes (customer walks out / away), re-request pointer lock on that same user gesture; money credited via `game.creditMoney(basketTotalSen)` when `completed`.
- [ ] **Step 3:** HUD: `#money-hud` (exists) shows `Money: RM<fmt>`; `loadSavedMoney()` on boot; `persistMoney()` on credit (try/catch both, as 2D).
- [ ] **Step 4:** Manual checklist: full end-to-end service — scan chips via click/E, pay, exact change, thank-you, customer walks out, tally rises; Escape abandon → no credit, customer walks away, re-lock happens on close gesture; pointer lock exits/re-enters cleanly (Review Focus #1); double E no-op; "Too much" amber flash works; HUD reads correct RM format.
- [ ] **Step 5:** `npm test` green; `npx tsc --noEmit` clean; **Do not commit.** Report.

---

### Task 8: Save/load wiring in 3D entry

**Files:**
- Modify: `src/three/main.ts` only (no new module)

**Interfaces:**
- Consumes: `loadGame`, `saveGame` (existing, unit-tested).
- Produces: boot-time `this.moneySen = loadSavedMoney() ?? 0`; on credit, `persistMoney()` (both try/caught, never blocking boot). Early saves may reset (decided) — no migration.

- [ ] **Step 1:** Wire boot load + save-on-credit in `main.ts` (verify the HUD re-renders with the loaded value immediately).
- [ ] **Step 2:** Manual check: serve a customer, note tally, reload page → tally persists; set `supermarket-sim-save` to `{garbage` → reload → boots with RM0.00, no crash; `2026-11-18` shape with wrong version → resets silently.
- [ ] **Step 3:** `npm test` green; `npx tsc --noEmit` clean; **Do not commit.** Report.

---

### Task 9: End-to-end verification + docs + playtest gate

**Files:**
- Create: `README.md` (≤ 20 lines: install, dev, test, controls, save key, pointer to plan/spec, asset attribution note)
- Verify: everything

- [ ] **Step 1:** `npm run build` — succeeds (chunk-size warning acceptable); `npm test` — all green; `npx tsc --noEmit` — clean.
- [ ] **Step 2:** Full Phase 1 manual checklist (run `npm run dev`): walk the store (spawn → till), stocked shelves + inert storeroom door/Grab counter/break bench; serve ≥ 3 customers in a row; verify HUD; reload → tally persists; mid-service reload → no crash; mouse-look comfort; 60 fps feel (or document hardware).
- [ ] **Step 3:** Write `README.md` per spec; confirm `ATTRIBUTION.md` complete (every downloaded asset listed with license + author).
- [ ] **Step 4:** **Do not commit.** Report; the final gate is the human's playtest verdict.
---

## Phase 1 (3D) Definition of Done

- Suite green; build green; tsc clean; WebGL fallback and Asset-fallback paths both verified (simulate missing assets); Phase 1 checklist passed by a human in a browser; early saves noted as resettable; the 2D Phaser tree has been deleted and `docs/` retains the history; working tree ready for the human's commit.
