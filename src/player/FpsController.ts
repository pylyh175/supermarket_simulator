// First-person controller: pointer lock on canvas click, mouse-look,
// WASD/arrow walking, circle-vs-AABB collision against the store shell.
//
// Conventions (must match src/player/movement.ts):
//   forward = -Z, right = +X, yaw 0 = facing -Z.
//   Camera rotation order is YXZ (yaw about Y, then pitch about X).
//
// Allocation discipline: the Vector3 exposed via position() is reused and
// overwritten each update — callers must not mutate or retain it. The pure
// movement/collider helpers return small tuples by design (those modules
// are off-limits), so a few tiny fixed-size arrays are created per frame.
import * as THREE from "three";
import { moveVector, eyeHeightM, type MoveKeys } from "./movement";
import { circleAabbResolve, clampToBounds, type Aabb } from "./colliders";

// Comfortable cozy walking pace (brief: ~2.5–3 m/s). Diagonal is already
// normalized inside moveVector, so diagonal walking is not faster.
const MOVE_SPEED_MPS = 2.8;
const PLAYER_RADIUS_M = 0.35;
const MOUSE_SENSITIVITY_RAD_PER_PX = 0.0022;
const PITCH_LIMIT_RAD = (85 * Math.PI) / 180; // ±85° per brief
// Delta clamp (≤ 50 ms) so a tab-switch resume can't tunnel the player
// through walls — also enforced by the caller, belt and braces.
const MAX_DELTA_S = 0.05;

// Interior bounds (20 × 14 m, centred on origin) — matches storeShell.ts.
const DEFAULT_BOUNDS: Aabb = { minX: -10, minZ: -7, maxX: 10, maxZ: 7 };

// Spawn near the entrance side (+Z), facing into the store (-Z).
const SPAWN_X = 0;
const SPAWN_Z = 4;

export class FpsController {
  // Not readonly: buildStore() resolves after construction, so main.ts swaps
  // in the merged shell+prop collider list via setColliders() once the store
  // finishes building. Walls-only colliders are valid until then.
  private colliders: Aabb[];
  private readonly canvas: HTMLCanvasElement;
  private readonly bounds: Aabb;

  private sensitivity = 1;
  private yawRad = 0;   // 0 = facing -Z
  private pitchRad = 0; // 0 = level

  private readonly keys: MoveKeys = { forward: false, back: false, left: false, right: false };
  private readonly pos = new THREE.Vector3(SPAWN_X, eyeHeightM(), SPAWN_Z);
  // Reused scratch tuple for collision resolution (no per-frame Vector3s).
  private readonly resolvePos: [number, number] = [SPAWN_X, SPAWN_Z];

  constructor(colliders: Aabb[], canvas: HTMLCanvasElement, bounds?: Aabb) {
    this.colliders = colliders;
    this.canvas = canvas;
    this.bounds = bounds ?? DEFAULT_BOUNDS;

    canvas.addEventListener("click", this.onClick);
    document.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    // Alt-tab while holding a key would otherwise leave it stuck "held".
    window.addEventListener("blur", this.onBlur);
  }

  yaw(): number {
    return this.yawRad;
  }

  /** Mouse-look multiplier from settings (1 = default). */
  setSensitivity(multiplier: number): void {
    this.sensitivity = multiplier;
  }

  /** Release any held movement keys (e.g. when the till takes over input). */
  releaseKeys(): void {
    this.onBlur();
  }

  /** Set the absolute camera orientation (yaw, pitch in radians). */
  setOrientation(yaw: number, pitch: number): void {
    this.yawRad = yaw;
    this.pitchRad = Math.max(-PITCH_LIMIT_RAD, Math.min(PITCH_LIMIT_RAD, pitch));
  }

  /** Replace the active collider list (e.g. walls → walls + store props). */
  setColliders(colliders: Aabb[]): void {
    this.colliders = colliders;
  }

  pitch(): number {
    return this.pitchRad;
  }

  /** Reused vector at eye height — do not mutate. */
  position(): THREE.Vector3 {
    return this.pos;
  }

  update(dt: number): void {
    const dtClamped = Math.min(Math.max(dt, 0), MAX_DELTA_S);

    const [vx, , vz] = moveVector(this.keys, this.yawRad, MOVE_SPEED_MPS);
    this.resolvePos[0] = this.pos.x + vx * dtClamped;
    this.resolvePos[1] = this.pos.z + vz * dtClamped;

    // Push out of every wall box, then clamp to the interior as a backstop.
    for (const box of this.colliders) {
      const resolved = circleAabbResolve(this.resolvePos, PLAYER_RADIUS_M, box);
      this.resolvePos[0] = resolved[0];
      this.resolvePos[1] = resolved[1];
    }
    const [cx, cz] = clampToBounds(this.resolvePos, PLAYER_RADIUS_M, this.bounds);
    this.pos.set(cx, eyeHeightM(), cz);
  }

  private readonly onClick = (): void => {
    if (document.pointerLockElement === this.canvas) return;
    try {
      // Must be called from a user gesture. Chrome returns a Promise that
      // rejects on denial/post-Esc cooldown — swallow it so the expected
      // denial path can't surface as an unhandled rejection. Firefox/Safari
      // may return undefined; the optional call handles either case.
      const result = this.canvas.requestPointerLock() as Promise<void> | undefined;
      result?.catch?.(() => {});
    } catch {
      // Pointer lock unavailable/denied — game stays playable without look.
    }
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yawRad -= e.movementX * MOUSE_SENSITIVITY_RAD_PER_PX * this.sensitivity;
    this.pitchRad -= e.movementY * MOUSE_SENSITIVITY_RAD_PER_PX * this.sensitivity;
    this.pitchRad = Math.max(-PITCH_LIMIT_RAD, Math.min(PITCH_LIMIT_RAD, this.pitchRad));
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.setKey(e.code, true) && e.code.startsWith("Arrow")) {
      e.preventDefault(); // keep the page from scrolling on arrows
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.setKey(e.code, false);
  };

  private readonly onBlur = (): void => {
    this.keys.forward = false;
    this.keys.back = false;
    this.keys.left = false;
    this.keys.right = false;
  };

  private setKey(code: string, down: boolean): boolean {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        this.keys.forward = down;
        return true;
      case "KeyS":
      case "ArrowDown":
        this.keys.back = down;
        return true;
      case "KeyA":
      case "ArrowLeft":
        this.keys.left = down;
        return true;
      case "KeyD":
      case "ArrowRight":
        this.keys.right = down;
        return true;
      default:
        return false;
    }
  }
}
