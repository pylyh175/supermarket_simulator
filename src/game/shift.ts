/**
 * Shift / day cycle — pure. The store trades 9:00 am → 10:00 pm, compressed
 * into a real-time length the player picks in settings (12 min by default).
 * Customer flow follows a gentle Malaysian day: quiet morning, lunch rush,
 * calm afternoon, after-work rush, quiet night. All money is integer sen.
 */
import type { PaymentMethod } from "../register/session";

export const SHIFT_OPEN_MIN = 9 * 60;
export const SHIFT_CLOSE_MIN = 22 * 60;
const SHIFT_SPAN_MIN = SHIFT_CLOSE_MIN - SHIFT_OPEN_MIN;

/** Advance in-game minutes by a real-time delta (clamped at closing). */
export function advanceClock(minutes: number, dtS: number, shiftRealSeconds: number): number {
  const rate = SHIFT_SPAN_MIN / Math.max(1, shiftRealSeconds);
  return Math.min(SHIFT_CLOSE_MIN, minutes + dtS * rate);
}

export function formatClock(minutes: number): string {
  const total = Math.floor(minutes);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

export function greetingFor(minutes: number): string {
  if (minutes < 12 * 60) return "Selamat pagi";
  if (minutes < 14 * 60) return "Selamat tengah hari";
  if (minutes < 19 * 60) return "Selamat petang";
  return "Selamat malam";
}

/** Real seconds between new customers walking in, by time of day. */
export function spawnIntervalS(minutes: number): number {
  const h = minutes / 60;
  if (h < 10) return 34; // opening, quiet
  if (h >= 12 && h < 14) return 15; // lunch rush
  if (h >= 17.5 && h < 19.5) return 14; // after-work rush
  if (h >= 21) return 40; // winding down
  return 24;
}

export function isAfterClosing(minutes: number): boolean {
  return minutes >= SHIFT_CLOSE_MIN;
}

// ---------------------------------------------------------------------------
// End-of-shift tally
// ---------------------------------------------------------------------------

export interface SaleRecord {
  method: PaymentMethod;
  totalSen: number;
  bags: number;
  roundingSen: number;
  /** Cash with change: right first time? null when no change was given. */
  changeFirstTry: boolean | null;
}

export interface ShiftStats {
  customers: number;
  salesSen: number;
  byMethod: Record<PaymentMethod, { count: number; sen: number }>;
  bagsSold: number;
  roundingSen: number;
  /** Sales where change was counted out. */
  changeGiven: number;
  /** …and how many were right on the first hand-over. */
  changeFirstTry: number;
}

export function emptyStats(): ShiftStats {
  return {
    customers: 0,
    salesSen: 0,
    byMethod: { cash: { count: 0, sen: 0 }, qr: { count: 0, sen: 0 }, card: { count: 0, sen: 0 } },
    bagsSold: 0,
    roundingSen: 0,
    changeGiven: 0,
    changeFirstTry: 0,
  };
}

export function recordSale(stats: ShiftStats, sale: SaleRecord): ShiftStats {
  const method = stats.byMethod[sale.method];
  return {
    customers: stats.customers + 1,
    salesSen: stats.salesSen + sale.totalSen,
    byMethod: { ...stats.byMethod, [sale.method]: { count: method.count + 1, sen: method.sen + sale.totalSen } },
    bagsSold: stats.bagsSold + sale.bags,
    roundingSen: stats.roundingSen + sale.roundingSen,
    changeGiven: stats.changeGiven + (sale.changeFirstTry === null ? 0 : 1),
    changeFirstTry: stats.changeFirstTry + (sale.changeFirstTry === true ? 1 : 0),
  };
}
