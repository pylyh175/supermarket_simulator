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
//   3. Signage (KEDAI RUNCIT / Grab pick-up) and customers are procedural.
//
// Everything is built locally — no runtime network requests to external
// hosts. loadAssets() never throws; on any failure it resolves with the
// procedural set instead.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PRODUCTS } from "../data/products";

export interface AssetBundle {
  products: Map<string, THREE.Group>;
  shelves: THREE.Group[];
  counter: THREE.Group;
  signage: { kedaiSign: THREE.Mesh; grabSign: THREE.Mesh };
  customers: THREE.Group[];
}

/** Stage reporter for the loading overlay (label + 0..1 progress). */
export type AssetStageCallback = (label: string, progress: number) => void;

// ---------------------------------------------------------------------------
// glTF manifest — the only third-party files we ship. CC0, Kenney.nl.
// ---------------------------------------------------------------------------
const GLTF_MANIFEST = {
  shelfTall: { url: "/assets/furniture-kit/bookcaseOpen.glb", targetHeightM: 2.0 },
  shelfLow: { url: "/assets/furniture-kit/bookcaseOpenLow.glb", targetHeightM: 1.1 },
  counter: { url: "/assets/furniture-kit/kitchenBar.glb", targetHeightM: 0.95 },
} as const;

const GLTF_TIMEOUT_MS = 6000;

// Shared warm wood / cream palette (matches storeShell + plan constants).
const WOOD_COLOR = "#8a5a2e";
const WOOD_DARK = "#5f3d1e";
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
// Product packaging specs — Malaysian flavor, packaging-inspired colors.
// ---------------------------------------------------------------------------
interface ProductSpec {
  shape: "box" | "tin" | "tray";
  /** Box/tray: [w, h, d]; tin: [diameter, height, diameter]. */
  size: [number, number, number];
  body: string;
  side: string;
  accent: string;
  brandFg: string;
  brand: string;
  variant: string;
  detail: string;
}

const PRODUCT_SPECS: Record<string, ProductSpec> = {
  "milo-300g": {
    shape: "tin", size: [0.11, 0.145, 0.11],
    body: "#1f6f3f", side: "#175733", accent: "#6b3a1e", brandFg: "#f7ead7",
    brand: "MILO", variant: "MALTED MILK", detail: "TIN 300g",
  },
  "maggi-curry": {
    shape: "box", size: [0.16, 0.21, 0.085],
    body: "#d42a1e", side: "#b02015", accent: "#ffd21e", brandFg: "#fff8ea",
    brand: "MAGGI", variant: "KARI · CURRY", detail: "NOODLES 5-PCS",
  },
  "roti-canai-frozen": {
    shape: "box", size: [0.2, 0.055, 0.28],
    body: "#e8762d", side: "#c2571d", accent: "#1d4f91", brandFg: "#fff3df",
    brand: "ROTI CANAI", variant: "FROZEN · 5PK", detail: "Halal",
  },
  "nasi-lemak-bungkus": {
    shape: "box", size: [0.14, 0.125, 0.14],
    body: "#2e7d32", side: "#215c25", accent: "#f5e9c8", brandFg: "#f5e9c8",
    brand: "NASI LEMAK", variant: "BUNGKUS", detail: "Sambal · Telur",
  },
  "tens-egg": {
    shape: "tray", size: [0.29, 0.085, 0.265],
    body: "#8a6b45", side: "#6b5233", accent: "#5c4630", brandFg: "#f7ead7",
    brand: "TENS EGG", variant: "TRAY 10", detail: "Telur Segar",
  },
  "kuih-bahulu": {
    shape: "box", size: [0.15, 0.1, 0.15],
    body: "#e08bb0", side: "#b8618a", accent: "#a83d63", brandFg: "#fff0f5",
    brand: "KUIH", variant: "BAHULU", detail: "12 PCS",
  },
  "susu-fullcream": {
    shape: "box", size: [0.088, 0.23, 0.088],
    body: "#2050a0", side: "#173c77", accent: "#ffffff", brandFg: "#ffffff",
    brand: "SUSU", variant: "FULL CREAM", detail: "1 LITER",
  },
  "mee-hoon": {
    shape: "box", size: [0.3, 0.05, 0.21],
    body: "#f2c230", side: "#c99a1d", accent: "#b45309", brandFg: "#4a2c10",
    brand: "MEE HOON", variant: "500g", detail: "Rice Vermicelli",
  },
  "telur-10pk": {
    shape: "box", size: [0.27, 0.11, 0.2],
    body: "#b98a52", side: "#8f683a", accent: "#7a5230", brandFg: "#fdf2df",
    brand: "TELUR AYAM", variant: "10 PK · MEDIUM", detail: "Telur Segar",
  },
  "kopi-3in1": {
    shape: "box", size: [0.14, 0.19, 0.06],
    body: "#c02a20", side: "#961f17", accent: "#f3e3c8", brandFg: "#fff6e6",
    brand: "KOPI", variant: "3-IN-1 · 10PK", detail: "Kopi O · Gula · Susu",
  },
  "bicarbonate-250g": {
    shape: "box", size: [0.085, 0.125, 0.05],
    body: "#e8f0f2", side: "#c3cfd3", accent: "#2f6f9f", brandFg: "#1d3a4d",
    brand: "SODA", variant: "BICARBONATE", detail: "250g",
  },
  "soap-bar": {
    shape: "box", size: [0.095, 0.045, 0.07],
    body: "#1f8f8a", side: "#146a66", accent: "#bfe8e4", brandFg: "#eafffc",
    brand: "SABUN", variant: "SOAP BAR", detail: "Bar Soap",
  },
};

const FALLBACK_SPEC: ProductSpec = {
  shape: "box", size: [0.16, 0.2, 0.09],
  body: "#7a5a36", side: "#5b4225", accent: "#caa46a", brandFg: "#fdf6e9",
  brand: "PRODUK", variant: "", detail: "",
};

/**
 * Render a product label onto a canvas. Pack colors + accent pinstripe +
 * faux barcode only — every word of brand/variant/detail text has been
 * stripped (names are shown via the 3D hover tooltip instead).
 */
function makeProductLabel(spec: ProductSpec, seed: string): THREE.CanvasTexture {
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

function buildProduct(productId: string, name: string): THREE.Group {
  const spec = PRODUCT_SPECS[productId] ?? { ...FALLBACK_SPEC, brand: name.toUpperCase().slice(0, 22) };
  const group = new THREE.Group();
  group.name = `product:${productId}`;
  // Belt-and-braces identity: placement also tags each clone via tagProduct.
  group.userData.productId = productId;

  const lambert = (color: string): THREE.MeshLambertMaterial =>
    new THREE.MeshLambertMaterial({ color, flatShading: true });

  if (spec.shape === "tin") {
    const [diameter, height] = spec.size;
    const radius = diameter / 2;
    const sideLabel = makeProductLabel(spec, productId);
    const sideMat = new THREE.MeshLambertMaterial({ map: sideLabel, flatShading: true });
    const capMat = lambert(spec.accent);
    const bodyMat = lambert(spec.side);
    const tin = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20), [sideMat, capMat, bodyMat]);
    tin.position.y = height / 2;
    group.add(tin);
    return group;
  }

  const [width, height, depth] = spec.size;
  const sideMat = lambert(spec.side);
  // Flat packs (roti, mee hoon, soap…) and trays read better from above —
  // put the label on the top face instead of the thin front strip.
  const labelOnTop = spec.shape === "tray" || height < 0.08;
  // One label canvas per box — reused on the top face when applicable.
  const labelMat = new THREE.MeshLambertMaterial({ map: makeProductLabel(spec, productId), flatShading: true });
  const topMat = labelOnTop ? labelMat : lambert(spec.body);
  const faceMat = labelOnTop ? sideMat : labelMat;
  // Box faces: +x, -x, +y, -y, +z, -z.
  const materials = [sideMat, sideMat, topMat, sideMat, faceMat, sideMat];
  const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials);
  box.position.y = height / 2;
  group.add(box);
  return group;
}

// ---------------------------------------------------------------------------
// Procedural shelf + counter (fallbacks, also used when glTFs are absent).
// ---------------------------------------------------------------------------
function buildShelfProcedural(low: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = low ? "shelf:low" : "shelf:tall";
  const width = 1.6;
  const depth = 0.5;
  const height = low ? 1.1 : 1.9;
  const post = 0.08;
  const boardThickness = 0.05;

  const woodMat = new THREE.MeshLambertMaterial({ color: WOOD_COLOR, flatShading: true });
  const boardMat = new THREE.MeshLambertMaterial({ color: WOOD_DARK, flatShading: true });

  const addBox = (
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mat: THREE.MeshLambertMaterial,
  ): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
  };

  const halfW = width / 2 - post / 2;
  const halfD = depth / 2 - post / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(post, height, post, sx * halfW, height / 2, sz * halfD, woodMat);
    }
  }
  const boardYs = low ? [0.32, 0.68, height - boardThickness / 2] : [0.35, 0.95, 1.5, height - boardThickness / 2];
  for (const y of boardYs) {
    addBox(width, boardThickness, depth, 0, y, 0, boardMat);
  }
  return group;
}

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
  drawSpaced(ctx, "KEDAI RUNCIT", 512, 160, 900, 92, 16, FONT_STACK, SIGN_CREAM);
  drawSpaced(ctx, "MINI MARKET · EST. 1987", 512, 234, 880, 30, 8, FONT_BODY, "#d8b878");

  const texture = toTexture(canvas);
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.45,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.995), material);
  mesh.name = "signage:kedai-runcit";
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
// Customers — capsule/low-poly figures, deterministic variants.
// ---------------------------------------------------------------------------
interface CustomerVariant {
  body: string;
  skin: string;
  /** "none" | "songkok" (black cap) | "tudung" (headscarf). */
  headwear: "none" | "songkok" | "tudung";
  headwearColor: string;
  scale: number;
}

const CUSTOMER_VARIANTS: CustomerVariant[] = [
  { body: "#c96f4a", skin: "#8d5a3b", headwear: "none", headwearColor: "#2b2b2b", scale: 1.0 },
  { body: "#4a6fa5", skin: "#6e4a2c", headwear: "songkok", headwearColor: "#1c1c1c", scale: 1.06 },
  { body: "#7a4a6f", skin: "#a9714b", headwear: "tudung", headwearColor: "#d9c9a8", scale: 0.94 },
];

function buildCustomer(variant: CustomerVariant, index: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `customer:${index}`;
  const lambert = (color: string): THREE.MeshLambertMaterial =>
    new THREE.MeshLambertMaterial({ color, flatShading: true });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.52, 4, 10), lambert(variant.body));
  body.position.y = 0.92;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), lambert(variant.skin));
  head.position.y = 1.42;
  group.add(head);

  if (variant.headwear === "songkok") {
    const songkok = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.09, 12), lambert(variant.headwearColor));
    songkok.position.y = 1.53;
    group.add(songkok);
  } else if (variant.headwear === "tudung") {
    const tudung = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), lambert(variant.headwearColor));
    tudung.scale.set(1, 1.15, 1);
    tudung.position.y = 1.45;
    group.add(tudung);
  } else {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), lambert("#241a12"));
    hair.position.y = 1.45;
    group.add(hair);
  }

  group.scale.setScalar(variant.scale);
  return group;
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
    const spec = PRODUCT_SPECS[product.id] ?? FALLBACK_SPEC;
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
    shelves: [buildShelfProcedural(false), buildShelfProcedural(true)],
    counter: buildCounterProcedural(),
    signage: {
      kedaiSign: plainSign(SIGN_WOOD_BG, 3.4, 0.995, "signage:kedai-runcit"),
      grabSign: plainSign(GRAB_GREEN, 1.6, 0.75, "signage:grab-pickup"),
    },
    customers: CUSTOMER_VARIANTS.map((variant, index) => buildCustomer(variant, index)),
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

    // Shelves + counter: prefer the Kenney CC0 glTFs, fall back per asset.
    onStage?.("Menyusun rak & kaunter…", 0.6);
    const [shelfTall, shelfLow, counterGltf] = await Promise.all([
      loadGltfGroup(GLTF_MANIFEST.shelfTall.url, GLTF_MANIFEST.shelfTall.targetHeightM),
      loadGltfGroup(GLTF_MANIFEST.shelfLow.url, GLTF_MANIFEST.shelfLow.targetHeightM),
      loadGltfGroup(GLTF_MANIFEST.counter.url, GLTF_MANIFEST.counter.targetHeightM),
    ]);
    const shelves = [shelfTall ?? buildShelfProcedural(false), shelfLow ?? buildShelfProcedural(true)];
    const counter = counterGltf ?? buildCounterProcedural();

    onStage?.("Menggantung papan tanda…", 0.85);
    const signage = { kedaiSign: buildKedaiSign(), grabSign: buildGrabSign() };
    const customers = CUSTOMER_VARIANTS.map((variant, index) => buildCustomer(variant, index));

    onStage?.("Dibuka! Selamat datang…", 1);
    return { products, shelves, counter, signage, customers };
  } catch (error) {
    console.error("[assets] Unexpected failure — using plain emergency bundle.", error);
    return buildEmergencyBundle(onStage);
  }
}
