/**
 * Product catalog — everyday Malaysian supermarket staples with realistic
 * 2026 shelf prices. Prices are integer sen and may end in any sen digit
 * (RM4.79, RM13.29…); cash totals are rounded to the nearest 5 sen at the
 * till (see src/register/rounding.ts), exactly like a Malaysian POS.
 *
 * Pack geometry / colours for each id live in src/data/packSpecs.ts.
 */

export type Category =
  | "beverages"
  | "dairy"
  | "staples"
  | "condiments"
  | "snacks"
  | "household";

export interface Product {
  id: string;
  name: string;
  priceSen: number;
  category: Category;
}

export const PRODUCTS: Product[] = [
  // Beverages
  { id: "milo-400g", name: "Milo Tin 400g", priceSen: 1449, category: "beverages" },
  { id: "kopi-3in1", name: "Kopi 3-in-1 (15 sachets)", priceSen: 1179, category: "beverages" },
  { id: "teh-tarik-3in1", name: "Teh Tarik 3-in-1 (12 sachets)", priceSen: 1099, category: "beverages" },
  { id: "isotonic-1-5l", name: "100Plus Isotonic 1.5L", priceSen: 449, category: "beverages" },
  { id: "mineral-1-5l", name: "Air Mineral 1.5L", priceSen: 189, category: "beverages" },
  { id: "sirap-ros-2l", name: "Sirap Ros 2L", priceSen: 799, category: "beverages" },
  { id: "soya-1l", name: "Minuman Soya 1L", priceSen: 425, category: "beverages" },

  // Dairy & eggs
  { id: "susu-fullcream", name: "Susu Segar Full Cream 1L", priceSen: 789, category: "dairy" },
  { id: "susu-pekat", name: "Susu Pekat Manis 500g", priceSen: 389, category: "dairy" },
  { id: "butter-250g", name: "Butter 250g", priceSen: 1099, category: "dairy" },
  { id: "telur-10pk", name: "Telur Ayam Gred B (10 biji)", priceSen: 529, category: "dairy" },
  { id: "telur-30-tray", name: "Telur Ayam Gred B (30 biji)", priceSen: 1489, category: "dairy" },

  // Staples
  { id: "beras-5kg", name: "Beras Super Tempatan 5kg", priceSen: 2600, category: "staples" },
  { id: "minyak-2kg", name: "Minyak Masak 2kg", priceSen: 1449, category: "staples" },
  { id: "gula-1kg", name: "Gula Pasir 1kg", priceSen: 285, category: "staples" },
  { id: "tepung-1kg", name: "Tepung Gandum 1kg", priceSen: 329, category: "staples" },
  { id: "garam-500g", name: "Garam Halus 500g", priceSen: 139, category: "staples" },
  { id: "mee-hoon", name: "Mee Hoon 400g", priceSen: 379, category: "staples" },
  { id: "maggi-curry", name: "Maggi Kari (5 paket)", priceSen: 699, category: "staples" },
  { id: "mi-ayam-5pk", name: "Mi Segera Ayam (5 paket)", priceSen: 549, category: "staples" },
  { id: "roti-putih", name: "Roti Putih 600g", priceSen: 440, category: "staples" },

  // Condiments & dry goods
  { id: "kicap-manis", name: "Kicap Manis 620ml", priceSen: 579, category: "condiments" },
  { id: "sos-cili", name: "Sos Cili 485g", priceSen: 499, category: "condiments" },
  { id: "sambal-bilis", name: "Sambal Ikan Bilis 200g", priceSen: 899, category: "condiments" },
  { id: "belacan-250g", name: "Belacan Blok 250g", priceSen: 650, category: "condiments" },
  { id: "ikan-bilis-200g", name: "Ikan Bilis Kering 200g", priceSen: 1290, category: "condiments" },
  { id: "kaya-pandan", name: "Kaya Pandan 400g", priceSen: 659, category: "condiments" },

  // Snacks, canned & ready food
  { id: "sardin-425g", name: "Sardin Tin 425g", priceSen: 799, category: "snacks" },
  { id: "cream-crackers", name: "Biskut Krim Krakers 428g", priceSen: 669, category: "snacks" },
  { id: "keropok-ikan", name: "Keropok Ikan 200g", priceSen: 450, category: "snacks" },
  { id: "kuih-bahulu", name: "Kuih Bahulu (12 biji)", priceSen: 880, category: "snacks" },
  { id: "nasi-lemak-bungkus", name: "Nasi Lemak Bungkus", priceSen: 350, category: "snacks" },
  { id: "roti-canai-frozen", name: "Roti Canai Sejuk Beku (5 keping)", priceSen: 899, category: "snacks" },

  // Household & toiletries
  { id: "soap-bar", name: "Sabun Mandi 115g", priceSen: 249, category: "household" },
  { id: "detergent-1-8kg", name: "Serbuk Pencuci 1.8kg", priceSen: 1899, category: "household" },
  { id: "tisu-tandas-10", name: "Tisu Tandas (10 gulung)", priceSen: 1590, category: "household" },
  { id: "ubat-gigi", name: "Ubat Gigi 175g", priceSen: 849, category: "household" },
  { id: "pencuci-pinggan", name: "Pencuci Pinggan 900ml", priceSen: 529, category: "household" },
  { id: "bicarbonate-250g", name: "Soda Bikarbonat 250g", priceSen: 259, category: "household" },
];

const PRODUCT_INDEX: ReadonlyMap<string, Product> = new Map(PRODUCTS.map((p) => [p.id, p]));

/** Catalog lookup by id (undefined for unknown ids). */
export function productById(id: string): Product | undefined {
  return PRODUCT_INDEX.get(id);
}

/**
 * Shopping "missions" — the reason a customer walked in. Baskets are drawn
 * mostly from one mission so they read like real trips (no one buys five
 * soap bars and a tray of eggs at random).
 */
export const SHOPPING_MISSIONS: Record<string, readonly string[]> = {
  breakfast: [
    "roti-putih", "kaya-pandan", "butter-250g", "milo-400g", "kopi-3in1",
    "teh-tarik-3in1", "susu-fullcream", "telur-10pk", "nasi-lemak-bungkus", "kuih-bahulu",
  ],
  cooking: [
    "beras-5kg", "minyak-2kg", "gula-1kg", "tepung-1kg", "garam-500g", "kicap-manis",
    "sos-cili", "belacan-250g", "ikan-bilis-200g", "telur-30-tray", "sambal-bilis",
  ],
  quickMeal: [
    "maggi-curry", "mi-ayam-5pk", "mee-hoon", "sardin-425g", "roti-canai-frozen",
    "nasi-lemak-bungkus", "sos-cili", "telur-10pk",
  ],
  snacksAndDrinks: [
    "isotonic-1-5l", "mineral-1-5l", "sirap-ros-2l", "soya-1l", "keropok-ikan",
    "cream-crackers", "kuih-bahulu", "susu-pekat",
  ],
  household: [
    "soap-bar", "detergent-1-8kg", "tisu-tandas-10", "ubat-gigi", "pencuci-pinggan",
    "bicarbonate-250g",
  ],
};
