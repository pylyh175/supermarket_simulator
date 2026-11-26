import { describe, it, expect } from "vitest";
import {
  addBag,
  createSession,
  dispense,
  receivePayment,
  removeBag,
  scanNext,
  selectPayment,
  undoDispense,
} from "../src/register/session";

const basket = [
  { id: "milo", name: "Milo 300g", priceSen: 1890 },
  { id: "tens", name: "Tens eggs", priceSen: 1345 },
];
// 1890 + 1345 = 3235, already a multiple of 5 sen — no cash rounding.
const toTender = (s: ReturnType<typeof createSession>) => selectPayment(scanNext(scanNext(s)), "cash");
const paid = (s: ReturnType<typeof createSession>) => receivePayment(toTender(s), 5000);

describe("session", () => {
  it("scans items and totals in sen", () => {
    const s1 = scanNext(createSession(basket));
    expect(s1.totalDueSen).toBe(1890);
    expect(s1.phase).toBe("scanning");
    const s2 = scanNext(s1);
    expect(s2.totalDueSen).toBe(3235);
    expect(s2.phase).toBe("payment");
  });
  it("refuses to scan past the end", () => {
    const s = scanNext(scanNext(createSession(basket)));
    expect(scanNext(s)).toEqual(s);
  });
  it("bags add 20 sen each and lock once payment starts", () => {
    const s = addBag(addBag(scanNext(createSession(basket))));
    expect(s.bags).toBe(2);
    expect(s.totalDueSen).toBe(1890 + 40);
    expect(removeBag(s).bags).toBe(1);
    const tender = selectPayment(scanNext(s), "card");
    expect(addBag(tender)).toEqual(tender);
  });
  it("computes change due", () => {
    const s = paid(createSession(basket));
    expect(s.changeDueSen).toBe(5000 - 3235);
    expect(s.phase).toBe("change");
  });
  it("refuses a note smaller than the total", () => {
    const s = toTender(createSession(basket));
    expect(receivePayment(s, 1000)).toEqual(s);
  });
  it("completes immediately on exact tender", () => {
    const s = receivePayment(toTender(createSession(basket)), 3235);
    expect(s.phase).toBe("done");
    expect(s.changeDueSen).toBe(0);
  });
  it("allows overshoot and undo takes that piece back", () => {
    const s = paid(createSession(basket));
    const over = dispense(s, 2000);
    expect(over.givenSen).toBe(2000);
    expect(over.phase).toBe("change"); // not done until handed over
    expect(undoDispense(over, 2000)).toEqual(s);
  });
  it("undo removes the clicked denomination, not just the last piece", () => {
    const s = dispense(dispense(dispense(paid(createSession(basket)), 1000), 500), 1000);
    const back = undoDispense(s, 500);
    expect(back.given).toEqual([1000, 1000]);
    expect(back.givenSen).toBe(2000);
    expect(undoDispense(s, 50)).toEqual(s); // not on the tray
  });
  it("dispense and undo are no-ops outside the change phase", () => {
    const s = createSession(basket);
    expect(dispense(s, 100)).toEqual(s);
    expect(undoDispense(s, 100)).toEqual(s);
  });
});
