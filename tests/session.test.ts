import { describe, it, expect } from "vitest";
import { createSession, scanNext, receivePayment, dispense, undoDispense } from "../src/register/session";

const basket = [
  { id: "milo", name: "Milo 300g", priceSen: 1890 },
  { id: "tens", name: "Tens eggs", priceSen: 1345 },
];
const paid = (s: ReturnType<typeof createSession>) =>
  receivePayment(scanNext(scanNext(s)), 5000);

describe("session", () => {
  it("scans items and totals in sen", () => {
    const s1 = scanNext(createSession(basket));
    expect(s1.totalSen).toBe(1890);
    expect(s1.phase).toBe("scanning");
    const s2 = scanNext(s1);
    expect(s2.totalSen).toBe(3235);
    expect(s2.phase).toBe("paying");
  });
  it("refuses to scan past the end (Review Focus 3)", () => {
    const s = scanNext(scanNext(createSession(basket)));
    expect(scanNext(s)).toEqual(s);
  });
  it("computes change due", () => {
    const s = paid(createSession(basket));
    expect(s.changeDueSen).toBe(5000 - 3235);
    expect(s.phase).toBe("change");
  });
  it("refuses a note smaller than the total (Review Focus 2)", () => {
    const s = scanNext(scanNext(createSession(basket)));
    expect(receivePayment(s, 1000)).toEqual(s);
  });
  it("completes immediately on exact tender", () => {
    const s = receivePayment(scanNext(scanNext(createSession(basket))), 3235);
    expect(s.phase).toBe("done");
    expect(s.changeDueSen).toBe(0);
    expect(s.givenSen).toBe(0);
  });
  it("dispenses to exact and finishes", () => {
    const s = paid(createSession(basket));                  // change due: 5000 - 3235 = 1765
    const due = s.changeDueSen;
    const s2 = dispense(dispense(s, 1000), 500);            // 1500
    const s3 = s2.givenSen < due ? dispense(s2, 200) : s2;  // 1700
    const s4 = s3.givenSen < due ? dispense(s3, 50) : s3;   // 1750
    const s5 = s4.givenSen < due ? dispense(s4, 10) : s4;   // 1760
    const s6 = s5.givenSen < due ? dispense(s5, 5) : s5;    // 1765 = due
    expect(s6.givenSen).toBe(1765);
    expect(s6.phase).toBe("done");
  });
  it("allows overshoot and undo takes it back (Review Focus 4)", () => {
    const s = paid(createSession(basket));
    const over = dispense(s, 2000);
    expect(over.givenSen).toBe(2000);
    expect(over.phase).toBe("change"); // not done
    expect(undoDispense(over)).toEqual(s);
  });
  it("dispense and undo are no-ops outside the change phase", () => {
    const s = createSession(basket);
    expect(dispense(s, 100)).toEqual(s);
    expect(undoDispense(s)).toEqual(s);
  });
});
