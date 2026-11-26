/**
 * Customer generation: who walks in, what they buy, how they pay.
 * Pure — every function takes an injectable rng so tests are deterministic.
 * All money is integer sen.
 */
import { PRODUCTS, SHOPPING_MISSIONS, productById, type Product } from "../data/products";
import { BAG_PRICE_SEN, type LineItem, type PaymentMethod } from "../register/session";
import { roundToFiveSen } from "../register/rounding";
import { makeChange } from "../register/change";

export type Rng = () => number;

/** Number of distinct customer looks the 3D rig can dress (see customerRig.ts). */
export const LOOK_COUNT = 8;

export interface Customer {
  id: number;
  name: string;
  /** Index into the rig's look table (clothes, headwear, build). */
  look: number;
  basket: LineItem[];
  basketTotalSen: number;
  /** Plastic bags this customer wants; 0 = brought their own bag. */
  bagsWanted: number;
  payment: PaymentMethod;
  /** Cash handed over, as denominations (empty for QR / card). */
  tender: number[];
  tenderSen: number;
  /** What the customer expects to pay: basket + bags, rounded for cash. */
  amountDueSen: number;
}

/**
 * Names per look (customerRig.ts LOOKS order), so a "Mak Cik" never turns up
 * in a songkok and an "Uncle" never in a tudung. A mixed Malay, Chinese,
 * Indian and English-name pool overall.
 */
const NAMES_BY_LOOK: readonly (readonly string[])[] = [
  ["Pak Mat", "Zulkifli", "Hafiz", "Farhan", "Rahim", "Iskandar", "Faizal", "Haji Osman"], // songkok
  ["Mak Cik Rosnah", "Kak Long", "Siti", "Mak Cik Zah", "Kak Ani"], // tudung, baju kurung
  ["Wei Ming", "Daniel", "Jason", "Kok Wai", "Suresh", "Anand", "Chee Keong", "Amir"], // office shirt
  ["Auntie Lim", "Mei Ling", "Li Yen", "Jia Hui", "Auntie Wong"], // hair bun
  ["Adam", "Harith", "Jun Hao", "Arjun", "Danish"], // school uniform
  ["Uncle Tan", "Ah Seng", "Uncle Muthu", "Ganesh", "Ravi", "Uncle Lee"], // cap
  ["Aisyah", "Amirah", "Syafiqah", "Nurul", "Farah"], // tudung, young
  ["Puvaneswari", "Kavitha", "Devi", "Priya", "Michelle", "Xin Yi"], // long hair
];

const NOTES_SEN = [10000, 5000, 2000, 1000, 500, 100];

/** Mulberry32 — tiny deterministic rng for tests and replays. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[randomInt(rng, list.length)];
}

function shuffle<T>(rng: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Mostly one mission, sometimes a stray extra, cheap items occasionally ×2. */
function randomBasket(rng: Rng): Product[] {
  const missions = Object.values(SHOPPING_MISSIONS);
  const mission = pick(rng, missions);
  const distinct = 2 + randomInt(rng, 3); // 2-4 SKUs from the mission
  const chosen = shuffle(rng, [...mission]).slice(0, distinct);
  if (rng() < 0.35) chosen.push(pick(rng, PRODUCTS).id);
  const basket: Product[] = [];
  for (const id of chosen) {
    const product = productById(id);
    if (!product) continue;
    basket.push(product);
    if (product.priceSen < 600 && rng() < 0.25 && basket.length < 7) basket.push(product);
  }
  return basket.slice(0, 7);
}

function greedyNotes(amountSen: number): number[] {
  const out: number[] = [];
  let rest = amountSen;
  for (const note of NOTES_SEN) {
    while (rest >= note) {
      out.push(note);
      rest -= note;
    }
  }
  return out;
}

/** Smallest single note covering the bill; RM100s plus a note above RM100. */
function singleNoteTender(dueSen: number): number[] {
  const hundreds: number[] = [];
  let rest = dueSen;
  while (rest > 10000) {
    hundreds.push(10000);
    rest -= 10000;
  }
  const note = [...NOTES_SEN].reverse().find((n) => n >= rest) ?? 10000;
  return [...hundreds, note];
}

/** Notes up to the next RM10 ("here, RM40"). */
function roundUpNotesTender(dueSen: number): number[] {
  const target = Math.ceil((dueSen + 1) / 1000) * 1000;
  return greedyNotes(target);
}

/** Note(s) plus the sen part in coins so the change is whole ringgit. */
function roundChangeTender(dueSen: number): number[] | null {
  const sen = dueSen % 100;
  if (sen === 0) return null;
  const notes = singleNoteTender(dueSen - sen + 100);
  return [...notes, ...makeChange(sen)];
}

/** Exact money: notes for the ringgit, coins for the sen. */
function exactTender(dueSen: number): number[] {
  return makeChange(dueSen);
}

function cashTender(rng: Rng, dueSen: number): number[] {
  const roll = rng();
  if (roll < 0.45) return singleNoteTender(dueSen);
  if (roll < 0.65) return roundUpNotesTender(dueSen);
  if (roll < 0.85) return roundChangeTender(dueSen) ?? singleNoteTender(dueSen);
  return exactTender(dueSen);
}

function pickPayment(rng: Rng): PaymentMethod {
  const roll = rng();
  if (roll < 0.5) return "cash";
  if (roll < 0.8) return "qr";
  return "card";
}

function pickName(rng: Rng, look: number, previous: string | null): string {
  const pool = NAMES_BY_LOOK[look % NAMES_BY_LOOK.length];
  let name = pick(rng, pool);
  for (let tries = 0; name === previous && tries < 8; tries += 1) name = pick(rng, pool);
  return name;
}

export function makeCustomer(id: number, rng: Rng = Math.random, previousName: string | null = null): Customer {
  const basket: LineItem[] = randomBasket(rng).map((p) => ({ id: p.id, name: p.name, priceSen: p.priceSen }));
  const basketTotalSen = basket.reduce((sum, item) => sum + item.priceSen, 0);
  const bagsWanted = rng() < 0.45 ? 0 : Math.min(3, Math.ceil(basket.length / 4));
  const payment = pickPayment(rng);
  const rawDue = basketTotalSen + bagsWanted * BAG_PRICE_SEN;
  const amountDueSen = payment === "cash" ? roundToFiveSen(rawDue) : rawDue;
  const tender = payment === "cash" ? cashTender(rng, amountDueSen) : [];
  let look = randomInt(rng, LOOK_COUNT);
  let name = pickName(rng, look, previousName);
  if (name === previousName) {
    look = (look + 1) % LOOK_COUNT;
    name = pickName(rng, look, previousName);
  }
  return {
    id,
    name,
    look,
    basket,
    basketTotalSen,
    bagsWanted,
    payment,
    tender,
    tenderSen: tender.reduce((sum, d) => sum + d, 0),
    amountDueSen,
  };
}

export function makeQueue(n: number, rng: Rng = Math.random, firstId = 1): Customer[] {
  const queue: Customer[] = [];
  let previous: string | null = null;
  for (let i = 0; i < n; i += 1) {
    const customer = makeCustomer(firstId + i, rng, previous);
    previous = customer.name;
    queue.push(customer);
  }
  return queue;
}
