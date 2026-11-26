# Pasaraya Mesra — Supermarket Simulator
Cozy first-person Malaysian supermarket cashier simulation for the browser — single-player, Three.js + TypeScript.

## Run
- `npm install`
- `npm run dev` — start the dev server (Vite prints the local URL)
- `npm test` — run the unit suite
- `npm run build` — type-check + production build into `dist/`

## Playing a shift
The store trades 9:00 AM – 10:00 PM, compressed into 8 / 12 / 20 real minutes (settings). Shoppers walk in (door chime), browse the aisles, queue at the till, and leave with their bag. It gets busier at lunch and after work. At 10 PM the doors close; once the last customer is served, press **C** to close up and see the day's summary and drawer count.

### Walking
- WASD / arrows — walk · Mouse — look (click to lock the pointer) · Esc — pause / settings
- Aim at a shelf item (within ~2.2 m) to see its name and price.
- **E** at the till — serve the customer waiting there.

### At the till
| Key | Action |
| --- | --- |
| **F** | Scan the pack waiting at the scanner |
| **B** / **N** | Add / remove a 20-sen plastic bag (match what the customer asked for) |
| **C** / **Q** / **K** | Take payment by cash / DuitNow QR / card (the customer says which) |
| **0–9** | Key in the cash received, in sen (`2030` = RM20.30); POS keys RM10/20/50/100 add notes |
| **X** | Exact money |
| Click drawer slots | Pick notes / coins onto the change tray |
| **Enter** | Confirm the tender / hand the change over |
| **Backspace** | Undo the last digit or put the last piece back |
| **D** | Open / close the drawer |
| **Esc** | Void the transaction (asks first) |

You can also click the POS keys with the mouse.

### Malaysian details
- Cash bills are rounded to the nearest 5 sen (Bank Negara rounding mechanism) and shown as a `Rounding Adj` line. QR and card pay the exact sen.
- Customers pay about 50 % cash, 30 % DuitNow QR / e-wallet, 20 % card. Cash comes as a single note, notes to the next RM10, exact money, or "add coins so the change is round" (RM20.30 for RM17.30).
- Plastic bags cost 20 sen each; many customers bring their own bag.
- The drawer opens each day with an RM200 float; the supervisor tops up low denominations.
- No fail states: a short change is pointed out kindly, an over-payment is handed back.

## Save
- Progress: `localStorage["supermarket-sim-save"]` = `{ version: 2, moneySen, day }` (integer sen). Version-1 saves upgrade to day 1.
- Settings: `localStorage["supermarket-sim-settings"]`.
Clear site data to reset.

## Docs
Assets & licenses: ATTRIBUTION.md · Spec: docs/superpowers/specs/2026-11-18-supermarket-sim-design.md · Plans: docs/superpowers/plans/
