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
  computeFacings,
  faceSkus,
  type FaceSlot,
} from "./planogram";

// ---------------------------------------------------------------------------
// Named constants.
// ---------------------------------------------------------------------------

/** Tag plate size, metres (fits a two-line label legible at ~2 m). */
const TAG_WIDTH_M = 0.28;
const TAG_HEIGHT_M = 0.095;
/** How proud of the board lip / pack face the tag plane sits (anti z-fight + readability). */
const TAG_PROUD_M = 0.016; // in front of the 12 mm price strip
/** Tag centre below the board top: the tag sits on the shelf's price strip. */
const TAG_CENTER_BELOW_BOARD_M = 0.035;
/** Clearance left between neighbouring tags. */
const TAG_SIDE_GAP_M = 0.01;
/** Shared tag plane geometry — instanced per SKU, scaled down for narrow runs. */
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

const TAG_MATRIX = new THREE.Matrix4();
const TAG_POSITION = new THREE.Vector3();
const TAG_QUATERNION = new THREE.Quaternion();
const TAG_SCALE = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Add the store's rail tags to `scene`: one tag per contiguous run of the
 * same SKU on each face (centred on that run), drawn as one InstancedMesh
 * per SKU that shares a cached texture. A tag narrower than its run is
 * never needed; a run narrower than the tag scales the tag down so
 * neighbours never overlap. Tags are single-sided planes facing outward,
 * so text is never mirrored from behind.
 */
export function buildRailTags(scene: THREE.Scene, slots: readonly FaceSlot[]): void {
  const matricesBySku = new Map<string, THREE.Matrix4[]>();
  for (const slot of slots) {
    const facings = computeFacings(faceSkus(slot), FACE_USABLE_M);
    const direction = slot.side > 0 ? 1 : -1; // front fills +z, back mirrors (as computePlacements)
    const startZ = slot.centerZ - direction * (FACE_USABLE_M / 2);
    TAG_QUATERNION.setFromAxisAngle(UP, slot.side > 0 ? Math.PI / 2 : -Math.PI / 2);
    let cursor = 0;
    for (let i = 0; i < facings.length; ) {
      // Contiguous facings of one SKU share a single tag.
      const skuId = facings[i].skuId;
      const runStart = cursor;
      let runEnd = cursor;
      while (i < facings.length && facings[i].skuId === skuId) {
        runEnd = cursor + facings[i].widthM;
        cursor = runEnd + FACING_GAP_M;
        i += 1;
      }
      const runWidth = runEnd - runStart;
      const size = SKU_PACK_SIZE_M[skuId];
      const packFrontM = size && size[2] > FACE_HALF_M ? size[2] : FACE_HALF_M;
      const scale = Math.min(1, (runWidth - TAG_SIDE_GAP_M) / TAG_WIDTH_M);
      TAG_POSITION.set(
        slot.rowX + slot.side * (packFrontM + TAG_PROUD_M),
        slot.boardY - TAG_CENTER_BELOW_BOARD_M,
        startZ + direction * (runStart + runWidth / 2),
      );
      TAG_SCALE.set(scale, scale, 1);
      TAG_MATRIX.compose(TAG_POSITION, TAG_QUATERNION, TAG_SCALE);
      const list = matricesBySku.get(skuId);
      if (list) list.push(TAG_MATRIX.clone());
      else matricesBySku.set(skuId, [TAG_MATRIX.clone()]);
    }
  }
  for (const [skuId, matrices] of matricesBySku) {
    const material = new THREE.MeshLambertMaterial({ map: buildTagTexture(skuId), side: THREE.FrontSide });
    const mesh = new THREE.InstancedMesh(TAG_GEOMETRY, material, matrices.length);
    mesh.name = `rail-tags:${skuId}`;
    mesh.userData.isRailTag = true; // printed tag, never a hover target (see collectHoverCandidates)
    matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}
