import { PRODUCTS } from "../data/products";
import { formatRinggit } from "../register/money";

/** Maximum distance (in meters) from camera to hovered product for the tooltip to show. */
export const TOOLTIP_MAX_DISTANCE_M = 2.2;

/**
 * Resolve a product id to its tooltip contents.
 * Returns null for unknown/missing ids or null/undefined input.
 */
export function resolveTooltip(
  productId: string | null | undefined,
): { title: string; price: string } | null {
  const p = productId == null ? undefined : PRODUCTS.find((x) => x.id === productId);
  return p ? { title: p.name, price: formatRinggit(p.priceSen) } : null;
}

/** Tag a cloned object with the product id it represents, leaving other userData keys untouched. */
export function tagProduct(
  clone: { userData: Record<string, unknown> },
  productId: string,
): void {
  clone.userData.productId = productId;
}
