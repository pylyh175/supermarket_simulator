// Customer crowd in 3D. Shoppers come in through the doorway (door chime),
// browse a few shelves along the aisle lanes, join a visible queue of up to
// three behind the till, get served, and walk out carrying their bag.
//
// Cozy rules: nobody gets angry or leaves unserved. A customer kept waiting
// just checks their phone. Shoppers pause and say "tumpang lalu" when the
// player blocks their way.
//
// Speech bubbles and name pills are DOM elements projected above the heads
// every frame (#labels layer).
import * as THREE from "three";
import { makeCustomer, type Customer } from "../customers/generate";
import { line, type Moment } from "../customers/dialogue";
import { greetingFor, spawnIntervalS } from "./shift";
import {
  BROWSE_STOPS,
  QUEUE_SLOTS,
  ROUTE_NODES,
  findPath,
  pathPoints,
  type Point,
} from "./storeRoute";
import {
  RIG_HEAD_TOP_M,
  buildRig,
  setCarry,
  setHandProp,
  type Carry,
  type HandProp,
  type Rig,
} from "./customerRig";

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------
/** Shoppers in the building at once (browsing + queueing + at the till). */
const MAX_IN_STORE = 8;
const FIRST_SPAWN_DELAY_S = 2.5;
const WALK_SPEED_MPS = 1.1;
const TURN_RATE_RAD_S = 7;
const ARRIVE_EPS_M = 0.06;
const BROWSE_PAUSE_S: [number, number] = [2.2, 4.8];
const BROWSE_STOPS_PER_VISIT: [number, number] = [1, 3];
const PLAYER_BLOCK_RADIUS_M = 0.75;
const NPC_BLOCK_RADIUS_M = 0.55;
const EXCUSE_ME_AFTER_S = 0.6;
const GIVE_UP_BLOCK_S = 4;
const WAIT_FIDGET_S = 14;

// Bubble / label projection.
const NDC_MARGIN = 1.05;
const NAME_PILL_RANGE_M = 3.5;

export type GestureKind = "reach" | "give" | "receive" | "pick" | "tap" | "wave";

type AgentState =
  | "entering"
  | "browsing"
  | "toQueue"
  | "queued"
  | "atTill"
  | "serving"
  | "leaving";

interface Gesture {
  kind: GestureKind;
  t: number;
  duration: number;
  prop: HandProp;
  /** Held: stays at full pose after ramping in until released. */
  hold?: boolean;
}

interface Agent {
  customer: Customer;
  rig: Rig;
  label: HTMLDivElement;
  bubble: HTMLDivElement;
  bubbleS: number;
  state: AgentState;
  /** World waypoints still to walk. */
  path: Point[];
  /** Route node the agent is on (or last left). */
  node: string;
  /** Pending browse stops for this visit. */
  stopsLeft: number;
  pauseS: number;
  /** When paused at a shelf: the point to face. */
  lookAt: Point | null;
  queueSlot: number;
  yaw: number;
  walkPhase: number;
  idlePhase: number;
  speed: number;
  gesture: Gesture | null;
  carry: Carry;
  blockedS: number;
  saidExcuse: boolean;
  waitS: number;
  nextFidgetS: number;
  arrived: boolean;
  /** Step back to this lane node after a browse stop. */
  returnTo: string | null;
}

/** What the till drives on the customer it is serving. */
export interface CustomerAvatar {
  readonly customer: Customer;
  readonly group: THREE.Group;
  say(text: string, seconds?: number): void;
  sayMoment(moment: Moment, extra?: { amount?: string; bags?: number }): void;
  /** `hold` keeps the arm out (e.g. offering cash) until `releaseGesture()`. */
  gesture(kind: GestureKind, prop?: HandProp, durationS?: number, hold?: boolean): void;
  /** Lower a held gesture's arm (ramps out). */
  releaseGesture(): void;
  setHandProp(prop: HandProp): void;
  setCarry(carry: Carry): void;
  /** World position of the right hand (where cash / cards change hands). */
  handWorldPosition(target: THREE.Vector3): THREE.Vector3;
}

export class Customers3D {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly labelsRoot: HTMLDivElement;
  private readonly scratch = new THREE.Vector3();
  private readonly agents: Agent[] = [];
  private spawnTimerS = FIRST_SPAWN_DELAY_S;
  private nextId = 1;
  private lastName: string | null = null;
  private clockMinutes = 9 * 60;
  /** Bumped on every spawn/despawn so main.ts can refresh hover occluders. */
  version = 0;
  /** Fired when a shopper walks in (door chime). */
  onArrive: (() => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.labelsRoot = ensureLabelsRoot();
  }

  /** Per frame. `open` = doors open (new shoppers may come in). */
  update(dt: number, playerPos: THREE.Vector3, clockMinutes: number, open: boolean): void {
    this.clockMinutes = clockMinutes;
    if (open) {
      this.spawnTimerS -= dt;
      if (this.spawnTimerS <= 0 && this.agents.length < MAX_IN_STORE) {
        this.spawn();
        this.spawnTimerS = spawnIntervalS(clockMinutes) * (0.75 + Math.random() * 0.5);
      }
    }
    for (const agent of [...this.agents]) this.updateAgent(agent, dt, playerPos);
    for (const agent of this.agents) this.updateOverlay(agent, playerPos, dt);
  }

  /** The customer standing at the till, ready or being served. */
  getTillCustomer(): CustomerAvatar | null {
    const agent = this.agents.find((a) => (a.state === "atTill" || a.state === "serving") && a.arrived);
    return agent ? this.avatarFor(agent) : null;
  }

  /** waiting → serving. False if nobody is ready at the till. */
  beginService(): boolean {
    const agent = this.agents.find((a) => a.state === "atTill" && a.arrived);
    if (!agent) return false;
    agent.state = "serving";
    agent.waitS = 0;
    setHandProp(agent.rig, null);
    return true;
  }

  /** serving → leaving; the queue shuffles forward. */
  completeService(paid: boolean): void {
    const agent = this.agents.find((a) => a.state === "serving");
    if (!agent) return;
    agent.state = "leaving";
    agent.gesture = null;
    setHandProp(agent.rig, null);
    agent.carry = paid ? (agent.customer.bagsWanted > 0 ? "bag-plastic" : "bag-own") : null;
    setCarry(agent.rig, agent.carry);
    this.say(agent, line(paid ? "leave" : "void", { rng: Math.random }), 2.4);
    agent.path = [...pathPoints(["exit"]), ...pathPoints(findPath("exit", "door"))];
    agent.node = "door";
    agent.queueSlot = -1;
    this.shuffleQueue();
  }

  /** Nobody browsing, queueing or at the till. */
  storeEmpty(): boolean {
    return this.agents.length === 0;
  }

  /** Customers still to serve (queued or at the till). */
  waitingCount(): number {
    return this.agents.filter((a) => a.queueSlot >= 0).length;
  }

  /** New day: clear everyone out instantly. */
  reset(): void {
    for (const agent of [...this.agents]) this.despawn(agent);
    this.spawnTimerS = FIRST_SPAWN_DELAY_S;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private spawn(): void {
    const customer = makeCustomer(this.nextId, Math.random, this.lastName);
    this.nextId += 1;
    this.lastName = customer.name;
    const rig = buildRig(customer.look);
    const door = ROUTE_NODES.door;
    rig.root.position.set(door.x, 0, door.z);
    rig.root.rotation.y = 0;
    this.scene.add(rig.root);

    const label = document.createElement("div");
    label.className = "customer-label";
    label.textContent = customer.name;
    const bubble = document.createElement("div");
    bubble.className = "customer-bubble";
    bubble.hidden = true;
    this.labelsRoot.append(label, bubble);

    const agent: Agent = {
      customer,
      rig,
      label,
      bubble,
      bubbleS: 0,
      state: "entering",
      path: [],
      node: "door",
      stopsLeft: randRange(BROWSE_STOPS_PER_VISIT[0], BROWSE_STOPS_PER_VISIT[1] + 0.999) | 0,
      pauseS: 0,
      lookAt: null,
      queueSlot: -1,
      yaw: 0,
      walkPhase: Math.random() * Math.PI,
      idlePhase: Math.random() * Math.PI * 2,
      speed: WALK_SPEED_MPS * (0.88 + Math.random() * 0.24),
      gesture: null,
      carry: "basket",
      blockedS: 0,
      saidExcuse: false,
      waitS: 0,
      nextFidgetS: WAIT_FIDGET_S,
      arrived: false,
      returnTo: null,
    };
    setCarry(rig, "basket");
    this.agents.push(agent);
    this.version += 1;
    this.onArrive?.();
    this.planNext(agent);
  }

  private despawn(agent: Agent): void {
    this.scene.remove(agent.rig.root);
    agent.label.remove();
    agent.bubble.remove();
    const i = this.agents.indexOf(agent);
    if (i >= 0) this.agents.splice(i, 1);
    this.version += 1;
  }

  /** Decide where an idle agent walks next: another shelf, or the queue. */
  private planNext(agent: Agent): void {
    if (agent.stopsLeft > 0) {
      const stop = BROWSE_STOPS[Math.floor(Math.random() * BROWSE_STOPS.length)];
      agent.stopsLeft -= 1;
      agent.state = agent.state === "entering" ? "entering" : "browsing";
      agent.path = [...pathPoints(findPath(agent.node, stop.node).slice(1)), { ...stop.stand }];
      agent.node = stop.node;
      agent.returnTo = stop.node;
      agent.lookAt = stop.look;
      return;
    }
    const slot = this.freeQueueSlot();
    if (slot < 0) {
      // Queue full — keep browsing a little longer.
      agent.stopsLeft = 1;
      this.planNext(agent);
      return;
    }
    agent.state = "toQueue";
    agent.queueSlot = slot;
    agent.lookAt = null;
    agent.path = [...pathPoints(findPath(agent.node, "Sc").slice(1)), { ...QUEUE_SLOTS[slot] }];
    agent.node = "Sc";
  }

  private freeQueueSlot(): number {
    const taken = new Set(this.agents.map((a) => a.queueSlot));
    for (let i = 0; i < QUEUE_SLOTS.length; i += 1) if (!taken.has(i)) return i;
    return -1;
  }

  /** The head left: everyone behind steps one slot forward. */
  private shuffleQueue(): void {
    const queued = this.agents
      .filter((a) => a.queueSlot >= 0)
      .sort((a, b) => a.queueSlot - b.queueSlot);
    queued.forEach((agent, index) => {
      if (agent.queueSlot === index) return;
      agent.queueSlot = index;
      if (agent.state === "queued" || agent.state === "atTill") {
        agent.state = index === 0 ? "atTill" : "queued";
        agent.arrived = false;
        agent.path = [{ ...QUEUE_SLOTS[index] }];
      } else if (agent.state === "toQueue") {
        agent.path[agent.path.length - 1] = { ...QUEUE_SLOTS[index] };
      }
    });
  }

  // -------------------------------------------------------------------------
  // Per-frame behaviour
  // -------------------------------------------------------------------------

  private updateAgent(agent: Agent, dt: number, playerPos: THREE.Vector3): void {
    const pos = agent.rig.root.position;
    let moving = false;

    if (agent.path.length > 0) {
      const target = agent.path[0];
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= ARRIVE_EPS_M) {
        pos.x = target.x;
        pos.z = target.z;
        agent.path.shift();
        if (agent.path.length === 0) this.onPathDone(agent);
      } else {
        const dirX = dx / dist;
        const dirZ = dz / dist;
        if (this.isBlocked(agent, dirX, dirZ, playerPos, dt)) {
          agent.walkPhase *= 0.9;
        } else {
          const step = Math.min(dist, agent.speed * dt);
          pos.x += dirX * step;
          pos.z += dirZ * step;
          moving = true;
        }
        this.turnToward(agent, Math.atan2(dirX, dirZ), dt);
      }
    } else if (agent.pauseS > 0) {
      agent.pauseS -= dt;
      if (agent.lookAt) this.turnToward(agent, Math.atan2(agent.lookAt.x - pos.x, agent.lookAt.z - pos.z), dt);
      if (agent.pauseS <= 0) {
        agent.lookAt = null;
        // Step back onto the lane, then pick the next thing to do.
        if (agent.returnTo) {
          agent.path = [{ ...ROUTE_NODES[agent.returnTo] }];
          agent.returnTo = null;
          agent.state = "browsing";
          agent.pauseS = 0;
          agent.arrived = false;
          agent.lookAt = null;
          // Path completion re-enters planNext via onPathDone.
        }
      }
    } else if (agent.state === "queued" || agent.state === "atTill" || agent.state === "serving") {
      // Face the till (queue faces east toward it; the head faces the cashier).
      const faceYaw = agent.queueSlot === 0 ? 0 : Math.atan2(QUEUE_SLOTS[0].x - pos.x, QUEUE_SLOTS[0].z - pos.z);
      this.turnToward(agent, faceYaw, dt);
      if (agent.state !== "serving") this.fidget(agent, dt);
    }

    this.animate(agent, dt, moving);
  }

  private onPathDone(agent: Agent): void {
    switch (agent.state) {
      case "entering":
      case "browsing":
        if (agent.lookAt) {
          agent.pauseS = randRange(BROWSE_PAUSE_S[0], BROWSE_PAUSE_S[1]);
          agent.gesture = { kind: "pick", t: 0, duration: 1.3, prop: null };
          if (Math.random() < 0.25) this.say(agent, line("browse", { rng: Math.random }), 2.6);
        } else {
          this.planNext(agent);
        }
        break;
      case "toQueue":
      case "queued":
      case "atTill":
        agent.arrived = true;
        if (agent.queueSlot === 0) {
          if (agent.state !== "atTill") {
            agent.state = "atTill";
          }
          this.say(agent, line("greet", { rng: Math.random, greeting: greetingFor(this.clockMinutes) }), 2.6);
        } else {
          agent.state = "queued";
        }
        break;
      case "leaving":
        this.despawn(agent);
        break;
      default:
        break;
    }
  }

  private isBlocked(agent: Agent, dirX: number, dirZ: number, playerPos: THREE.Vector3, dt: number): boolean {
    const pos = agent.rig.root.position;
    let blocked = false;
    // The player standing in the way.
    const px = playerPos.x - pos.x;
    const pz = playerPos.z - pos.z;
    const pd = Math.hypot(px, pz);
    if (pd < PLAYER_BLOCK_RADIUS_M && (px * dirX + pz * dirZ) / Math.max(pd, 1e-3) > 0.35) {
      blocked = true;
      if (agent.blockedS > EXCUSE_ME_AFTER_S && !agent.saidExcuse) {
        agent.saidExcuse = true;
        this.say(agent, line("excuseMe", { rng: Math.random }), 2.2);
      }
    }
    // Another shopper right ahead (only yield to the one in front).
    if (!blocked) {
      for (const other of this.agents) {
        if (other === agent) continue;
        const ox = other.rig.root.position.x - pos.x;
        const oz = other.rig.root.position.z - pos.z;
        const od = Math.hypot(ox, oz);
        if (od < NPC_BLOCK_RADIUS_M && (ox * dirX + oz * dirZ) / Math.max(od, 1e-3) > 0.6) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) {
      agent.blockedS += dt;
      // Never deadlock: after a while, squeeze past.
      if (agent.blockedS > GIVE_UP_BLOCK_S) return false;
      return true;
    }
    agent.blockedS = 0;
    agent.saidExcuse = false;
    return false;
  }

  private fidget(agent: Agent, dt: number): void {
    agent.waitS += dt;
    if (agent.waitS < agent.nextFidgetS) return;
    agent.nextFidgetS = agent.waitS + WAIT_FIDGET_S * (0.8 + Math.random() * 0.6);
    // Checks their phone, maybe hums. Never gets cross.
    agent.gesture = { kind: "give", t: 0, duration: 2.8, prop: "phone" };
    if (Math.random() < 0.6) this.say(agent, line("waiting", { rng: Math.random }), 2.2);
  }

  private turnToward(agent: Agent, targetYaw: number, dt: number): void {
    let delta = targetYaw - agent.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const maxStep = TURN_RATE_RAD_S * dt;
    agent.yaw += Math.max(-maxStep, Math.min(maxStep, delta));
    agent.rig.root.rotation.y = agent.yaw;
  }

  /** Walk cycle, idle breathing, carried basket arm and gestures. */
  private animate(agent: Agent, dt: number, moving: boolean): void {
    const rig = agent.rig;
    if (moving) {
      agent.walkPhase += dt * agent.speed * 5.6;
    } else {
      // Ease the stride closed instead of snapping.
      agent.walkPhase = agent.walkPhase % Math.PI;
      agent.walkPhase += (Math.round(agent.walkPhase / Math.PI) * Math.PI - agent.walkPhase) * Math.min(1, dt * 8);
    }
    agent.idlePhase += dt * 1.6;
    // Stride fades with the phase easing above, so legs close smoothly.
    const swing = Math.sin(agent.walkPhase);
    rig.legL.rotation.x = swing * 0.55;
    rig.legR.rotation.x = -swing * 0.55;
    rig.body.position.y = moving ? Math.abs(Math.cos(agent.walkPhase)) * 0.025 : Math.sin(agent.idlePhase) * 0.004;
    rig.head.rotation.y = moving ? 0 : Math.sin(agent.idlePhase * 0.4) * 0.12;

    // Left arm: holds the basket / bag slightly out, else swings.
    const carrying = agent.carry !== null;
    rig.armL.rotation.x = carrying ? -0.12 : -swing * 0.4;
    rig.armL.rotation.z = carrying ? 0.16 : 0.04;

    // Right arm: counter-swings with the left leg; a gesture overrides it.
    let armX = swing * 0.4;
    let armZ = -0.04;
    const g = agent.gesture;
    if (g) {
      g.t += dt;
      if (g.hold) g.t = Math.min(g.t, g.duration / 2);
      const u = Math.min(1, g.t / g.duration);
      // Ramp in (0–25 %), hold, ramp out (75–100 %).
      const w = u < 0.25 ? smooth(u / 0.25) : u > 0.75 ? smooth((1 - u) / 0.25) : 1;
      const pose = GESTURE_POSES[g.kind];
      const wiggle = g.kind === "wave" ? Math.sin(g.t * 14) * 0.25 : 0;
      armX = armX * (1 - w) + pose.x * w;
      armZ = armZ * (1 - w) + (pose.z + wiggle) * w;
      setHandProp(rig, w > 0.2 ? g.prop : null);
      if (u >= 1) {
        agent.gesture = null;
        setHandProp(rig, null);
      }
    }
    rig.armR.rotation.x = armX;
    rig.armR.rotation.z = armZ;
  }

  // -------------------------------------------------------------------------
  // Speech + labels
  // -------------------------------------------------------------------------

  private say(agent: Agent, text: string, seconds = 2.8): void {
    agent.bubble.innerHTML = "";
    const name = document.createElement("b");
    name.textContent = agent.customer.name;
    const body = document.createElement("span");
    body.textContent = text;
    agent.bubble.append(name, body);
    agent.bubble.hidden = false;
    agent.bubbleS = seconds + text.length * 0.03;
  }

  private avatarFor(agent: Agent): CustomerAvatar {
    return {
      customer: agent.customer,
      group: agent.rig.root,
      say: (text, seconds) => this.say(agent, text, seconds),
      sayMoment: (moment, extra) =>
        this.say(agent, line(moment, { rng: Math.random, greeting: greetingFor(this.clockMinutes), ...extra })),
      gesture: (kind, prop = null, durationS, hold = false) => {
        agent.gesture = { kind, t: 0, duration: durationS ?? GESTURE_POSES[kind].duration, prop, hold };
      },
      releaseGesture: () => {
        const g = agent.gesture;
        if (!g?.hold) return;
        g.hold = false;
        g.t = Math.max(g.t, g.duration * 0.75);
      },
      setHandProp: (prop) => setHandProp(agent.rig, prop),
      setCarry: (carry) => {
        agent.carry = carry;
        setCarry(agent.rig, carry);
      },
      handWorldPosition: (target) => agent.rig.handR.getWorldPosition(target),
    };
  }

  private updateOverlay(agent: Agent, playerPos: THREE.Vector3, dt: number): void {
    if (agent.bubbleS > 0) {
      agent.bubbleS -= dt;
      if (agent.bubbleS <= 0) agent.bubble.hidden = true;
    }
    const v = this.scratch;
    v.copy(agent.rig.root.position);
    v.y = RIG_HEAD_TOP_M * agent.rig.scale + 0.05;
    v.project(this.camera);
    const off = v.z > 1 || Math.abs(v.x) > NDC_MARGIN || Math.abs(v.y) > NDC_MARGIN;
    const near =
      Math.hypot(playerPos.x - agent.rig.root.position.x, playerPos.z - agent.rig.root.position.z) < NAME_PILL_RANGE_M;
    const showBubble = !off && !agent.bubble.hidden;
    const showLabel = !off && near && agent.bubble.hidden;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    agent.bubble.style.visibility = showBubble ? "visible" : "hidden";
    if (showBubble) agent.bubble.style.transform = transform;
    agent.label.style.display = showLabel ? "block" : "none";
    if (showLabel) agent.label.style.transform = transform;
  }
}

const GESTURE_POSES: Record<GestureKind, { x: number; z: number; duration: number }> = {
  reach: { x: -0.85, z: 0.25, duration: 0.6 },
  give: { x: -1.35, z: 0.05, duration: 1.3 },
  receive: { x: -1.2, z: -0.05, duration: 1.0 },
  pick: { x: -1.25, z: 0.1, duration: 1.3 },
  tap: { x: -1.15, z: 0.12, duration: 1.4 },
  wave: { x: -2.6, z: -0.3, duration: 1.4 },
};

function smooth(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------
// #labels overlay — click-through DOM layer for name pills + speech bubbles.
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
        padding: 2px 10px 3px;
        border-radius: 999px; border: 1px solid #caa46a;
        background: rgba(253, 246, 233, 0.9);
        color: #4a3b28;
        font: 700 11px/1.5 system-ui, "Segoe UI", "Trebuchet MS", sans-serif;
        letter-spacing: 0.04em; white-space: nowrap;
        box-shadow: 0 1px 4px rgba(46, 32, 12, 0.3);
      }
      .customer-bubble {
        position: absolute; left: 0; top: 0;
        max-width: 230px; padding: 6px 11px 7px;
        border-radius: 14px; border: 2px solid #caa46a;
        background: #fffaf0; color: #3b2d1d;
        font: 600 13px/1.35 system-ui, "Segoe UI", "Trebuchet MS", sans-serif;
        box-shadow: 0 3px 10px rgba(46, 32, 12, 0.28);
        margin-top: -10px;
      }
      .customer-bubble::after {
        content: ""; position: absolute; left: 50%; bottom: -9px;
        transform: translateX(-50%);
        border: 8px solid transparent; border-top-color: #caa46a; border-bottom: 0;
      }
      .customer-bubble b {
        display: block; font-size: 10px; letter-spacing: 0.08em;
        text-transform: uppercase; color: #a1603a; margin-bottom: 1px;
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
