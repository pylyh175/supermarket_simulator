/**
 * Pack geometry + colours for every catalog SKU. Pure data (no three.js) so
 * both the asset builder (src/three/assets.ts) and the pure planogram
 * (src/game/planogram.ts) read ONE table instead of mirroring each other.
 *
 * size = [width, height, depth] in metres. Depth must stay ≤ 0.25 m (one
 * half-board) except the deliberate overhang packs (roti canai). Heights stay
 * ≤ 0.30 m so packs clear the board above on the tall shelves.
 */

export type PackShape = "box" | "tin" | "tray" | "bottle" | "jar" | "bag";

export interface PackSpec {
  shape: PackShape;
  size: readonly [number, number, number];
  /** Main pack colour. */
  body: string;
  /** Darker side colour. */
  side: string;
  /** Accent stripe / cap / lid colour. */
  accent: string;
  /** Packs side by side in one shelf facing (derived from width when omitted). */
  unitsWide?: number;
}

export const PACK_SPECS: Record<string, PackSpec> = {
  // Beverages
  "milo-400g": { shape: "tin", size: [0.105, 0.15, 0.105], body: "#1f6f3f", side: "#175733", accent: "#6b3a1e" },
  "kopi-3in1": { shape: "box", size: [0.15, 0.2, 0.065], body: "#7a3b1d", side: "#5c2c15", accent: "#f3e3c8" },
  "teh-tarik-3in1": { shape: "box", size: [0.15, 0.2, 0.065], body: "#d9822b", side: "#b0651c", accent: "#fff1d6" },
  "isotonic-1-5l": { shape: "bottle", size: [0.09, 0.3, 0.09], body: "#e9f3fb", side: "#1f5fae", accent: "#1f5fae" },
  "mineral-1-5l": { shape: "bottle", size: [0.088, 0.3, 0.088], body: "#cfe8f5", side: "#2a8bc9", accent: "#2a8bc9" },
  "sirap-ros-2l": { shape: "bottle", size: [0.1, 0.29, 0.1], body: "#c2185b", side: "#8e1243", accent: "#f8d7e3" },
  "soya-1l": { shape: "box", size: [0.072, 0.21, 0.072], body: "#5c9e3c", side: "#467a2d", accent: "#fff6dc" },

  // Dairy & eggs
  "susu-fullcream": { shape: "box", size: [0.088, 0.23, 0.088], body: "#2050a0", side: "#173c77", accent: "#ffffff" },
  "susu-pekat": { shape: "tin", size: [0.075, 0.1, 0.075], body: "#f4e7c3", side: "#d8c79c", accent: "#1d4f91" },
  "butter-250g": { shape: "box", size: [0.12, 0.05, 0.07], body: "#f6d24a", side: "#d8b22c", accent: "#b33a2a", unitsWide: 5 },
  "telur-10pk": { shape: "box", size: [0.27, 0.11, 0.2], body: "#b98a52", side: "#8f683a", accent: "#7a5230", unitsWide: 3 },
  "telur-30-tray": { shape: "tray", size: [0.29, 0.085, 0.24], body: "#8a6b45", side: "#6b5233", accent: "#f2e6cf", unitsWide: 3 },

  // Staples
  "beras-5kg": { shape: "bag", size: [0.3, 0.1, 0.22], body: "#f4efe2", side: "#d7cfba", accent: "#2e7d32", unitsWide: 3 },
  "minyak-2kg": { shape: "bottle", size: [0.11, 0.29, 0.11], body: "#f2c230", side: "#c99a1d", accent: "#2e7d32" },
  "gula-1kg": { shape: "bag", size: [0.13, 0.2, 0.07], body: "#fafafa", side: "#dcdcdc", accent: "#1e63b4" },
  "tepung-1kg": { shape: "bag", size: [0.13, 0.2, 0.07], body: "#f7efe0", side: "#dccfb5", accent: "#c62828" },
  "garam-500g": { shape: "bag", size: [0.11, 0.16, 0.05], body: "#e3f2fd", side: "#bcd7ec", accent: "#1565c0" },
  "mee-hoon": { shape: "bag", size: [0.28, 0.05, 0.2], body: "#f2c230", side: "#c99a1d", accent: "#b45309", unitsWide: 3 },
  "maggi-curry": { shape: "box", size: [0.16, 0.21, 0.085], body: "#d42a1e", side: "#b02015", accent: "#ffd21e", unitsWide: 4 },
  "mi-ayam-5pk": { shape: "box", size: [0.16, 0.21, 0.085], body: "#f4b400", side: "#c99000", accent: "#c62828", unitsWide: 4 },
  "roti-putih": { shape: "bag", size: [0.24, 0.12, 0.12], body: "#fff6e0", side: "#e8d8b0", accent: "#c62828", unitsWide: 3 },

  // Condiments & dry goods
  "kicap-manis": { shape: "bottle", size: [0.075, 0.25, 0.075], body: "#2b1a12", side: "#1a0f0a", accent: "#e8b45a" },
  "sos-cili": { shape: "bottle", size: [0.075, 0.22, 0.075], body: "#d32f2f", side: "#9a2020", accent: "#ffe082" },
  "sambal-bilis": { shape: "jar", size: [0.085, 0.1, 0.085], body: "#b23a1f", side: "#8a2c17", accent: "#f2c230" },
  "belacan-250g": { shape: "box", size: [0.12, 0.05, 0.08], body: "#6d4c41", side: "#4e342e", accent: "#ffcc80", unitsWide: 5 },
  "ikan-bilis-200g": { shape: "bag", size: [0.15, 0.04, 0.2], body: "#dfe7ea", side: "#b8c4c9", accent: "#0277bd", unitsWide: 4 },
  "kaya-pandan": { shape: "jar", size: [0.085, 0.11, 0.085], body: "#7cb342", side: "#5a8a2c", accent: "#f9e79f" },

  // Snacks, canned & ready food
  "sardin-425g": { shape: "tin", size: [0.1, 0.11, 0.1], body: "#c62828", side: "#9a1f1f", accent: "#ffd54f" },
  "cream-crackers": { shape: "box", size: [0.21, 0.065, 0.11], body: "#f6e3b4", side: "#d9c08a", accent: "#c62828", unitsWide: 3 },
  "keropok-ikan": { shape: "bag", size: [0.17, 0.22, 0.06], body: "#ff8f00", side: "#cc7000", accent: "#004d40", unitsWide: 3 },
  "kuih-bahulu": { shape: "box", size: [0.15, 0.1, 0.15], body: "#e08bb0", side: "#b8618a", accent: "#a83d63", unitsWide: 5 },
  "nasi-lemak-bungkus": { shape: "box", size: [0.14, 0.125, 0.14], body: "#2e7d32", side: "#215c25", accent: "#f5e9c8", unitsWide: 5 },
  "roti-canai-frozen": { shape: "box", size: [0.2, 0.055, 0.28], body: "#e8762d", side: "#c2571d", accent: "#1d4f91", unitsWide: 4 },

  // Household & toiletries
  "soap-bar": { shape: "box", size: [0.095, 0.045, 0.07], body: "#1f8f8a", side: "#146a66", accent: "#bfe8e4", unitsWide: 6 },
  "detergent-1-8kg": { shape: "box", size: [0.22, 0.28, 0.09], body: "#1565c0", side: "#0d47a1", accent: "#ffeb3b", unitsWide: 2 },
  "tisu-tandas-10": { shape: "bag", size: [0.22, 0.22, 0.22], body: "#fdfdfd", side: "#e4e4e4", accent: "#ec407a", unitsWide: 2 },
  "ubat-gigi": { shape: "box", size: [0.19, 0.05, 0.045], body: "#e53935", side: "#b71c1c", accent: "#ffffff", unitsWide: 3 },
  "pencuci-pinggan": { shape: "bottle", size: [0.08, 0.24, 0.08], body: "#43a047", side: "#2e7d32", accent: "#c8e6c9" },
  "bicarbonate-250g": { shape: "box", size: [0.085, 0.125, 0.05], body: "#e8f0f2", side: "#c3cfd3", accent: "#2f6f9f", unitsWide: 6 },
};

export const FALLBACK_PACK_SPEC: PackSpec = {
  shape: "box",
  size: [0.16, 0.2, 0.09],
  body: "#7a5a36",
  side: "#5b4225",
  accent: "#caa46a",
};

/** Packs per shelf facing: explicit, else ~0.55 m of frontage, clamped 2–7. */
export function unitsWideFor(spec: PackSpec): number {
  if (spec.unitsWide !== undefined) return spec.unitsWide;
  return Math.max(2, Math.min(7, Math.round(0.55 / spec.size[0])));
}
