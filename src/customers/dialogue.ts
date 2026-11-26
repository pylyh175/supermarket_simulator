/**
 * Customer speech-bubble lines — casual Malaysian English / Bahasa mix
 * ("Manglish"), kept short and understandable. Flavor only: nothing here
 * blocks the player. Pure — callers pass the rng.
 */
import type { Rng } from "./generate";

export type Moment =
  | "greet"
  | "bringsBag"
  | "wantsBag"
  | "payCash"
  | "payQr"
  | "payCard"
  | "wrongMethod"
  | "wrongTender"
  | "short"
  | "over"
  | "exact"
  | "thanks"
  | "leave"
  | "excuseMe"
  | "browse"
  | "waiting"
  | "bagForgotten"
  | "noBagThanks"
  | "tooManyBags"
  | "void";

const LINES: Record<Moment, readonly string[]> = {
  greet: ["{greeting}, boss!", "{greeting}!", "Hai, {greeting}.", "{greeting}, adik."],
  bringsBag: ["Tak payah plastik, I bawa beg sendiri.", "No plastic ya, got my own bag.", "Saya ada beg, tak apa."],
  wantsBag: ["Plastik {bags} ya.", "Boleh bagi plastik {bags}?", "Need {bags} plastic bag ah."],
  payCash: ["Nah, {amount}.", "Here, {amount}.", "{amount} ya.", "Ambil ni, {amount}."],
  payQr: ["Saya bayar QR ya.", "Can DuitNow QR ah?", "Scan QR boleh?", "E-wallet okay?"],
  payCard: ["Card boleh?", "I pay by card ya.", "Tap kad, boleh?"],
  wrongMethod: ["Eh, bukan, saya nak bayar {method}.", "No lah, {method} ya.", "Aiyo, I said {method}."],
  wrongTender: ["Eh, saya bagi {amount} je.", "I gave you {amount} only lah.", "Bukan, {amount} tadi."],
  short: ["Eh, kurang {amount} lah.", "Boss, short {amount} ah.", "Change tak cukup — kurang {amount}."],
  over: ["Boss, lebih ni — {amount} pulang balik.", "Eh, extra {amount}, ambil balik.", "Too much lah, {amount} here."],
  exact: ["Ngam ngam, terima kasih!", "Cun, thanks boss!", "Okay, ngam!", "Terima kasih banyak!"],
  thanks: ["Terima kasih!", "Thank you ah!", "Thanks, boss."],
  leave: ["Jumpa lagi!", "Bye bye!", "Jalan dulu ya.", "See you!"],
  excuseMe: ["Tumpang lalu ya.", "Excuse me, boss.", "Sorry, tumpang lalu."],
  browse: [
    "Wah, Milo dah naik harga…",
    "Mana kicap manis ni?",
    "Beras ada stok tak?",
    "Hmm, nak masak apa malam ni…",
    "Eh, sardin promo ke?",
    "Telur gred B okay lah.",
    "Kaya pandan… ambil satu.",
  ],
  waiting: ["…", "*scrolls phone*", "Hmm hmm hmm~", "*checks list*"],
  bagForgotten: ["Eh, plastik tadi belum caj.", "Boss, plastik {bags} ya — belum masuk.", "Plastic bag not yet lah."],
  noBagThanks: ["Eh, tak nak plastik lah.", "No need plastic, I got bag.", "Tak payah, ada beg."],
  tooManyBags: ["Eh, {bags} plastik je cukup lah.", "Just {bags} bag enough, boss.", "{bags} je ya, terlebih tu."],
  void: ["Takpe lah, next time.", "Okay, cancel lah.", "Alamak… takpe."],
};

export interface LineContext {
  rng: Rng;
  greeting?: string;
  amount?: string;
  bags?: number;
  method?: string;
}

export function line(moment: Moment, ctx: LineContext): string {
  const pool = LINES[moment];
  const template = pool[Math.floor(ctx.rng() * pool.length)] ?? pool[0];
  return template
    .replace("{greeting}", ctx.greeting ?? "Hai")
    .replace("{amount}", ctx.amount ?? "")
    .replace("{bags}", String(ctx.bags ?? 1))
    .replace("{method}", ctx.method ?? "cash");
}

/** How a customer says the cash they hand over: "RM20 + 30 sen". */
export function describeTender(pieces: readonly number[]): string {
  let notes = 0;
  let coins = 0;
  for (const p of pieces) {
    if (p >= 100) notes += p;
    else coins += p;
  }
  const parts: string[] = [];
  if (notes > 0) parts.push(`RM${notes / 100}`);
  if (coins > 0) parts.push(`${coins} sen`);
  return parts.join(" + ") || "RM0";
}
