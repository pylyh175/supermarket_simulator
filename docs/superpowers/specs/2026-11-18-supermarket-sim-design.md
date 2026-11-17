# Malaysian Supermarket Cashier Simulator — Design Doc

Date: 2026-11-18
Status: Draft — pending builder check and human approval

## Intent and the Why

A cozy, relaxing browser game where you work a shift at a Malaysian supermarket.
The player walks freely around the shop floor and completes everyday tasks:
manning the checkout, restocking shelves, packing online delivery orders,
watching for shoplifters, and answering customer questions. The fantasy is
being a small-town Malaysian supermarket worker — the Grab driver arriving,
the Milo and Maggi on the shelves, the ringgit change you count out — without
any real-world pressure.

Why: the player wants a low-stress, single-player experience. The game should
feel warm and unhurried. Success = the player finishes a shift feeling calm
and quietly accomplished, not drained.

**Calibration anchor:** *Supermarket Simulator's* pace. Customers arrive at a
relaxed rate, nobody is impatient, and the player sets their own rhythm. All
tuning knobs (shift length, customer density, driver patience, shoplifter
frequency) are set against that feel.

## Goals

- Free-roam: walk around the whole supermarket (shop floor, storeroom, till).
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
- Browser-based: runs from a static site, desktop keyboard + mouse (WASD/arrows
  to move, E/Space to interact, mouse for UI).
- Malaysian flavor throughout: ringgit denominations (RM1/RM5/RM10/RM20/RM50,
  5/10/20/50 sen), Grab drivers, local products (Milo, Maggi, kuih, nasi lemak,
  Roti…), a "Kedai" signboard vibe.

## Non-Goals

- Multiplayer of any kind.
- Backend, accounts, or a server database (local browser saves only for v1).
- High-pressure challenge modes, fail states that end the run, or scoring that
  punishes the player.
- 3D graphics, realistic art, or complex animation.
- Mobile/touch-first controls (desktop web is the target; touch can come later).

## Anti-Goals (what would make this a failure even if it works)

- A stress-factory: timers tight enough to make players anxious contradict the
  cozy intent.
- Grind: restocking shouldn't be a chore loop without charm.
- Feature creep toward a business-management game (hiring staff, expanding
  stores) — that's a different game. Walkways stay walked, the player stays
  one worker.

## Constraints

- **Stack (decided):** TypeScript + Vite + Phaser 3. Plain HTML/CSS overlay
  for UI screens (register display, receipt, keypad, Grab order list, dialog).
  Tiled map editor for the supermarket layout.
- **State:** single shared game-state module (plain TypeScript, no framework
  state library needed at this scale). Saves via localStorage/IndexedDB.
- **Art:** simple, clean, colorful 2D, tilted ¾ top-down view (Stardew-style
  — shelves and characters show fronts). **Free asset packs first**; custom
  Malaysian-product sprites are simple variations drawn in the same flat
  style (no budget for paid packs or commissioned art in v1).
- **No runtime dependencies beyond Phaser** in v1; audio via Phaser's sound
  manager.
- **No server:** the whole game is static files deployable to any static host.

## Approaches Considered (how it gets built)

Four stacks were evaluated for a 2D, cozy, single-player browser game:

1. **TypeScript + Phaser 3** — most battle-tested 2D web framework; tilemap
   support via Tiled, HTML overlay for UI, huge ecosystem. **Chosen.**
2. **TypeScript + PixiJS** — renderer only; more control, but requires
   hand-building scenes/input/tilemap tooling Phaser provides. Rejected:
   infrastructure work without a payoff for this scope.
3. **Kaplay (Kaboom.js)** — friendly DX, tiny ecosystem; risky for a project
   with five interlocking systems. Rejected on maintainability.
4. **Godot 4 web export** — full engine but ~30–40MB web builds and awkward
   hosting; works against "browser game." Rejected.

Earlier consideration (3D first-person via Three.js/React Three Fiber +
Supabase) was dropped when the concept pivoted to 2D cozy single-player;
the backend requirement disappeared with competitive modes.

Viewpoint options (flat top-down / ¾ tilted top-down / isometric) were
reviewed visually; **¾ tilted top-down** was chosen: shelf fronts and character
faces are visible, and free asset packs are abundant for this style.

## Delivery Cadence (decided)

- **No timeline.** The project takes as long as it takes.
- **Grow system by system:** start from the smallest playable feature and
  build gradually. Phase 1 is a playable register-only slice (walk around a
  small store, serve a customer at the till); each later phase adds one job
  system (restock → Grab → shoplifters → price checks), each ending in a
  playable build.
- **Playtest checkpoints between phases** — and between small features when
  useful. The human plays each build and judges the cozy feel before the next
  phase starts; their verdict is the gate.

## What Was Decided Together

- 2D, clean and colorful, no fancy animation.
- Free-roam movement; the register is a station you walk to, then the game
  locks you into the till interaction until you step away.
- Five job systems as listed under Goals, delivered in phases.
- Cozy, relaxing tone; no fail pressure.
- Strictly single-player, desktop browser.
- TypeScript + Phaser 3 stack.
- Register/change flow: the register does the arithmetic, not the player.
  The player scans each item (its price tag/barcode), the running total and —
  once the customer hands over notes — the exact change due **show on the
  register display**. The player then physically gives that exact change by
  tapping/dragging the right notes and sen coins. Prices may include sen
  since the register displays the exact figure.

## What's Left to the Builder

- Exact shift/day structure (shift length, day end screen, what persists).
- Register UI detail: conveyor pacing, scanning interaction, how the
  change-giving screen feels (tap vs drag denominations), gentle feedback on
  a miscount (customer waits; no penalty).
- Customer AI pacing: how many customers at once, browse/queue/steal
  frequencies, easy ramp across days (calibrated against Supermarket
  Simulator's relaxed pace).
- Grab order flow: how orders arrive (phone/tablet UI), packing step, driver
  patience (generous).
- Shoplifter mechanics: tells, intercept interaction, cozy failure handling.
- Product catalog: starter list of Malaysian items with sen-precision prices.
- Map: one supermarket layout in Tiled (shop floor, storeroom, entrance,
  Grab pickup counter, break area).
- Save format: day, money tally, stock levels (localStorage/IndexedDB);
  no progression systems.
- Audio: gentle background loop + interaction sounds.
- Asset sourcing: pick free base packs; list of Malaysian-product sprites to
  draw as simple variations.

## Out of Scope for v1

- Cloud saves, settings sync, achievements.
- Multiple store layouts.
- Localization beyond English (Malay sprinkles are flavor, not i18n).
