type Phase = "scanning" | "paying" | "change" | "done";

interface Session {
  readonly items: { id: string; name: string; priceSen: number }[];
  readonly scanned: number; // items scanned so far
  readonly totalSen: number; // sum of scanned items
  readonly tenderedSen: number | null;
  readonly changeDueSen: number; // 0 until payment
  readonly given: number[]; // denominations dispensed, in tap order
  readonly givenSen: number; // sum of given
  readonly phase: Phase;
}

function createSession(items: Session["items"]): Session {
  return {
    items,
    scanned: 0,
    totalSen: 0,
    tenderedSen: null,
    changeDueSen: 0,
    given: [],
    givenSen: 0,
    phase: "scanning",
  };
}

function scanNext(s: Session): Session {
  if (s.phase !== "scanning" || s.scanned >= s.items.length) return s;
  const scanned = s.scanned + 1;
  const totalSen = s.totalSen + s.items[s.scanned].priceSen;
  return {
    ...s,
    scanned,
    totalSen,
    phase: scanned === s.items.length ? "paying" : "scanning",
  };
}

function receivePayment(s: Session, noteSen: number): Session {
  if (s.phase !== "paying" || noteSen < s.totalSen) return s;
  return {
    ...s,
    tenderedSen: noteSen,
    changeDueSen: noteSen - s.totalSen,
    phase: noteSen === s.totalSen ? "done" : "change",
  };
}

function dispense(s: Session, denomSen: number): Session {
  if (s.phase !== "change") return s;
  const given = [...s.given, denomSen];
  const givenSen = s.givenSen + denomSen;
  return {
    ...s,
    given,
    givenSen,
    phase: givenSen === s.changeDueSen ? "done" : "change",
  };
}

function undoDispense(s: Session): Session {
  if (s.phase !== "change" || s.given.length === 0) return s;
  const last = s.given[s.given.length - 1];
  return {
    ...s,
    given: s.given.slice(0, -1),
    givenSen: s.givenSen - last,
  };
}

export { createSession, scanNext, receivePayment, dispense, undoDispense };
export type { Phase, Session };
