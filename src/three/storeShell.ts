// Store shell: floor, walls, glass shopfront, ceiling grid, strip lights,
// the street outside, fog. No shelves, till or customers — storeLayout.ts
// adds those on top.
//
// Interior 28 (x) × 20 (z) × 4.2 m, centred on the origin (see
// src/game/storeGeometry.ts). Walls grow OUTWARD by WALL_THICKNESS_M so the
// opening matches makeWallBoxes(). The front wall (+Z) is a glass shopfront
// with the door at its west end. The doorway is VISUAL only — the collider
// from makeWallBoxes() keeps the front wall solid, so the player can never
// leave through it; customers despawn just inside it.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeWallBoxes, type Aabb } from "../player/colliders";
import {
  CEILING_HEIGHT_M,
  DOOR,
  FRONT_Z,
  GONDOLA_XS,
  STORE_DEPTH_M,
  STORE_WIDTH_M,
  WALL_THICKNESS_M,
} from "../game/storeGeometry";

export { STORE_WIDTH_M, STORE_DEPTH_M, WALL_THICKNESS_M };
export const WALL_HEIGHT_M = CEILING_HEIGHT_M;

const FLOOR_COLOR = "#d6d3cc";
const WALL_COLOR = "#ebe8e1";
const FRAME_COLOR = "#b8bec4"; // aluminium shopfront frame
const FOG_COLOR = "#eef2f5";
const FOG_NEAR_M = 25;
const FOG_FAR_M = 60;

const KICK_WALL_H_M = 0.4;
const GLASS_TOP_M = 2.7;
const FROST_TOP_M = 1.3;
const MULLION_PITCH_M = 2.4;

const TILE_M = 0.6;
const FIXTURE_PITCH_M = 2.0;

const OUTSIDE_DEPTH_M = 4;
const BACKDROP_W_M = 40;
const BACKDROP_H_M = 6;

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Ceiling tiles: white squares with a grey T-bar grid, one tile per texture repeat. */
function ceilingTexture(): THREE.CanvasTexture {
  const t = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#f7f7f5";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#cfd2d4";
    ctx.fillRect(0, 0, 128, 3);
    ctx.fillRect(0, 0, 3, 128);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(STORE_WIDTH_M / TILE_M, STORE_DEPTH_M / TILE_M);
  return t;
}

/** Frosted film band with promo posters and stickers, seen from inside. */
function frostTexture(widthM: number): THREE.CanvasTexture {
  const pxPerM = 96;
  const w = Math.round(widthM * pxPerM);
  const h = Math.round((FROST_TOP_M - KICK_WALL_H_M) * pxPerM);
  const posters = ["JIMAT!", "HARGA ISTIMEWA", "BUKA 9PG–10MLM"];
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(0, 0, w, h);
    const posterW = 1.4 * pxPerM;
    const step = w / (posters.length + 1);
    posters.forEach((text, i) => {
      const x = step * (i + 1) - posterW / 2;
      ctx.fillStyle = "#d62828";
      ctx.fillRect(x, h * 0.12, posterW, h * 0.76);
      ctx.fillStyle = "#ffd60a";
      ctx.fillRect(x + 6, h * 0.12 + 6, posterW - 12, h * 0.2);
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 ${Math.round(h * 0.2)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + posterW / 2, h * 0.58, posterW - 12);
    });
  });
}

/** Street seen through the glass: road, kerb, shophouse row, sky. Drawn in metres. */
function backdropTexture(): THREE.CanvasTexture {
  const pxPerM = 64;
  const w = BACKDROP_W_M * pxPerM;
  const h = BACKDROP_H_M * pxPerM;
  const y = (m: number): number => h - m * pxPerM; // metres above the ground → canvas y
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = "#a9d6f2";
    ctx.fillRect(0, 0, w, h);
    // Shophouse row opposite: shop fronts, signboards, upper-floor windows.
    const facades = ["#f2d7a6", "#cfe3c8", "#f4c2b0", "#d7d3ea", "#f6e3a1", "#bfdbe4"];
    const signs = ["#c0392b", "#1f6f8b", "#2e7d32", "#b45309"];
    const unitW = 5 * pxPerM;
    for (let i = 0; i * unitW < w; i += 1) {
      const x = i * unitW;
      ctx.fillStyle = facades[i % facades.length];
      ctx.fillRect(x, y(5.2), unitW - 6, y(1.0) - y(5.2));
      ctx.fillStyle = "#8fa3b0";
      for (let k = 0; k < 3; k += 1) ctx.fillRect(x + 16 + k * (unitW / 3), y(4.6), unitW / 3 - 32, 1.0 * pxPerM);
      ctx.fillStyle = signs[i % signs.length];
      ctx.fillRect(x + 8, y(3.0), unitW - 22, 0.5 * pxPerM);
      ctx.fillStyle = "#b9c3c9"; // shop interiors behind open shutters
      ctx.fillRect(x + 14, y(2.4), unitW - 34, 1.4 * pxPerM);
    }
    ctx.fillStyle = "#9b978f"; // kerb / five-foot way
    ctx.fillRect(0, y(1.0), w, 0.2 * pxPerM);
    ctx.fillStyle = "#5a5e63"; // road
    ctx.fillRect(0, y(0.8), w, 0.8 * pxPerM);
    ctx.fillStyle = "#e8e8e8";
    for (let x = 0; x < w; x += 4 * pxPerM) ctx.fillRect(x, y(0.4), 2 * pxPerM, 6);
    // Parked motorbikes along the kerb.
    ctx.fillStyle = "#1d1f22";
    for (const mx of [6, 8, 21, 23, 30]) {
      const cx = mx * pxPerM;
      const g = y(0.85);
      ctx.beginPath();
      ctx.arc(cx - 0.45 * pxPerM, g - 0.22 * pxPerM, 0.22 * pxPerM, 0, Math.PI * 2);
      ctx.arc(cx + 0.45 * pxPerM, g - 0.22 * pxPerM, 0.22 * pxPerM, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - 0.5 * pxPerM, g - 0.75 * pxPerM, 1.0 * pxPerM, 0.35 * pxPerM);
      ctx.fillRect(cx + 0.3 * pxPerM, g - 1.05 * pxPerM, 0.1 * pxPerM, 0.35 * pxPerM);
    }
  });
}

export function buildStoreShell(scene: THREE.Scene): Aabb[] {
  const hw = STORE_WIDTH_M / 2;
  const hd = STORE_DEPTH_M / 2;
  const t = WALL_THICKNESS_M;
  const H = CEILING_HEIGHT_M;

  scene.fog = new THREE.Fog(new THREE.Color(FOG_COLOR), FOG_NEAR_M, FOG_FAR_M);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(STORE_WIDTH_M, STORE_DEPTH_M),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.85, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Ceiling grid at full height — keeps high-pitch views from seeing void.
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(STORE_WIDTH_M, STORE_DEPTH_M),
    // Unlit: real ceilings read bright from the strip lights' bounce.
    new THREE.MeshBasicMaterial({ map: ceilingTexture(), color: "#e9ebec" }),
  );
  ceiling.rotation.x = Math.PI / 2; // faces downward
  ceiling.position.y = H;
  scene.add(ceiling);

  // Strip-light fixtures: emissive-looking boxes (no real lights), one row
  // over every aisle, running front to back. Merged into a single mesh.
  const aisleXs: number[] = [];
  for (let i = 1; i < GONDOLA_XS.length; i += 1) aisleXs.push((GONDOLA_XS[i - 1] + GONDOLA_XS[i]) / 2);
  const outerX = (hw + GONDOLA_XS[GONDOLA_XS.length - 1]) / 2;
  aisleXs.push(-outerX, outerX);
  const fixtures: THREE.BufferGeometry[] = [];
  for (const x of aisleXs) {
    for (let z = -hd + 1; z <= hd - 1 + 1e-6; z += FIXTURE_PITCH_M) {
      const g = new THREE.BoxGeometry(0.15, 0.04, 1.2);
      g.translate(x, H - 0.03, z);
      fixtures.push(g);
    }
  }
  const lights = new THREE.Mesh(mergeGeometries(fixtures)!, new THREE.MeshBasicMaterial({ color: "#ffffff" }));
  scene.add(lights);
  for (const g of fixtures) g.dispose();

  const wallMat = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.9, metalness: 0 });
  const frameMat = new THREE.MeshLambertMaterial({ color: FRAME_COLOR });
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = wallMat): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  // Back (−Z) wall: full outer span, covering the corners. Side walls between.
  addBox(STORE_WIDTH_M + 2 * t, H, t, 0, H / 2, -hd - t / 2);
  addBox(t, H, STORE_DEPTH_M, -hw - t / 2, H / 2, 0);
  addBox(t, H, STORE_DEPTH_M, hw + t / 2, H / 2, 0);

  // Front (+Z) shopfront: kick wall, glass, frosted band, header; door gap at DOOR.
  const frontZ = FRONT_Z + t / 2;
  const doorL = DOOR.x - DOOR.widthM / 2;
  const doorR = DOOR.x + DOOR.widthM / 2;
  const segments: [number, number][] = [
    [-hw - t, doorL],
    [doorR, hw + t],
  ];
  const glassMat = new THREE.MeshBasicMaterial({ color: "#cfe6ee", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  for (const [a, b] of segments) {
    const w = b - a;
    const cx = (a + b) / 2;
    addBox(w, KICK_WALL_H_M, t, cx, KICK_WALL_H_M / 2, frontZ);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, GLASS_TOP_M - KICK_WALL_H_M), glassMat);
    glass.position.set(cx, (KICK_WALL_H_M + GLASS_TOP_M) / 2, frontZ);
    scene.add(glass);
    const frost = new THREE.Mesh(
      new THREE.PlaneGeometry(w, FROST_TOP_M - KICK_WALL_H_M),
      new THREE.MeshBasicMaterial({ map: frostTexture(w), transparent: true, depthWrite: false }),
    );
    frost.rotation.y = Math.PI; // readable from inside the store
    frost.position.set(cx, (KICK_WALL_H_M + FROST_TOP_M) / 2, frontZ - 0.01);
    scene.add(frost);
    for (let x = a; x <= b + 1e-6; x += MULLION_PITCH_M) {
      addBox(0.06, GLASS_TOP_M - KICK_WALL_H_M, 0.08, x, (KICK_WALL_H_M + GLASS_TOP_M) / 2, frontZ, frameMat);
    }
    addBox(w, 0.06, 0.1, cx, GLASS_TOP_M, frontZ, frameMat);
  }
  addBox(STORE_WIDTH_M + 2 * t, H - GLASS_TOP_M, t, 0, (GLASS_TOP_M + H) / 2, frontZ);
  addBox(DOOR.widthM, GLASS_TOP_M - DOOR.heightM, t, DOOR.x, (DOOR.heightM + GLASS_TOP_M) / 2, frontZ);
  for (const x of [doorL, doorR]) addBox(0.08, DOOR.heightM, t + 0.04, x, DOOR.heightM / 2, frontZ, frameMat);

  // Roller shutter rolled up over the door, outside the glass line.
  const shutterMat = new THREE.MeshLambertMaterial({ color: "#9aa0a6" });
  addBox(DOOR.widthM + 0.2, 0.3, 0.3, DOOR.x, DOOR.heightM + 0.15, FRONT_Z + t + 0.15, shutterMat);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, DOOR.widthM, 16), shutterMat);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(DOOR.x, DOOR.heightM + 0.1, FRONT_Z + t + 0.32);
  scene.add(roll);

  // Outside: covered walkway floor and roof, then the painted street.
  const outsideZ = FRONT_Z + t + OUTSIDE_DEPTH_M / 2;
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(BACKDROP_W_M, t + OUTSIDE_DEPTH_M), // from the wall line: covers the door threshold
    new THREE.MeshLambertMaterial({ color: "#c4c1ba" }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, -0.01, FRONT_Z + (t + OUTSIDE_DEPTH_M) / 2);
  scene.add(walk);
  const roof = new THREE.Mesh(
    new THREE.PlaneGeometry(BACKDROP_W_M, OUTSIDE_DEPTH_M),
    new THREE.MeshLambertMaterial({ color: "#d9d6cf", side: THREE.DoubleSide }),
  );
  roof.rotation.x = Math.PI / 2;
  roof.position.set(0, 3.2, outsideZ);
  scene.add(roof);
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(BACKDROP_W_M, BACKDROP_H_M),
    new THREE.MeshBasicMaterial({ map: backdropTexture(), fog: false }),
  );
  backdrop.rotation.y = Math.PI; // faces −Z, into the store
  backdrop.position.set(0, BACKDROP_H_M / 2 - 0.02, FRONT_Z + t + OUTSIDE_DEPTH_M); // meets the walkway edge: no void under the street
  scene.add(backdrop);

  // Colliders match the wall boxes (the doorway stays solid).
  return makeWallBoxes(STORE_WIDTH_M, STORE_DEPTH_M, WALL_THICKNESS_M);
}
