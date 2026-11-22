// Customer flow in 3D: queue → walk in → wait at the till → (service) →
// walk out. One customer is on the floor at a time; the rest wait in an
// off-screen queue built from makeQueue(). Names render as DOM labels
// projected to screen space every frame (see #labels in ensureLabelsRoot).
// No timers, no impatience — the customer waits patiently.
import * as THREE from "three";
import { makeQueue, type Customer } from "../customers/generate";
import { STORE_DEPTH_M } from "../three/storeShell";
import { TILL_X, TILL_Z } from "../three/storeLayout";
import type { ServingState } from "./TillStation";

// ---------------------------------------------------------------------------
// Layout / pacing constants
// ---------------------------------------------------------------------------
const QUEUE_SIZE = 10;
/** Top the queue back up to QUEUE_SIZE whenever it drops to this or fewer. */
const REFILL_THRESHOLD = 3;

/** Cozy, unhurried pace. */
const WALK_SPEED_MPS = 1.2;
const ARRIVE_EPSILON_M = 0.05;

/** Customer stands just north of the counter, clear of its north face. */
const QUEUE_HEAD_Z = TILL_Z - 0.85;
/** Doorway on the north wall, centred on x = 0 (see storeShell.ts). */
const ENTRANCE_X = 0;
const ENTRANCE_Z = -(STORE_DEPTH_M / 2) + 0.1;

/** What the variant builder spawns: feet sit this far above the group's y = 0. */
const FIGURE_FOOT_OFFSET_M = 0.49;
/** Uniform boost on top of each variant's baked scale — adults, not children. */
const FIGURE_SCALE = 1.35;

// Idle bob budget — tiny on purpose.
const BOB_WALK_FREQUENCY = 6.5; // rad/s while walking
const BOB_WALK_AMPLITUDE_M = 0.035;
const BOB_IDLE_FREQUENCY = 1.5; // rad/s while waiting/serving (breathing)
const BOB_IDLE_AMPLITUDE_M = 0.012;

// DOM label anchor: local (pre-scale) height above the group origin. Lands a
// hand's-width above the hairline once scaled.
const LABEL_ANCHOR_LOCAL_M = 1.78;
/** Hide the label when the anchor projects outside this NDC margin. */
const NDC_VISIBLE_MARGIN = 1.05;

export interface CustomerAvatar {
  readonly customer: Customer;
  readonly group: THREE.Group;
  readonly label: HTMLDivElement;
  /** Group y that puts feet on the floor (bobbing adds to this). */
  readonly baseY: number;
  /** Procedural arms for handoff animations. */
  readonly arms: {
    left: THREE.Group;
    right: THREE.Group;
    leftHand: THREE.Mesh;
    rightHand: THREE.Mesh;
  } | null;
}

export class Customers3D {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly customerVariants: THREE.Group[];
  private readonly labelsRoot: HTMLDivElement;
  /** Reused for projection — never allocate in the frame loop. */
  private readonly scratch = new THREE.Vector3();

  private readonly queue: Customer[];
  private variantCursor = 0;
  private active: CustomerAvatar | null = null;
  private state: ServingState = "walking-in";
  private bobPhase = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, customerVariants: THREE.Group[]) {
    this.scene = scene;
    this.camera = camera;
    this.customerVariants = customerVariants;
    this.queue = makeQueue(QUEUE_SIZE);
    this.labelsRoot = ensureLabelsRoot();
  }

  /** Current serve-flow state — drives the till E-key gate in main.ts. */
  getState(): ServingState {
    return this.state;
  }

  /** The customer currently on the floor, or null during spawn gaps. */
  getActiveCustomer(): Customer | null {
    return this.active?.customer ?? null;
  }

  /** The customer avatar currently on the floor (with arms for handoff). */
  getActiveCustomerAvatar(): CustomerAvatar | null {
    return this.active ?? null;
  }

  /**
   * Spawn the head of the queue at the entrance. No-op when a customer is
   * already on the floor (never two at once, never the same one twice).
   */
  spawnNextCustomer(): void {
    if (this.active) {
      console.warn("[customers3d] A customer is already on the floor — spawn skipped.");
      return;
    }
    if (this.customerVariants.length === 0) {
      console.warn("[customers3d] Asset bundle has no customer variants — spawn skipped.");
      return;
    }
    this.refillQueueIfLow();

    const customer = this.queue.shift();
    this.refillQueueIfLow();
    if (!customer) {
      console.warn("[customers3d] Queue is empty — no customer spawned.");
      return;
    }

    const variant = this.customerVariants[this.variantCursor % this.customerVariants.length];
    this.variantCursor += 1;

    const figure = variant.clone(true);
    figure.scale.multiplyScalar(FIGURE_SCALE);
    const baseY = -FIGURE_FOOT_OFFSET_M * figure.scale.x;
    figure.position.set(ENTRANCE_X, baseY, ENTRANCE_Z);
    figure.rotation.y = 0; // faces +Z — walks into the store, toward the till
    this.scene.add(figure);

    // Add procedural arms for handoff animations
    const arms = createProceduralArms(figure.scale.x);
    figure.add(arms.left);
    figure.add(arms.right);

    const label = document.createElement("div");
    label.className = "customer-label";
    label.textContent = customer.name;
    this.labelsRoot.appendChild(label);

    this.active = { customer, group: figure, label, baseY, arms };
    this.state = "walking-in";
    this.bobPhase = 0;
    console.log(`[customers3d] ${customer.name} walks in (${customer.basket.length} items).`);
  }

  /**
   * Move the active customer one frame. Call from the render loop with the
   * clamped frame delta.
   */
  update(dt: number): void {
    const active = this.active;
    if (!active) return;

    const walking = this.state === "walking-in" || this.state === "walking-out";
    this.bobPhase += dt * (walking ? BOB_WALK_FREQUENCY : BOB_IDLE_FREQUENCY);

    if (this.state === "walking-in") {
      this.walkToward(active, TILL_X, QUEUE_HEAD_Z, false, dt);
    } else if (this.state === "walking-out") {
      this.walkToward(active, ENTRANCE_X, ENTRANCE_Z, true, dt);
    }
    // "waiting" / "serving": the customer stands at the till, bobbing gently.

    // Arrival while leaving despawns (removes group + label, spawns the
    // next customer) — nothing left to bob or project.
    if (this.active !== active) return;

    // Bob: walking bounces above the base; idling sways around it.
    const amplitude = walking ? BOB_WALK_AMPLITUDE_M : BOB_IDLE_AMPLITUDE_M;
    const lift = walking
      ? Math.abs(Math.sin(this.bobPhase)) * amplitude
      : Math.sin(this.bobPhase) * amplitude;
    active.group.position.y = active.baseY + lift;

    this.updateLabel(active);
  }

  /**
   * Flip waiting → serving. Returns false when the customer is not waiting,
   * so a second E press (or a press before arrival) can't double-launch.
   */
  beginService(): boolean {
    if (this.state !== "waiting" || !this.active) return false;
    this.state = "serving";
    console.log(`[customers3d] Serving ${this.active.customer.name}.`);
    return true;
  }

  /**
   * Flip serving → walking-out: the customer leaves, the next one walks in.
   * Task 7 calls this when the till overlay closes; there is no close path
   * in this task yet, so "serving" intentionally persists until then.
   */
  completeService(): boolean {
    if (this.state !== "serving" || !this.active) return false;
    this.state = "walking-out";
    console.log(`[customers3d] ${this.active.customer.name} leaves, gembira.`);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private refillQueueIfLow(): void {
    if (this.queue.length > REFILL_THRESHOLD) return;
    this.queue.push(...makeQueue(QUEUE_SIZE - this.queue.length));
  }

  private walkToward(
    active: CustomerAvatar,
    targetX: number,
    targetZ: number,
    leaving: boolean,
    dt: number,
  ): void {
    const position = active.group.position;
    const dx = targetX - position.x;
    const dz = targetZ - position.z;
    const distance = Math.hypot(dx, dz);
    const step = WALK_SPEED_MPS * dt;

    if (distance <= Math.max(ARRIVE_EPSILON_M, step)) {
      position.set(targetX, active.baseY, targetZ);
      if (leaving) {
        this.despawn(active);
      } else {
        this.state = "waiting";
        active.group.rotation.y = 0; // face +Z — toward the cashier/player
        console.log(`[customers3d] ${active.customer.name} waits at the till.`);
      }
      return;
    }

    const dirX = dx / distance;
    const dirZ = dz / distance;
    position.x += dirX * step;
    position.z += dirZ * step;
    active.group.rotation.y = Math.atan2(dirX, dirZ); // face along travel (+Z front)
  }

  private despawn(active: CustomerAvatar): void {
    this.scene.remove(active.group);
    active.label.remove();
    this.active = null;
    // Clones share geometry/materials with the bundle variants — never dispose.
    this.spawnNextCustomer();
  }

  private updateLabel(active: CustomerAvatar): void {
    const vector = this.scratch;
    vector.copy(active.group.position);
    vector.y += LABEL_ANCHOR_LOCAL_M * active.group.scale.x;
    vector.project(this.camera);

    const offScreen =
      vector.z > 1 ||
      vector.x < -NDC_VISIBLE_MARGIN ||
      vector.x > NDC_VISIBLE_MARGIN ||
      vector.y < -NDC_VISIBLE_MARGIN ||
      vector.y > NDC_VISIBLE_MARGIN;
    if (offScreen) {
      if (active.label.style.display !== "none") active.label.style.display = "none";
      return;
    }

    const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
    active.label.style.display = "block";
    active.label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  }
}

// ---------------------------------------------------------------------------
// Procedural arms for handoff animations
// ---------------------------------------------------------------------------

const ARM_LENGTH_M = 0.35;
const ARM_RADIUS_M = 0.025;
const HAND_RADIUS_M = 0.03;

function createProceduralArms(scale: number): {
  left: THREE.Group;
  right: THREE.Group;
  leftHand: THREE.Mesh;
  rightHand: THREE.Mesh;
} {
  const armMat = new THREE.MeshLambertMaterial({ color: 0xd4a574, flatShading: true });
  const handMat = new THREE.MeshLambertMaterial({ color: 0xe8c898, flatShading: true });

  const createArm = (side: number) => {
    const group = new THREE.Group();
    group.name = side > 0 ? "arm-right" : "arm-left";

    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(ARM_RADIUS_M * scale, ARM_RADIUS_M * scale, ARM_LENGTH_M * 0.6 * scale, 8),
      armMat,
    );
    upperArm.position.y = -ARM_LENGTH_M * 0.3 * scale;
    group.add(upperArm);

    const lowerArm = new THREE.Mesh(
      new THREE.CylinderGeometry(ARM_RADIUS_M * 0.9 * scale, ARM_RADIUS_M * 0.9 * scale, ARM_LENGTH_M * 0.4 * scale, 8),
      armMat,
    );
    lowerArm.position.y = -ARM_LENGTH_M * 0.6 * scale - ARM_LENGTH_M * 0.2 * scale;
    group.add(lowerArm);

    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(HAND_RADIUS_M * scale, 8, 6),
      handMat,
    );
    hand.position.y = -ARM_LENGTH_M * scale;
    group.add(hand);

    return { group, hand };
  };

  const left = createArm(-1);
  const right = createArm(1);

  const shoulderY = 0.7 * scale;
  const shoulderX = 0.18 * scale;

  left.group.position.set(-shoulderX, shoulderY, 0.05 * scale);
  right.group.position.set(shoulderX, shoulderY, 0.05 * scale);

  left.group.rotation.x = 0;
  right.group.rotation.x = 0;

  return {
    left: left.group,
    right: right.group,
    leftHand: left.hand,
    rightHand: right.hand,
  };
}

/** Animate customer arms for cash handoff. */
export function animateCustomerHandoff(
  customer: { arms: ReturnType<typeof createProceduralArms> | null },
  type: "give" | "receive",
  onMidpoint?: () => void,
): void {
  if (!customer.arms) return;
  const { left, right } = customer.arms;
  const isGive = type === "give";

  const duration = 0.8;
  let elapsed = 0;

  const startRightX = right.rotation.x;
  const targetRightX = isGive ? -Math.PI / 2.5 : -Math.PI / 3;
  const startRightZ = right.position.z;
  const targetRightZ = isGive ? 0.15 : 0.1;
  const startLeftX = left.rotation.x;

  const animate = (dt: number): void => {
    elapsed += dt;
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - t, 3);

    right.rotation.x = startRightX + (targetRightX - startRightX) * eased;
    right.position.z = startRightZ + (targetRightZ - startRightZ) * eased;
    left.rotation.x = startLeftX * 0.3 * eased;

    if (t >= 0.5 && onMidpoint) {
      onMidpoint();
      onMidpoint = undefined;
    }

    if (t < 1) {
      requestAnimationFrame(() => animate(1 / 60));
    } else {
      setTimeout(() => {
        returnArmsToRest(customer.arms!);
      }, 400);
    }
  };

  animate(0);
}

function returnArmsToRest(arms: ReturnType<typeof createProceduralArms>): void {
  const { left, right } = arms;
  const duration = 0.5;
  let elapsed = 0;
  const startLeftX = left.rotation.x;
  const startRightX = right.rotation.x;
  const startRightZ = right.position.z;

  const animate = (dt: number): void => {
    elapsed += dt;
    const t = Math.min(1, elapsed / duration);
    const eased = t * t * (3 - 2 * t);

    left.rotation.x = startLeftX * (1 - eased);
    right.rotation.x = startRightX * (1 - eased);
    right.position.z = startRightZ * (1 - eased);

    if (t < 1) {
      requestAnimationFrame(() => animate(1 / 60));
    }
  };

  animate(0);
}

// ---------------------------------------------------------------------------
// #labels overlay — an absolutely positioned, click-through DOM layer on top
// of the canvas. Reuses an existing #labels if the page provides one;
// otherwise creates it (and its CSS, once) from JS so index.html stays
// untouched.
// ---------------------------------------------------------------------------
const LABELS_ROOT_ID = "labels";
const LABELS_STYLE_ID = "customer-labels-style";

function ensureLabelsRoot(): HTMLDivElement {
  if (!document.getElementById(LABELS_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = LABELS_STYLE_ID;
    style.textContent = `
      #${LABELS_ROOT_ID} {
        position: fixed; inset: 0; z-index: 5;
        pointer-events: none; overflow: hidden;
      }
      .customer-label {
        position: absolute; left: 0; top: 0;
        transform: translate(-50%, -100%);
        padding: 2px 12px 3px;
        border-radius: 999px; border: 1px solid #caa46a;
        background: rgba(253, 246, 233, 0.94);
        color: #4a3b28;
        font: 700 12px/1.5 system-ui, "Segoe UI", "Trebuchet MS", sans-serif;
        letter-spacing: 0.04em; white-space: nowrap;
        box-shadow: 0 1px 4px rgba(46, 32, 12, 0.3);
      }
    `;
    document.head.appendChild(style);
  }

  const existing = document.getElementById(LABELS_ROOT_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const root = document.createElement("div");
  root.id = LABELS_ROOT_ID;
  document.body.appendChild(root);
  return root;
}
