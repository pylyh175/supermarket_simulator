// Asset pipeline for the cozy Malaysian supermarket.
//
// Strategy (Task 4 of the Phase 1 plan):
//   1. Products are ALWAYS procedural — Malaysian packaging colors +
//      CanvasTexture labels (Milo tin, Maggi, Roti, Nasi Lemak, …). No
//      third-party asset ships a Milo tin, so labels are generated here.
//   2. Shelves and the counter prefer self-contained Kenney glTFs (CC0,
//      shipped in public/assets/furniture-kit/) and fall back to
//      procedural primitives per-asset when the file is missing or fails
//      to load. The game therefore boots with zero downloads as well.
//   3. Signage (store sign / Grab pick-up) is procedural; customers are
//      built by src/game/customerRig.ts.
//
// Everything is built locally — no runtime network requests to external
// hosts. loadAssets() never throws; on any failure it resolves with the
// procedural set instead.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PRODUCTS } from "../data/products";
import { FALLBACK_PACK_SPEC, PACK_SPECS, type PackSpec } from "../data/packSpecs";

export interface AssetBundle {
  products: Map<string, THREE.Group>;
  counter: THREE.Group;
  signage: { kedaiSign: THREE.Mesh; grabSign: THREE.Mesh };
}

/** Stage reporter for the loading overlay (label + 0..1 progress). */
export type AssetStageCallback = (label: string, progress: number) => void;

// ---------------------------------------------------------------------------
// glTF manifest — the only third-party files we ship. CC0, Kenney.nl.
// ---------------------------------------------------------------------------
const GLTF_MANIFEST = {
  counter: { url: "/assets/furniture-kit/kitchenBar.glb", targetHeightM: 0.95 },
} as const;

const GLTF_TIMEOUT_MS = 6000;

// Shared warm wood / cream palette (matches storeShell + plan constants).
const COUNTER_CREAM = "#e8e2d6";
const COUNTER_TOP = "#7a5a36";
const GRAB_GREEN = "#00aa5b";
const SIGN_WOOD_BG = "#46301f";
const SIGN_CREAM = "#f3e5c2";

// ---------------------------------------------------------------------------
// Canvas texture helpers (system fonts only — no external font files).
// ---------------------------------------------------------------------------
const FONT_STACK = "'Arial Black', Arial, 'Segoe UI', sans-serif";
const FONT_BODY = "Arial, 'Segoe UI', sans-serif";

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
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
    if (ctx.measureText(text).width <= maxWidth || size <= 10) break;
    size -= 4;
  } while (size > 10);
  ctx.fillText(text, centerX, baselineY);
}

/** Draw letterspaced text, auto-shrinking to fit `maxWidth`. */
function drawSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baselineY: number,
  maxWidth: number,
  baseSize: number,
  tracking: number,
  font: string,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const widthAt = (size: number): number => {
    ctx.font = `${size}px ${font}`;
    let total = 0;
    for (const ch of text) total += ctx.measureText(ch).width + tracking;
    return total - tracking;
  };
  let size = baseSize;
  while (widthAt(size) > maxWidth && size > 10) size -= 2;
  ctx.font = `${size}px ${font}`;
  let cursor = centerX - widthAt(size) / 2;
  for (const ch of text) {
    ctx.fillText(ch, cursor, baselineY);
    cursor += ctx.measureText(ch).width + tracking;
  }
}

/** Deterministic pseudo-barcode — same product id, same pattern. */
function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Pick a readable text color (dark or cream) for a #rrggbb background. */
function contrastOn(hex: string): string {
  const value = hex.replace("#", "");
  const channel = (i: number): number => {
    const c = parseInt(value.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.35 ? "#241a10" : "#fdf6e9";
}

function drawBarcode(
  ctx: CanvasRenderingContext2D,
  seed: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  let state = hashString(seed) || 1;
  const next = (): number => {
    state = Math.imul(state ^ (state >>> 13), 0x5bd1e995);
    state ^= state >>> 15;
    return (state >>> 0) / 4294967296;
  };
  ctx.fillStyle = color;
  let cursor = x;
  while (cursor < x + width) {
    const barWidth = 2 + Math.floor(next() * 5);
    if (next() > 0.42) {
      ctx.fillRect(cursor, y, barWidth, height);
    }
    cursor += barWidth + 2 + Math.floor(next() * 3);
  }
}

// ---------------------------------------------------------------------------
// Product packs — geometry + colours come from the shared pure table in
// src/data/packSpecs.ts (also read by the planogram).
// ---------------------------------------------------------------------------

/**
 * Render a product label onto a canvas. Pack colors + accent pinstripe +
 * faux barcode only — every word of brand/variant/detail text has been
 * stripped (names are shown via the 3D hover tooltip instead).
 */
function makeProductLabel(spec: PackSpec, seed: string): THREE.CanvasTexture {
  const width = 256;
  const height = 256;
  const [canvas, ctx] = makeCanvas(width, height);

  ctx.fillStyle = spec.body;
  ctx.fillRect(0, 0, width, height);

  // Top accent pinstripe.
  ctx.fillStyle = spec.accent;
  ctx.fillRect(0, 0, width, 14);

  // Bottom band: faux barcode only. Barcode colour is picked from the
  // accent's luminance so it stays readable on every pack.
  ctx.fillStyle = spec.accent;
  ctx.fillRect(0, height - 54, width, 54);
  const bandFg = contrastOn(spec.accent);
  ctx.save();
  ctx.beginPath();
  ctx.rect(width - 104, height - 48, 92, 40);
  ctx.clip();
  drawBarcode(ctx, seed, width - 96, height - 46, 72, 34, bandFg);
  ctx.restore();

  return toTexture(canvas);
}

/**
 * Wrap-around label for round packs (bottles, jars). Canvas y maps to pack
 * height (top of canvas = top of pack): cap band, shoulder, label panel with
 * accent stripes + barcode, base.
 */
function makeRoundLabel(spec: PackSpec, seed: string, capFrom: number, labelTo: number, labelFrom: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const y = (t: number): number => (1 - t) * size;
  ctx.fillStyle = spec.body;
  ctx.fillRect(0, 0, size, size);
  // Cap / lid.
  ctx.fillStyle = spec.side;
  ctx.fillRect(0, 0, size, y(capFrom));
  // Label panel.
  const top = y(labelTo);
  const bottom = y(labelFrom);
  ctx.fillStyle = spec.accent;
  ctx.fillRect(0, top, size, bottom - top);
  ctx.fillStyle = spec.side;
  ctx.fillRect(0, top + 6, size, 8);
  ctx.fillRect(0, bottom - 14, size, 8);
  ctx.save();
  ctx.beginPath();
  ctx.rect(size - 80, bottom - 52, 64, 34);
  ctx.clip();
  drawBarcode(ctx, seed, size - 76, bottom - 50, 56, 30, contrastOn(spec.accent));
  ctx.restore();
  return toTexture(canvas);
}

/** Lathe profile sampled evenly in height so the texture's v = height fraction. */
function latheProfile(radius: number, height: number, radiusAt: (t: number) => number): THREE.Vector2[] {
  const samples = 10; // ~24k packs on the shelves: keep bottles low-poly (144 tris)
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    points.push(new THREE.Vector2(Math.max(0.0005, radiusAt(t) * radius), t * height));
  }
  return points;
}

function bottleRadius(t: number): number {
  if (t < 0.03) return 0.2 + 0.8 * (t / 0.03);
  if (t < 0.62) return 1;
  if (t < 0.82) {
    const u = (t - 0.62) / 0.2;
    return 1 - 0.64 * (u * u * (3 - 2 * u));
  }
  if (t < 0.97) return 0.36;
  return 0.36 * (1 - (t - 0.97) / 0.03);
}

function jarRadius(t: number): number {
  if (t < 0.04) return 0.25 + 0.75 * (t / 0.04);
  if (t < 0.8) return 1;
  if (t < 0.84) return 0.94;
  if (t < 0.97) return 0.98;
  return 0.98 * (1 - (t - 0.97) / 0.03);
}

/**
 * Reorder a BoxGeometry's index so faces sharing a material are contiguous,
 * leaving one draw group per material instead of six (~24k instanced packs:
 * every group is a draw call per InstancedMesh). `faceMaterial[f]` is the
 * material index of face f in BoxGeometry order (+x, −x, +y, −y, +z, −z).
 */
function groupBoxFaces(geometry: THREE.BoxGeometry, faceMaterial: readonly number[]): THREE.BoxGeometry {
  const index = geometry.getIndex()!;
  const source = Array.from(index.array);
  const perFace = source.length / 6;
  const order: number[] = [];
  geometry.clearGroups();
  const materialCount = Math.max(...faceMaterial) + 1;
  for (let m = 0; m < materialCount; m += 1) {
    const start = order.length;
    faceMaterial.forEach((mat, f) => {
      if (mat === m) order.push(...source.slice(f * perFace, (f + 1) * perFace));
    });
    geometry.addGroup(start, order.length - start, m);
  }
  geometry.setIndex(order);
  return geometry;
}

function buildProduct(productId: string, name: string): THREE.Group {
  const spec = PACK_SPECS[productId] ?? FALLBACK_PACK_SPEC;
  const group = new THREE.Group();
  group.name = `product:${productId}`;
  // Belt-and-braces identity: placement also tags each clone via tagProduct.
  group.userData.productId = productId;
  group.userData.productName = name;

  const lambert = (color: string): THREE.MeshLambertMaterial =>
    new THREE.MeshLambertMaterial({ color, flatShading: true });

  // NOTE: every pack is ONE child mesh — storeLayout instances children[0].
  if (spec.shape === "tin") {
    const [diameter, height] = spec.size;
    const radius = diameter / 2;
    const sideMat = new THREE.MeshLambertMaterial({ map: makeProductLabel(spec, productId), flatShading: true });
    const tin = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 20),
      [sideMat, lambert(spec.accent), lambert(spec.side)],
    );
    tin.position.y = height / 2;
    group.add(tin);
    return group;
  }

  if (spec.shape === "bottle" || spec.shape === "jar") {
    const [diameter, height] = spec.size;
    const isBottle = spec.shape === "bottle";
    const texture = isBottle
      ? makeRoundLabel(spec, productId, 0.86, 0.58, 0.14)
      : makeRoundLabel(spec, productId, 0.82, 0.74, 0.12);
    const mesh = new THREE.Mesh(
      new THREE.LatheGeometry(latheProfile(diameter / 2, height, isBottle ? bottleRadius : jarRadius), 8),
      new THREE.MeshLambertMaterial({ map: texture }),
    );
    // Lathe geometry already stands on y = 0 — no lift.
    group.add(mesh);
    return group;
  }

  const [width, height, depth] = spec.size;
  const sideMat = lambert(spec.side);
  // Flat packs (rice, mee hoon, soap…) and trays read better from above —
  // put the label on the top face instead of the thin front strip.
  const labelOnTop = spec.shape === "tray" || height < 0.08;
  const labelMat = new THREE.MeshLambertMaterial({ map: makeProductLabel(spec, productId), flatShading: true });
  const topMat = labelOnTop ? labelMat : lambert(spec.body);
  const faceMat = labelOnTop ? sideMat : labelMat;
  // Box faces: +x, -x, +y, -y, +z, -z → materials 0 side, 1 top, 2 face.
  const box = new THREE.Mesh(groupBoxFaces(new THREE.BoxGeometry(width, height, depth), [0, 0, 1, 0, 2, 0]), [
    sideMat,
    topMat,
    faceMat,
  ]);
  box.position.y = height / 2;
  group.add(box);
  return group;
}

// ---------------------------------------------------------------------------
// Procedural counter (fallback when the glTF is absent).
// ---------------------------------------------------------------------------

function buildCounterProcedural(): THREE.Group {
  const group = new THREE.Group();
  group.name = "counter";
  const width = 1.9;
  const depth = 0.75;
  const baseHeight = 0.88;
  const topHeight = 0.07;

  const creamMat = new THREE.MeshLambertMaterial({ color: COUNTER_CREAM, flatShading: true });
  const topMat = new THREE.MeshLambertMaterial({ color: COUNTER_TOP, flatShading: true });
  const kickMat = new THREE.MeshLambertMaterial({ color: "#4a3b28", flatShading: true });

  const base = new THREE.Mesh(new THREE.BoxGeometry(width, baseHeight, depth), creamMat);
  base.position.y = baseHeight / 2;
  group.add(base);

  const top = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, topHeight, depth + 0.08), topMat);
  top.position.y = baseHeight + topHeight / 2;
  group.add(top);

  const kick = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.08, depth - 0.1), kickMat);
  kick.position.y = 0.04;
  group.add(kick);
  return group;
}

// ---------------------------------------------------------------------------
// Signage — CanvasTexture planes (mesh so consumers can mount freely).
// ---------------------------------------------------------------------------
function buildKedaiSign(): THREE.Mesh {
  const [canvas, ctx] = makeCanvas(1024, 300);
  ctx.fillStyle = SIGN_WOOD_BG;
  ctx.fillRect(0, 0, 1024, 300);
  ctx.strokeStyle = SIGN_CREAM;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, 1024 - 36, 300 - 36);
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 38, 1024 - 76, 300 - 76);
  drawSpaced(ctx, "PASARAYA MESRA", 512, 160, 900, 92, 12, FONT_STACK, SIGN_CREAM);
  drawSpaced(ctx, "SEREMBAN · SEJAK 1987", 512, 234, 880, 30, 8, FONT_BODY, "#d8b878");

  const texture = toTexture(canvas);
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.45,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.995), material);
  mesh.name = "signage:store-sign";
  return mesh;
}

function buildGrabSign(): THREE.Mesh {
  const [canvas, ctx] = makeCanvas(640, 300);
  ctx.fillStyle = GRAB_GREEN;
  ctx.fillRect(0, 0, 640, 300);
  // Subtle darker green frame so it reads as a mounted sign, not a void.
  ctx.strokeStyle = "#00824a";
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, 624, 284);
  drawFitted(ctx, "Grab", 320, 150, 480, 120, FONT_STACK, "#ffffff");
  drawSpaced(ctx, "PICK-UP POINT", 320, 238, 560, 34, 10, FONT_BODY, "#eafff3");

  const texture = toTexture(canvas);
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.5,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.75), material);
  mesh.name = "signage:grab-pickup";
  return mesh;
}

// ---------------------------------------------------------------------------
// glTF loading — per-asset try/catch, procedural fallback on any failure.
// ---------------------------------------------------------------------------
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

/**
 * Load a glTF and normalize it: uniform scale so its bounding-box height is
 * `targetHeightM`, footprint centred on x/z, base sitting on y = 0.
 * Returns null (caller falls back) on any error or timeout.
 */
async function loadGltfGroup(url: string, targetHeightM: number): Promise<THREE.Group | null> {
  try {
    const loader = new GLTFLoader();
    const gltf = await withTimeout(loader.loadAsync(url), GLTF_TIMEOUT_MS);
    const model = gltf.scene;
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    const rawBox = new THREE.Box3().setFromObject(model);
    const rawHeight = rawBox.getSize(new THREE.Vector3()).y;
    if (!Number.isFinite(rawHeight) || rawHeight <= 1e-4) {
      throw new Error("glTF has an empty bounding box");
    }
    model.scale.setScalar(targetHeightM / rawHeight);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;

    const group = new THREE.Group();
    group.name = `gltf:${url.split("/").pop() ?? url}`;
    group.add(model);
    return group;
  } catch (error) {
    console.warn(`[assets] Could not load ${url} — using procedural fallback.`, error);
    return null;
  }
}

/**
 * Canvas-free last resort: plain colored geometry, same bundle shape.
 * Used only if something unexpected fails during the normal path, so the
 * game still boots (never throws) even without 2D canvas support.
 */
function buildEmergencyBundle(onStage?: AssetStageCallback): AssetBundle {
  const products = new Map<string, THREE.Group>();
  for (const product of PRODUCTS) {
    const spec = PACK_SPECS[product.id] ?? FALLBACK_PACK_SPEC;
    const [width, height, depth] = spec.size;
    const group = new THREE.Group();
    group.name = `product:${product.id}`;
    group.userData.productId = product.id;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshLambertMaterial({ color: spec.body, flatShading: true }),
    );
    box.position.y = height / 2;
    group.add(box);
    products.set(product.id, group);
  }
  const plainSign = (color: string, width: number, height: number, name: string): THREE.Mesh => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }),
    );
    mesh.name = name;
    return mesh;
  };
  onStage?.("Dibuka! Selamat datang…", 1);
  return {
    products,
    counter: buildCounterProcedural(),
    signage: {
      kedaiSign: plainSign(SIGN_WOOD_BG, 3.4, 0.995, "signage:store-sign"),
      grabSign: plainSign(GRAB_GREEN, 1.6, 0.75, "signage:grab-pickup"),
    },
  };
}

// ---------------------------------------------------------------------------
// Public entry point — never throws.
// ---------------------------------------------------------------------------
export async function loadAssets(onStage?: AssetStageCallback): Promise<AssetBundle> {
  try {
    onStage?.("Menyediakan kedai…", 0.1);

    // Products (always procedural — see header comment).
    const products = new Map<string, THREE.Group>();
    for (const product of PRODUCTS) {
      products.set(product.id, buildProduct(product.id, product.name));
    }
    onStage?.("Memajang produk…", 0.45);

    // Counter: prefer the Kenney CC0 glTF, fall back to procedural.
    onStage?.("Menyusun rak & kaunter…", 0.6);
    const counterGltf = await loadGltfGroup(GLTF_MANIFEST.counter.url, GLTF_MANIFEST.counter.targetHeightM);
    const counter = counterGltf ?? buildCounterProcedural();

    onStage?.("Menggantung papan tanda…", 0.85);
    const signage = { kedaiSign: buildKedaiSign(), grabSign: buildGrabSign() };

    onStage?.("Dibuka! Selamat datang…", 1);
    return { products, counter, signage };
  } catch (error) {
    console.error("[assets] Unexpected failure — using plain emergency bundle.", error);
    return buildEmergencyBundle(onStage);
  }
}
