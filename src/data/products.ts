/**
 * Starter product catalog. Prices are integer sen, multiples of 5,
 * between 5 and 1500.
 */

export interface Product {
  id: string;
  name: string;
  priceSen: number;
}

export const PRODUCTS: Product[] = [
  { id: "milo-300g", name: "Milo 300g", priceSen: 1490 },
  { id: "maggi-curry", name: "Maggi Curry Noodles", priceSen: 620 },
  { id: "roti-canai-frozen", name: "Frozen Roti Canai (5pk)", priceSen: 995 },
  { id: "nasi-lemak-bungkus", name: "Nasi Lemak Bungkus", priceSen: 450 },
  { id: "tens-egg", name: "Tens Egg Tray", priceSen: 1345 },
  { id: "kuih-bahulu", name: "Kuih Bahulu", priceSen: 880 },
  { id: "susu-fullcream", name: "Full Cream Milk 1L", priceSen: 715 },
  { id: "mee-hoon", name: "Mee Hoon 500g", priceSen: 525 },
  { id: "telur-10pk", name: "Telur Ayam 10pk (Medium)", priceSen: 750 },
  { id: "kopi-3in1", name: "Kopi 3-in-1 Sachets (10pk)", priceSen: 1150 },
  { id: "bicarbonate-250g", name: "Bicarbonate of Soda 250g", priceSen: 250 },
  { id: "soap-bar", name: "Soap Bar", priceSen: 165 },
];
