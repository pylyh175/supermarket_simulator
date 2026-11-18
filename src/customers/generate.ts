/**
 * Customer and basket generation.
 * All money is integer sen. Baskets are drawn from the product catalog.
 */

import { PRODUCTS, type Product } from "../data/products";

export interface Customer {
  name: string;
  basket: { id: string; name: string; priceSen: number }[];
  basketTotalSen: number;
  tenderNoteSen: number;
}

const NAMES = [
  "Aisyah",
  "Wei Ming",
  "Ravi",
  "Siti",
  "Daniel",
  "Mei Ling",
  "Farhan",
  "Nurul",
  "Zulkifli",
  "Puvaneswari",
  "Hafiz",
  "Li Yen",
];

const NOTES = [500, 1000, 2000, 5000, 10000];

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function randomBasket(): Product[] {
  const count = 2 + randomInt(4); // 2-5 items
  const basket: Product[] = [];
  for (let i = 0; i < count; i++) {
    basket.push(PRODUCTS[randomInt(PRODUCTS.length)]);
  }
  return basket;
}

function noteFor(totalSen: number): number {
  for (const note of NOTES) {
    if (note >= totalSen + 100) return note;
  }
  return NOTES[NOTES.length - 1];
}

export function makeQueue(n: number): Customer[] {
  const queue: Customer[] = [];
  for (let i = 0; i < n; i++) {
    const basket = randomBasket();
    const basketTotalSen = basket.reduce((a, item) => a + item.priceSen, 0);
    queue.push({
      name: NAMES[i % NAMES.length],
      basket,
      basketTotalSen,
      tenderNoteSen: noteFor(basketTotalSen),
    });
  }
  return queue;
}
