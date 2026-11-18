# Supermarket Simulator
Cozy first-person Malaysian supermarket simulation for the browser — single-player, Three.js + TypeScript.

## Run
- `npm install`
- `npm run dev` — start the dev server (Vite prints the local URL)
- `npm test` — run the unit suite
- `npm run build` — type-check + production build into `dist/`

## Controls
- WASD / arrows — walk
- Mouse — look (click the canvas to lock the pointer)
- E / Space — interact; at the till, open the register / scan the front item
- Esc — exit pointer lock · close the till overlay (abandons the sale)

## Save
Till money persists in localStorage under `supermarket-sim-save` (`{ version: 1, moneySen }`, integer sen). Clear site data to reset.

## Docs
Assets & licenses: ATTRIBUTION.md · Spec: docs/superpowers/specs/2026-11-18-supermarket-sim-design.md · Plan: docs/superpowers/plans/2026-11-18-phase1-3d-register-slice.md
