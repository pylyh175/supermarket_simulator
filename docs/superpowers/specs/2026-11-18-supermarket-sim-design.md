# Malaysian Supermarket Cashier Simulator — Design Doc

Date: 2026-11-18
Status: Revised 2026-11-18 — 2D → 3D pivot; approved by human 2026-11-18

> **Approval note.** Approved by the human on 2026-11-18, with the follow-on decision
> that the 2D Phaser files are deleted entirely (see Task 1 of the 3D plan);
> `docs/` retains the pivot history. The pure TypeScript logic modules
> (register session, change calculator, money, product catalog, customer
> generation, save/load) carry forward unchanged into the 3D build.
> The Phase 1 2D plan (`docs/superpowers/plans/2026-11-18-phase1-register-slice.md`)
> is superseded by the 3D Phase 1 plan:
> `docs/superpowers/plans/2026-11-18-phase1-3d-register-slice.md`.

## Intent and the Why

A cozy, relaxing browser game where you work a shift at a Malaysian supermarket,
experienced in first person: you turn and walk the aisles, stand at the till,
and complete everyday tasks. The fantasy is being a small-town Malaysian
supermarket worker — the Grab driver arriving, the Milo and Maggi on the
shelves, the ringgit change you count out — without any real-world pressure.

Why: the player wants a low-stress, single-player experience. The game should
feel warm and unhurried. Success = the player finishes a shift feeling calm
and quietly accomplished, not drained.

**Calibration anchor:** *Supermarket Simulator's* pace and its first-person
store feel. Customers arrive at a relaxed rate, nobody is impatient, and the
player sets their own rhythm. All tuning knobs are set against that feel.

## Goals

- **First-person** free-roam: walk the whole supermarket (shop floor,
  storeroom, till), turn in place, mouse-look via pointer lock.
- Five interlocking job systems:
  1. **Register station** — customers queue at the conveyor belt; scan items,
     check the running total on the register, take cash, give correct change.
  2. **Restocking** — collect stock from the storeroom and refill shelves
     before they empty.
  3. **Grab pickup point** — pack online orders and hand them to arriving
     Grab drivers.
  4. **Shoplifter spotting** — notice a customer behaving suspiciously and
     intercept (a gentle mechanic, not a combat/punishment loop).
  5. **Price checks** — customers ask about an item; walk to the shelf or
     terminal to look it up.
- A shared shift/day cycle ties the systems together; the tension comes from
  jobs competing for attention, but softly.
- Strictly single-player, no competitive modes, no leaderboards.
- **Webpage in the browser** first (desktop keyboard + mouse: WASD/arrows to
  move, E/Space to interact, mouse-look with pointer lock, mouse for UI).
  Static hosting; no server.
- Malaysian flavor throughout: ringgit denominations, Grab drivers, local
  products (Milo, Maggi, kuih, nasi lemak…), a "Kedai" signboard vibe.

## Non-Goals

- Multiplayer of any kind.
- Backend, accounts, or a server database (local browser saves only for v1).
- High-pressure challenge modes, fail states that end the run, or scoring that
  punishes the player.
- Realistic/high-fidelity graphics, complex animation, or demanding art.
- A downloadable app (webpage first; a packaged desktop build is a later
  decision, not v1).
- Mobile/touch-first controls.

## Anti-Goals (what would make this a failure even if it works)

- A stress-factory: timers tight enough to make players anxious contradict the
  cozy intent.
- Grind: restocking shouldn't be a chore loop without charm.
- Feature creep toward a business-management game (hiring staff, expanding
  stores) — that's a different game. Walkways stay walked, the player stays
  one worker.
- Motion sickness: no head bob beyond a whisper, a comfortable default FOV,
  and (nice-to-have) a snap-turn option from the start.

## Constraints

- **Stack (decided):** TypeScript + Vite + **Three.js** (plain — no React, no
  game engine). Plain HTML/CSS overlay remains the UI layer for screens
  (register display, receipt, Grab order list, dialog) — it sits on top of
  the 3D canvas and does not know Three.js exists.
- **Reuse (decided):** the pure logic modules carry forward unchanged —
  `session.ts` (till state machine), `change.ts` (exact change), `money.ts`
  (integer sen), `products.ts` (catalog), `denominations.ts`, `generate.ts`
  (customer generation), `save.ts` (localStorage saves) — with their unit
  tests. On 2026-11-18 the human decided to **remove the 2D Phaser tree
  entirely** (superseded by the 3D build); `docs/` retains the 2D plan and
  the pivot history.
- **State:** plain TypeScript shared state module + Three.js scene; no
  framework state library at this scale. Saves via localStorage.
- **Art:** clean, colorful, **low-poly stylized** 3D (flat shading, soft
  palette). **Free asset packs only — no budget for paid packs.** CC0 packs
  (Kenney, Quaternius, KayKit) are the base; CC-BY assets allowed with an
  ATTRIBUTION.md listing them. Custom simple low-poly models for Malaysian
  products (Milo tin, Maggi pack, kuih…) drawn to match pack style.
- **Physics:** no physics engine — axis-aligned box colliders for shelves,
  counters, and walls (same approach as the 2D Player, lifted to 3D AABBs).
- **No runtime dependencies beyond Three.js** (exact version pinned in
  package.json).
- **No server:** static site deployable to any static host.

## Approaches Considered (how it gets built)

For the 3D pivot (browser, first-person, cozy, existing TS codebase):

1. **TypeScript + Three.js, plain, in the existing Vite project** — the
   browser-first home of low-poly 3D. Everything from the 2D build survives
   (logic + tests, DOM overlay UI). PointerLockControls + WASD, AABB
   collisions, static low-poly assets. **Chosen.**
2. **Babylon.js** — comparable engine, more built-in batteries, but its GUI
   is weaker than HTML/CSS and those batteries go unused. Rejected: no
   advantage over Three.js here.
3. **Godot 4 web export** — real scene editor and mature 3D tooling, but
   ~30–40MB web builds, awkward hosting, painful HTML-in-game UI, and the TS
   logic core would be rewritten in GDScript. Rejected.

Historical context: the project earlier evaluated a 2D web stack (Phaser) and
3D at a high level before this pivot; the backend question disappeared with
competitive modes, so no server is involved in any direction.

## Delivery Cadence (decided)

- **No timeline.** The project takes as long as it takes.
- **Grow system by system:** Phase 1 is a playable 3D register-only slice
  (walk the store in first person, serve customers at the till — conveyor,
  scanning, payment, exact change — money HUD, persistence), then one job
  system per phase (restock → Grab → shoplifters → price checks), each
  ending in a playable build.
- **Playtest checkpoints between phases** — the human plays each build and
  judges the cozy feel; their verdict is the gate.
- **2D tree removal (decided 2026-11-18):** the human confirmed the 2D Phaser
  files are deleted as part of the 3D rebuild (Phase 1 plan, Task 1):
  `src/main.ts`, `src/scenes/*`, `src/entities/Player.ts`, `tests/smoke.test.ts`,
  and `phaser` uninstalled. `docs/` keeps the project history.
- **Phase 1 scope at the first gate (decided):** a **full small store shell** —
  till, stocked shelves, entrance, storeroom door, Grab pickup counter, break
  area — with non-register systems inert scenery only. No "not yet open"
  signage or prompts; the store looks and feels alive, it just doesn't do those
  jobs yet.
- **Saves across phases (decided):** early saves may be **reset** at phase
  boundaries — no migration layer for prototype saves; nothing precious is lost.
- **Asset downloads (decided):** downloading CC0/CC-BY packs at build time is
  **allowed**; assets are committed to the repo and ship with the static site;
  attribution tracked in ATTRIBUTION.md. Licensing simplicity beats asset
  scarcity — this is not permission to use paid packs.
- **Plan scope (decided):** after this doc is approved, the plan covers
  **Phase 1 only**, at exact parity with the 2D slice (endless queue, money-
  only save, no shift/day cycle yet). Phases 2+ are designed after their
  predecessors pass playtest gates.

## What Was Decided Together

- First-person, "like actual Supermarket Simulator," in the browser.
- Browser webpage first — desktop packaging deferred.
- Three.js (plain) — Option 1, the recommended stack.
- Free asset packs only (CC0 preferred; CC-BY with attribution file) —
  paid packs are out.
- 2D → 3D pivot: logic modules (and their 29 tests) carry forward; Phaser
  view layer is superseded.
- Cozy, relaxing tone; no fail pressure.
- Strictly single-player.
- Register/change flow unchanged and already decided: the register does the
  arithmetic, the player dispenses exact change in notes and sen coins; the
  display shows the change due; prices may include sen.
- TypeScript strict; integer sen everywhere; desktop keyboard + mouse.

## What's Left to the Builder

- Exact shift/day structure (shift length, day end screen, what persists).
- Camera and controller feel: eye height (~1.6 m), movement speed, mouse
  sensitivity, head bob (whisper or none), comfortable FOV (~70°), snap-turn
  comfort option.
- 3D scene construction: shop-floor layout (supersedes the Tiled 2D map —
  lay out walls/shelves/counter directly in code or a data file), collision
  boxes, entrance, Grab pickup counter, storeroom door.
- Asset selection and attribution: pick free CC0/CC-BY packs (downloads
  permitted); write ATTRIBUTION.md; verify licenses.
- Phase 1 scene scope: full small store shell with stocked shelves and
  inert non-till props (no "not yet open" signage; store looks alive, just
  doesn't perform later-phase jobs).
- Malaysian product models: simple low-poly variations for the ~12 catalog
  items.
- Register overlay port: adapt the DOM overlay (chips/display/change pad) to
  sit on the Three.js canvas with a pointer-lock-exit/re-enter flow when the
  player interacts with the till.
- Customer flow in 3D: queue path, capsule/low-poly customers with simple
  walk animation or bobbing in place, name labels (sprite text or DOM).
- Performance: 60 fps on mid-range hardware; flat shading; merged/instanced
  shelves; no per-frame allocations in the hot path.
- Optional WebGL-missing fallback message.
- Audio: gentle background loop + interaction sounds (howler or WebAudio API,
  no Phaser).
- Lighting: soft directional + hemisphere ambient; warm retail palette.

## Out of Scope for v1

- Cloud saves, settings sync, achievements.
- Multiple store layouts; the store is one building.
- Localization beyond English (Malay sprinkles are flavor, not i18n).
- Dynamic weather, day/night cycle rendering beyond a warm static ambience.
