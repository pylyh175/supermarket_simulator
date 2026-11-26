/**
 * Till session — the pure state machine behind one customer's sale.
 * Every function returns a NEW session (or the same one when the action is
 * not allowed in the current phase). All money is integer sen.
 *
 *   scanning ──(last item)──▶ payment ──selectPayment──▶ tender (cash)
 *                                   │                      │ receivePayment
 *                                   │                      ▼
 *                                   │                   change ──handOverChange(exact|over)──▶ done
 *                                   └──▶ electronic (qr/card) ──confirmElectronic──▶ done
 *
 * Plastic bags are separate 20-sen line items, editable until a payment
 * method is chosen. Cash totals are rounded to 5 sen (see rounding.ts).
 */
import { cashRoundingAdjustment } from "./rounding";

export const BAG_PRICE_SEN = 20;

export type PaymentMethod = "cash" | "qr" | "card";

export type Phase = "scanning" | "payment" | "tender" | "electronic" | "change" | "done";

export interface LineItem {
  id: string;
  name: string;
  priceSen: number;
}

export interface Session {
  readonly items: readonly LineItem[];
  /** Items scanned so far (prefix of `items`). */
  readonly scanned: number;
  /** Plastic bags charged on this bill. */
  readonly bags: number;
  /** Scanned items + bags, before rounding. */
  readonly subtotalSen: number;
  readonly method: PaymentMethod | null;
  /** Cash rounding adjustment (−2..+2); 0 for QR / card. */
  readonly roundingSen: number;
  /** What the customer pays: subtotal + rounding. */
  readonly totalDueSen: number;
  readonly tenderedSen: number | null;
  readonly changeDueSen: number;
  /** Pieces picked from the drawer for the change tray, in pick order. */
  readonly given: readonly number[];
  readonly givenSen: number;
  /** How many times the change was handed over (1 = right first time). */
  readonly changeAttempts: number;
  /** Over-given change the customer handed back. */
  readonly returnedSen: number;
  readonly phase: Phase;
}

export type HandOverResult =
  | { kind: "exact"; diffSen: 0 }
  | { kind: "short"; diffSen: number }
  | { kind: "over"; diffSen: number };

function itemsSubtotal(items: readonly LineItem[], scanned: number): number {
  let sum = 0;
  for (let i = 0; i < scanned; i += 1) sum += items[i].priceSen;
  return sum;
}

function withBags(s: Session, bags: number): Session {
  const subtotalSen = itemsSubtotal(s.items, s.scanned) + bags * BAG_PRICE_SEN;
  return { ...s, bags, subtotalSen, totalDueSen: subtotalSen };
}

export function createSession(items: readonly LineItem[]): Session {
  return {
    items,
    scanned: 0,
    bags: 0,
    subtotalSen: 0,
    method: null,
    roundingSen: 0,
    totalDueSen: 0,
    tenderedSen: null,
    changeDueSen: 0,
    given: [],
    givenSen: 0,
    changeAttempts: 0,
    returnedSen: 0,
    phase: items.length === 0 ? "payment" : "scanning",
  };
}

export function scanNext(s: Session): Session {
  if (s.phase !== "scanning" || s.scanned >= s.items.length) return s;
  const scanned = s.scanned + 1;
  const subtotalSen = s.subtotalSen + s.items[s.scanned].priceSen;
  return {
    ...s,
    scanned,
    subtotalSen,
    totalDueSen: subtotalSen,
    phase: scanned === s.items.length ? "payment" : "scanning",
  };
}

export function addBag(s: Session): Session {
  if (s.phase !== "scanning" && s.phase !== "payment") return s;
  return withBags(s, s.bags + 1);
}

export function removeBag(s: Session): Session {
  if ((s.phase !== "scanning" && s.phase !== "payment") || s.bags === 0) return s;
  return withBags(s, s.bags - 1);
}

export function selectPayment(s: Session, method: PaymentMethod): Session {
  if (s.phase !== "payment") return s;
  const roundingSen = method === "cash" ? cashRoundingAdjustment(s.subtotalSen) : 0;
  return {
    ...s,
    method,
    roundingSen,
    totalDueSen: s.subtotalSen + roundingSen,
    phase: method === "cash" ? "tender" : "electronic",
  };
}

/** Back out of a chosen method (before any cash changed hands). */
export function cancelPayment(s: Session): Session {
  if (s.phase !== "tender" && s.phase !== "electronic") return s;
  return { ...s, method: null, roundingSen: 0, totalDueSen: s.subtotalSen, phase: "payment" };
}

/** QR / card terminal approved the payment. */
export function confirmElectronic(s: Session): Session {
  if (s.phase !== "electronic") return s;
  return { ...s, phase: "done" };
}

/** Cashier keyed in the cash tendered. Refuses less than the total. */
export function receivePayment(s: Session, tenderSen: number): Session {
  if (s.phase !== "tender" || tenderSen < s.totalDueSen) return s;
  const changeDueSen = tenderSen - s.totalDueSen;
  return {
    ...s,
    tenderedSen: tenderSen,
    changeDueSen,
    phase: changeDueSen === 0 ? "done" : "change",
  };
}

/** Put one note/coin from the drawer onto the change tray. */
export function dispense(s: Session, denomSen: number): Session {
  if (s.phase !== "change") return s;
  return { ...s, given: [...s.given, denomSen], givenSen: s.givenSen + denomSen };
}

/** Take the last piece back off the change tray. */
export function undoDispense(s: Session): Session {
  if (s.phase !== "change" || s.given.length === 0) return s;
  const last = s.given[s.given.length - 1];
  return { ...s, given: s.given.slice(0, -1), givenSen: s.givenSen - last };
}

/**
 * Hand the change tray to the customer. Exact → done. Short → the customer
 * points it out and the sale stays open. Over → the customer hands the extra
 * back and the sale completes (cozy: no penalty).
 */
export function handOverChange(s: Session): { session: Session; result: HandOverResult } {
  if (s.phase !== "change") return { session: s, result: { kind: "short", diffSen: 0 } };
  const changeAttempts = s.changeAttempts + 1;
  const diff = s.givenSen - s.changeDueSen;
  if (diff === 0) {
    return { session: { ...s, changeAttempts, phase: "done" }, result: { kind: "exact", diffSen: 0 } };
  }
  if (diff < 0) {
    return { session: { ...s, changeAttempts }, result: { kind: "short", diffSen: -diff } };
  }
  return {
    session: { ...s, changeAttempts, returnedSen: diff, phase: "done" },
    result: { kind: "over", diffSen: diff },
  };
}
