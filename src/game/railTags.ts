/**
 * Rail price tags — one small canvas-texture plane per planogram facing,
 * mounted on the board's front lip so customers read the price where the
 * stock stands. Pure presentation: no game state, no interaction, no
 * per-frame work.
 *
 * Conventions (shared with src/three/storeLayout.ts):
 *   - Aisle rows run along Z; board faces look along ±X. `side` is the x
 *     sign of the face normal (1 = +x east face, rotationY = +π/2).
 *   - The face fills from `startZ = cell.centerZ − direction × FACE_USABLE_M / 2`
 *     towards `centerZ`'s far edge with `direction = 1` for the front face
 *     and `−1` for the back face (mirrored so both aisles read the same) —
 *     identical to `computePlacements`, so a tag always sits centred on its
 *     facing region along z.
 *   - The along-face coordinate is z and the board lip is at constant x —
 *     the planning docs phrase this as "x via face span … z flush with the
 *     board lip", but the axis names there are swapped relative to the
 *     store's actual orientation; this module follows the geometry.
 *
 * Tags are flush with the lip (a few mm proud so a zero-thickness plane
 * never z-fights the board's face) and hang at board-surface + 0.05 m.
 * Facings whose packs overhang the lip (roti-canai-frozen 0.28 m,
 * tens-egg 0.265 m — the only packs deeper than a half-board) get their
 * tag stepped outward just past the pack face instead of being swallowed;
 * every other facing keeps the straight rail line at the lip.
 *
 * Tags persist on the board for the whole session — no cleanup path, like
 * the stocked packs themselves.
 */
import * as THREE from "three";
import { PRODUCTS } from "../data/products";
import { formatRinggit } from "../register/money";
import {
  FACE_HALF_M,
  FACE_USABLE_M,
  FACING_GAP_M,
  SKU_PACK_SIZE_M,
  type Facing,
  type PlacementCell,
} from "./planogram";

// ---------------------------------------------------------------------------
// Named constants.
// ---------------------------------------------------------------------------

/** Tag plate size, metres (fits a two-line label legible at ~2 m). */
const TAG_WIDTH_M = 0.28;
const TAG_HEIGHT_M = 0.095;
/**
 * Tag centre above the board surface: half the tag height (0.048 m) plus a
 * hair so the bottom edge clears the board top — the brief's 0.05 m.
 */
const TAG_CENTER_ABOVE_BOARD_M = 0.05;
/** How proud of the board lip / pack face the tag plane sits (anti z-fight + readability). */
const TAG_PROUD_M = 0.008;
/** Shared tag plane geometry — one per facing, identical size. */
const TAG_GEOMETRY = new THREE.PlaneGeometry(TAG_WIDTH_M, TAG_HEIGHT_M);

/** Canvas resolution; 256×96 keeps the text sharp at glancing angles. */
const TAG_CANVAS_W = 256;
const TAG_CANVAS_H = 96;

/** KEDAI rail-label palette (mirrors the sign vocabulary in assets.ts). */
const TAG_BG = "#f3e5c2";   // cream
const TAG_INK = "#46301f";  // dark warm brown
const TAG_BORDER_W = 6;
const TAG_HAIRLINE_W = 2;
const TAG_BORDER_INSET = 4;
const TAG_HAIRLINE_INSET = 12;

const FONT_NAME = "Arial, 'Segoe UI', sans-serif";
const FONT_PRICE = "'Arial Black', Arial, 'Segoe UI', sans-serif";
const MIN_TEXT_SIZE_PX = 10;
/** Small-caps tier ratio: non-initial letters render at 78 % of the full cap size. */
const SMALL_CAP_RATIO = 0.78;
const SMALL_CAP_TRACKING_PX = 1.2;

// ---------------------------------------------------------------------------
// Catalog lookup — id → product, built once at module load.
// ---------------------------------------------------------------------------

const PRODUCT_BY_ID: ReadonlyMap<string, { name: string; priceSen: number }> = new Map(
  PRODUCTS.map((p) => [p.id, { name: p.name, priceSen: p.priceSen }]),
);

// ---------------------------------------------------------------------------
// Minimal canvas helpers — assets.ts keeps its copies module-private, so this
// module carries local equivalents (no new cross-module surface, no import
// cycles). System fonts only.
// ---------------------------------------------------------------------------

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return [canvas, ctx];
}

/** Shrink `text` until it fits `maxWidth` at the current font. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baselineY: number,
  maxWidth: number,
  baseSize: number,
  font: string,
  color: string,
): void {
  let size = baseSize;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  do {
    ctx.font = `${size}px ${font}`;
    if (ctx.measureText(text).width <= maxWidth || size <= MIN_TEXT_SIZE_PX) break;
    size -= 2;
  } while (size > MIN_TEXT_SIZE_PX);
  ctx.fillText(text, centerX, baselineY);
}

/** A letter starts a word (full cap) when it follows a word separator. */
function isWordInitial(upper: string, index: number): boolean {
  if (index === 0) return true;
  const prev = upper[index - 1];
  return prev === " " || prev === "-" || prev === "(" || prev === "/";
}

/**
 * Draw `text` as true small caps — word-initial letters at `baseSize`, the
 * rest at SMALL_CAP_RATIO — tracking applied, auto-shrunk to `maxWidth`.
 */
function drawSmallCaps(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baselineY: number,
  maxWidth: number,
  baseSize: number,
  color: string,
): void {
  const upper = text.toUpperCase();
  const sizeAt = (index: number, scale: number): number =>
    Math.max(
      MIN_TEXT_SIZE_PX,
      Math.round((isWordInitial(upper, index) ? baseSize : baseSize * SMALL_CAP_RATIO) * scale),
    );
  const widthAt = (scale: number): number => {
    let total = 0;
    for (let i = 0; i < upper.length; i += 1) {
      ctx.font = `700 ${sizeAt(i, scale)}px ${FONT_NAME}`;
      total += ctx.measureText(upper[i]).width + SMALL_CAP_TRACKING_PX;
    }
    return total - SMALL_CAP_TRACKING_PX;
  };

  let scale = 1;
  while (widthAt(scale) > maxWidth && Math.round(baseSize * scale) > MIN_TEXT_SIZE_PX) {
    scale -= 0.05;
  }

  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let cursor = centerX - widthAt(scale) / 2;
  for (let i = 0; i < upper.length; i += 1) {
    ctx.font = `700 ${sizeAt(i, scale)}px ${FONT_NAME}`;
    ctx.fillText(upper[i], cursor, baselineY);
    cursor += ctx.measureText(upper[i]).width + SMALL_CAP_TRACKING_PX;
  }
}

// ---------------------------------------------------------------------------
// Tag texture — NAME small-caps on top, bold RM… below; cream + thin border.
// ---------------------------------------------------------------------------

function buildTagTexture(skuId: string): THREE.CanvasTexture {
  const product = PRODUCT_BY_ID.get(skuId);
  if (!product) {
    console.warn(`[railTags] No catalog entry for SKU "${skuId}" — tag shows the raw id and no price.`);
  }
  const name = product?.name ?? skuId; // small-caps rendering upper-cases it
  const price = product ? formatRinggit(product.priceSen) : "";

  const [canvas, ctx] = makeCanvas(TAG_CANVAS_W, TAG_CANVAS_H);
  ctx.fillStyle = TAG_BG;
  ctx.fillRect(0, 0, TAG_CANVAS_W, TAG_CANVAS_H);
  // Thin outer border + inner hairline — the KEDAI sign's double-frame, minimal.
  ctx.strokeStyle = TAG_INK;
  ctx.lineWidth = TAG_BORDER_W;
  ctx.strokeRect(TAG_BORDER_INSET, TAG_BORDER_INSET, TAG_CANVAS_W - TAG_BORDER_INSET * 2, TAG_CANVAS_H - TAG_BORDER_INSET * 2);
  ctx.lineWidth = TAG_HAIRLINE_W;
  ctx.strokeRect(TAG_HAIRLINE_INSET, TAG_HAIRLINE_INSET, TAG_CANVAS_W - TAG_HAIRLINE_INSET * 2, TAG_CANVAS_H - TAG_HAIRLINE_INSET * 2);

  const textWidth = TAG_CANVAS_W - TAG_HAIRLINE_INSET * 2 - 8;
  drawSmallCaps(ctx, name, TAG_CANVAS_W / 2, 42, textWidth, 23, TAG_INK);
  if (price) {
    drawFitted(ctx, price, TAG_CANVAS_W / 2, 76, textWidth, 30, FONT_PRICE, TAG_INK);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Add one rail tag per facing to `scene`, grouped per board-face. `face`
 * mirrors the fill direction used by `computePlacements`; `side` is the x
 * sign of the face normal. Tags are single-sided planes whose normal faces
 * outward, so text is never mirrored from behind.
 */
export function buildRailTags(
  scene: THREE.Scene,
  facings: Facing[],
  face: "front" | "back",
  cell: PlacementCell,
  side: 1 | -1,
): void {
  if (facings.length === 0) return;

  const direction = face === "front" ? 1 : -1;
  const startZ = cell.centerZ - direction * (FACE_USABLE_M / 2);
  const rotationY = side > 0 ? Math.PI / 2 : -Math.PI / 2;

  const group = new THREE.Group();
  group.name = `rail-tags:${face}:side${side}:rowX${cell.rowX.toFixed(2)}:boardY${cell.boardY.toFixed(3)}`;

  let cursor = 0; // mirrors the fill cursor in computePlacements
  for (const facing of facings) {
    const facingCenterZ = startZ + direction * (cursor + facing.widthM / 2);
    cursor += facing.widthM + FACING_GAP_M;

    // Overhang packs (the only SKUs deeper than a half-board) stick past the
    // lip; step their tag out just past the pack face so it is never swallowed.
    const size = SKU_PACK_SIZE_M[facing.skuId];
    const packFrontM = size && size[2] > FACE_HALF_M ? size[2] : FACE_HALF_M;
    const x = cell.rowX + side * (packFrontM + TAG_PROUD_M);

    const texture = buildTagTexture(facing.skuId);
    const material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.FrontSide });
    const plane = new THREE.Mesh(TAG_GEOMETRY, material);
    plane.name = `rail-tag:${facing.skuId}`;
    plane.userData.isRailTag = true; // 5 cm-thick print, never a hover target — excluded from raycasts (see collectHoverCandidates)
    plane.position.set(x, cell.boardY + TAG_CENTER_ABOVE_BOARD_M, facingCenterZ);
    plane.rotation.y = rotationY;
    group.add(plane);
  }

  scene.add(group);
}
