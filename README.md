# Pasaraya Mesra — Supermarket Simulator
Cozy first-person Malaysian supermarket cashier simulation for the browser — single-player, Three.js + TypeScript.

## Run
- `npm install`
- `npm run dev` — start the dev server (Vite prints the local URL)
- `npm test` — run the unit suite
- `npm run build` — type-check + production build into `dist/`

## Playing a shift
The store trades 9:00 AM – 10:00 PM, compressed into 8 / 12 / 20 real minutes (settings). Shoppers walk in (door chime), browse the aisles, queue at the till, and leave with their bag. It gets busier at lunch and after work. At 10 PM the doors close; once the last customer is served, press **E** at the till to close up and see the day's summary and drawer count.

### Walking
- WASD / arrows — walk · Mouse — look (click to lock the pointer) · Esc — pause / settings
- Aim at a shelf item (within ~2.2 m) to see its name and price.
- **E** at the till — serve the customer waiting there.

### At the till
Everything is done with the mouse. The only key is **Esc** — void the transaction (asks first; Esc again keeps serving).

| Click | Action |
| --- | --- |
| The handheld scanner (beside the belt) | Pick it up / put it back. It follows the cursor while held |
| The pack at the scan line (scanner in hand) | Scan it — the scanner dips over the pack and beeps |
| The stack of plastic bags | Add a 20-sen bag (match what the customer asked for) |
| A placed bag | Take that bag back off the bill |
| What the customer holds out | Take payment: cash goes straight into the drawer, a card is charged, a QR phone is scanned with the scanner (keep it in hand) |
| Drawer slots | Pick notes / coins onto the change tray |
| A piece on the tray | Put it back in the drawer |
| The tray | Hand the change over |

The drawer opens and closes by itself. The POS keypad is decorative.

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
