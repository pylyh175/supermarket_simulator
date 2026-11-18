// Store shell: floor, walls, doorway, fog. No props, shelves, till or
// customers yet — those are later tasks and will be added on top of this.
//
// Internal layout (metres, interior opening centred on the origin):
//   interior: 20 (x) × 14 (z), walls grow OUTWARD by WALL_THICKNESS_M,
//   so the opening stays exactly 20 × 14 and matches makeWallBoxes().
//   North wall is -Z (doorway side); spawn is on the +Z side facing -Z.
//
// The doorway on the north wall is a VISUAL opening only — the collider
// returned by makeWallBoxes() keeps the north wall solid, so the player
// can never leave through it. A dark plane sits behind the gap to read as
// a stockroom doorway into darkness.
import * as THREE from "three";
import { makeWallBoxes, type Aabb } from "../player/colliders";

export const STORE_WIDTH_M = 20;
export const STORE_DEPTH_M = 14;
export const WALL_THICKNESS_M = 0.4;
export const WALL_HEIGHT_M = 3.2;

const DOOR_WIDTH_M = 2.4;
const DOOR_HEIGHT_M = 2.3;
const DOOR_CENTER_X = 0;

const FLOOR_COLOR = "#d9c39a";
const WALL_COLOR = "#c9a878";
const CEILING_COLOR = "#e6d9bd";
const DOOR_FRAME_COLOR = "#7a5a36"; // dark warm wood trim
const DOOR_VOID_COLOR = "#2a211a";  // dark plane behind the doorway
const FOG_COLOR = "#f0e6cc";
const FOG_NEAR_M = 12;
const FOG_FAR_M = 30;

export function buildStoreShell(scene: THREE.Scene): Aabb[] {
  const hw = STORE_WIDTH_M / 2;
  const hd = STORE_DEPTH_M / 2;
  const t = WALL_THICKNESS_M;

  // Subtle warm fog for depth (brief: #f0e6cc, ~30 m).
  scene.fog = new THREE.Fog(new THREE.Color(FOG_COLOR), FOG_NEAR_M, FOG_FAR_M);

  const floorMat = new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 0.95,
    metalness: 0,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(STORE_WIDTH_M, STORE_DEPTH_M), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  // Ceiling plane at wall height — keeps high-pitch views from seeing void.
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: CEILING_COLOR,
    roughness: 1,
    metalness: 0,
  });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(STORE_WIDTH_M, STORE_DEPTH_M), ceilingMat);
  ceiling.rotation.x = Math.PI / 2; // faces downward
  ceiling.position.y = WALL_HEIGHT_M;
  scene.add(ceiling);

  const wallMat = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.9,
    metalness: 0,
  });

  const addWallBox = (
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = wallMat,
  ): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  const wallY = WALL_HEIGHT_M / 2;
  const northZ = -hd - t / 2;

  // North wall (-Z): two flanks + lintel above a visual doorway gap.
  // The collider for this wall (makeWallBoxes) stays SOLID so the doorway
  // cannot be walked through.
  const outerMinX = -hw - t;
  const gapLeft = DOOR_CENTER_X - DOOR_WIDTH_M / 2;
  const gapRight = DOOR_CENTER_X + DOOR_WIDTH_M / 2;
  const flankW = gapLeft - outerMinX;
  addWallBox(flankW, WALL_HEIGHT_M, t, outerMinX + flankW / 2, wallY, northZ);
  addWallBox(flankW, WALL_HEIGHT_M, t, gapRight + flankW / 2, wallY, northZ);
  const lintelH = WALL_HEIGHT_M - DOOR_HEIGHT_M;
  addWallBox(DOOR_WIDTH_M, lintelH, t, DOOR_CENTER_X, DOOR_HEIGHT_M + lintelH / 2, northZ);

  // Decorative door frame (dark warm wood): two posts + head.
  const frameMat = new THREE.MeshStandardMaterial({
    color: DOOR_FRAME_COLOR,
    roughness: 0.8,
    metalness: 0,
  });
  const postW = 0.14;
  const postD = 0.12;
  const postZ = -hd + postD / 2; // flush with the interior wall face
  addWallBox(postW, DOOR_HEIGHT_M, postD, gapLeft + postW / 2, DOOR_HEIGHT_M / 2, postZ, frameMat);
  addWallBox(postW, DOOR_HEIGHT_M, postD, gapRight - postW / 2, DOOR_HEIGHT_M / 2, postZ, frameMat);
  addWallBox(DOOR_WIDTH_M + postW, postW, postD, DOOR_CENTER_X, DOOR_HEIGHT_M + postW / 2, postZ, frameMat); // head, centred on door top

  // Dark plane behind the doorway — reads as a stockroom doorway into dark.
  const voidMat = new THREE.MeshBasicMaterial({ color: DOOR_VOID_COLOR });
  const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_WIDTH_M, DOOR_HEIGHT_M), voidMat);
  voidPlane.position.set(DOOR_CENTER_X, DOOR_HEIGHT_M / 2, -hd - t + 0.01);
  scene.add(voidPlane);

  // South wall (+Z): full outer span, covering the corners.
  addWallBox(STORE_WIDTH_M + 2 * t, WALL_HEIGHT_M, t, 0, wallY, hd + t / 2);
  // West / east walls (-X / +X): inner depth only, between north and south walls.
  addWallBox(t, WALL_HEIGHT_M, STORE_DEPTH_M, -hw - t / 2, wallY, 0);
  addWallBox(t, WALL_HEIGHT_M, STORE_DEPTH_M, hw + t / 2, wallY, 0);

  // Colliders match the wall boxes exactly (doorway included as solid).
  return makeWallBoxes(STORE_WIDTH_M, STORE_DEPTH_M, WALL_THICKNESS_M);
}
