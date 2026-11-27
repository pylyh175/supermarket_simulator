// Procedural supermarket gondola runs: steel uprights at every bay boundary,
// a perforated back panel, kick plates, five white shelves with dark price
// strips on their lips, and a top header strip. Each run kind is built once
// (geometry merged per material) and cloned per run, sharing geometry.
//
// Local frame: the run's length is along Z, centred on the origin; faces
// look along ±X. A "double" run has its centre plane at x = 0 and stocks both
// sides; a "wall" run has its back panel at x = 0 and shelves toward +X.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BAY_W_M,
  BAYS_PER_RUN,
  BOARD_T_M,
  FACE_HALF_M,
  KICK_H_M,
  SHELF_YS,
  UNIT_HEIGHT_M,
  UPRIGHT_W_M,
} from "../game/storeGeometry";

export type RunKind = "double" | "wall";

const RUN_LENGTH_M = BAY_W_M * BAYS_PER_RUN;
const PANEL_T_M = 0.02;
const STRIP_H_M = 0.04;
const HEADER_H_M = 0.08;
const SPINE_POST_D_M = 0.08;

let materials: { steel: THREE.Material; panel: THREE.Material; shelf: THREE.Material; strip: THREE.Material } | null = null;

function perforatedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#d9dcdf";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#9da3a8";
    for (let y = 8; y < 64; y += 16) for (let x = 8; x < 64; x += 16) ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // 64 px tile = 4 holes → 25 mm pitch = 0.1 m per tile.
  texture.repeat.set(RUN_LENGTH_M / 0.1, UNIT_HEIGHT_M / 0.1);
  return texture;
}

function sharedMaterials(): NonNullable<typeof materials> {
  materials ??= {
    steel: new THREE.MeshLambertMaterial({ color: "#8d949b" }),
    panel: new THREE.MeshLambertMaterial({ map: perforatedTexture() }),
    shelf: new THREE.MeshLambertMaterial({ color: "#f2f2f0" }),
    strip: new THREE.MeshLambertMaterial({ color: "#2b2f33" }),
  };
  return materials;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function mergedMesh(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, material);
  for (const p of parts) p.dispose();
  return mesh;
}

/** One gondola run of BAYS_PER_RUN bays (see the file header for the local frame). */
export function buildRunMeshes(kind: RunKind): THREE.Group {
  const m = sharedMaterials();
  // Shelf-side x centres: both sides for a double run, +X only for a wall run.
  const sides = kind === "double" ? [1, -1] : [1];
  const panelX = kind === "double" ? 0 : PANEL_T_M / 2;
  const depth = kind === "double" ? 2 * FACE_HALF_M : FACE_HALF_M;
  const centerX = kind === "double" ? 0 : FACE_HALF_M / 2;

  const steel: THREE.BufferGeometry[] = [];
  const shelves: THREE.BufferGeometry[] = [];
  const strips: THREE.BufferGeometry[] = [];

  // Full-depth end panels at the run ends; slim posts on the spine between bays.
  for (let k = 0; k <= BAYS_PER_RUN; k += 1) {
    const z = -RUN_LENGTH_M / 2 + k * BAY_W_M;
    const end = k === 0 || k === BAYS_PER_RUN;
    steel.push(box(end ? depth : SPINE_POST_D_M, UNIT_HEIGHT_M, UPRIGHT_W_M, end ? centerX : panelX, UNIT_HEIGHT_M / 2, z));
  }
  steel.push(box(SPINE_POST_D_M, HEADER_H_M, RUN_LENGTH_M, panelX, UNIT_HEIGHT_M - HEADER_H_M / 2, 0));

  for (const side of sides) {
    const lipX = side * FACE_HALF_M;
    const shelfX = (kind === "double" ? side * FACE_HALF_M : FACE_HALF_M) / 2;
    strips.push(box(0.02, KICK_H_M, RUN_LENGTH_M, lipX - side * 0.01, KICK_H_M / 2, 0));
    for (const y of SHELF_YS) {
      shelves.push(box(FACE_HALF_M, BOARD_T_M, RUN_LENGTH_M, shelfX, y - BOARD_T_M / 2, 0));
      strips.push(box(0.012, STRIP_H_M, RUN_LENGTH_M, lipX + side * 0.006, y - STRIP_H_M / 2, 0));
    }
  }

  const group = new THREE.Group();
  group.name = `gondola:${kind}`;
  group.add(mergedMesh(steel, m.steel));
  group.add(mergedMesh(shelves, m.shelf));
  group.add(mergedMesh(strips, m.strip));
  const panel = new THREE.Mesh(new THREE.BoxGeometry(PANEL_T_M, UNIT_HEIGHT_M, RUN_LENGTH_M), m.panel);
  panel.position.set(panelX, UNIT_HEIGHT_M / 2, 0);
  group.add(panel);
  return group;
}
