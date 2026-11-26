// Cashier POS station — the till the player works.
//
// A small POS stand beside the checkout counter (player's right) carries:
//   • a monitor whose screen is a CanvasTexture in the world (occluded
//     properly, crisp, receipt-style layout),
//   • a green two-line customer display facing the customer,
//   • a POS keypad (decorative — the till is worked with the mouse),
//   • a cash drawer with clickable denomination slots fed by the drawer
//     model (RM200 float, top-ups) that opens and closes by itself, and a
//     change tray (click a piece to put it back, the tray to hand it over),
//   • a stack of plastic bags (click to add one; click a placed bag to
//     remove it),
//   • a DuitNow QR standee, a card terminal and a receipt printer,
//   • a handheld scanner: click it to pick it up, then click the pack at the
//     scan line (or a QR customer's phone) to scan it.
//
// The only keys at the till are Esc (void the sale). Payment is taken by
// clicking what the customer holds out: cash, a card, or a phone pay code.
//
// Every money decision runs through the pure, tested session state machine
// (src/register/session.ts). This module only animates and renders it.
import * as THREE from "three";
import type { Aabb } from "../player/colliders";
import type { CheckoutFlow } from "./checkoutFlow";
import type { CustomerAvatar } from "../game/customers3d";
import type { Customer } from "../customers/generate";
import { describeTender } from "../customers/dialogue";
import { DENOM_LABELS } from "../data/denominations";
import { formatRinggit } from "../register/money";
import { makeChange } from "../register/change";
import {
  addBag,
  confirmElectronic,
  createSession,
  dispense,
  handOverChange,
  receivePayment,
  removeBag,
  scanNext,
  selectPayment,
  undoDispense,
  type PaymentMethod,
  type Session,
} from "../register/session";
import {
  FLOAT_SEN,
  deposit,
  drawerTotalSen,
  lowDenominations,
  startingFloat,
  topUp,
  withdraw,
  type Drawer,
} from "../register/drawer";
import {
  playBeep,
  playCardApproved,
  playCoin,
  playDrawerClose,
  playDrawerOpen,
  playError,
  playNote,
  playPrinter,
  playQrSuccess,
  playSuccess,
} from "../audio/cues";

export const STORE_NAME = "PASARAYA MESRA";
export const STORE_ADDRESS = ["No. 12, Jalan Mesra 3", "70200 Seremban, N. Sembilan"];

// ---------------------------------------------------------------------------
// Stand geometry (metres, local: origin at floor centre, +Z toward the player)
// ---------------------------------------------------------------------------
export const STAND_W = 0.62;
export const STAND_D = 0.52;
const CABINET_H = 0.66;
const HOUSING_H = 0.16;
const TOP_H = 0.04;
const TOP_Y = CABINET_H + HOUSING_H + TOP_H; // 0.86 — work surface
const DRAWER_W = 0.52;
const DRAWER_D = 0.44;
const DRAWER_H = 0.1;
// Slides far enough that the note row clears the work surface above it.
const DRAWER_OPEN_M = 0.46;
const DRAWER_BASE_Z = -0.03;

const MONITOR_W = 0.5;
const MONITOR_H = 0.352;
const MONITOR_Y = 1.25;
const MONITOR_TILT = -0.3;

// Handheld scanner: held at this world height under the cursor; a scan dips
// it over the target for SCAN_SWEEP_S (the scan registers halfway through).
const SCANNER_HOLD_Y = 1.15;
const SCAN_SWEEP_S = 0.3;
const SCAN_AIM_OFFSET = new THREE.Vector3(0, 0.1, 0.06);
/** How close (m) the cursor ray must pass to the customer's hand to take payment. */
const HAND_PICK_RADIUS_M = 0.11;

const KEY_PITCH = 0.05;
const KEY_SIZE = 0.044;
const KEY_REST_Y = TOP_Y + 0.02;
const PRINTER_SLOT_Y = TOP_Y + 0.08;

const SCREEN_PX_W = 1024;
const SCREEN_PX_H = 722;
const VFD_PX_W = 512;
const VFD_PX_H = 128;

// Malaysian notes (current series) and coins (third series) colours.
const NOTE_COLORS: Record<number, string> = {
  10000: "#7b4fa0", // RM100 purple
  5000: "#2f8f8a", // RM50 teal
  2000: "#e08a2e", // RM20 orange
  1000: "#c8463d", // RM10 red
  500: "#4c9a4a", // RM5 green
  100: "#3f6fb5", // RM1 blue
};
const COIN_COLORS: Record<number, string> = {
  50: "#d9b45a", // 50 sen gold
  20: "#d1a94c", // 20 sen brass
  10: "#c9ccd1", // 10 sen silver
  5: "#bfc3c9", // 5 sen silver
};
const DRAWER_NOTES = [5000, 2000, 1000, 500, 100];
const DRAWER_COINS = [50, 20, 10, 5];


const KEY_LAYOUT: { label: string; col: number; row: number; w?: number; color: string }[] = [
  { label: "7", col: 0, row: 0, color: "#3a3328" },
  { label: "8", col: 1, row: 0, color: "#3a3328" },
  { label: "9", col: 2, row: 0, color: "#3a3328" },
  { label: "RM10", col: 3, row: 0, color: "#5b4a2a" },
  { label: "RM20", col: 4, row: 0, color: "#5b4a2a" },
  { label: "CASH", col: 5, row: 0, color: "#2e6b3a" },
  { label: "4", col: 0, row: 1, color: "#3a3328" },
  { label: "5", col: 1, row: 1, color: "#3a3328" },
  { label: "6", col: 2, row: 1, color: "#3a3328" },
  { label: "RM50", col: 3, row: 1, color: "#5b4a2a" },
  { label: "RM100", col: 4, row: 1, color: "#5b4a2a" },
  { label: "QR", col: 5, row: 1, color: "#b0306a" },
  { label: "1", col: 0, row: 2, color: "#3a3328" },
  { label: "2", col: 1, row: 2, color: "#3a3328" },
  { label: "3", col: 2, row: 2, color: "#3a3328" },
  { label: "EXACT", col: 3, row: 2, color: "#5b4a2a" },
  { label: "BAG+", col: 4, row: 2, color: "#3d5a80" },
  { label: "CARD", col: 5, row: 2, color: "#2a5a9a" },
  { label: "0", col: 0, row: 3, color: "#3a3328" },
  { label: "00", col: 1, row: 3, color: "#3a3328" },
  { label: "CLR", col: 2, row: 3, color: "#8a3b2a" },
  { label: "ENTER", col: 3, row: 3, w: 2, color: "#2e6b3a" },
  { label: "BAG−", col: 5, row: 3, color: "#3d5a80" },
];

export interface SaleResult {
  paid: boolean;
  customer: Customer;
  session: Session;
}

interface Flight {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  duration: number;
  arc: number;
  delay: number;
  onDone?: () => void;
}

interface Timer {
  t: number;
  fn: () => void;
}

interface TrayPiece {
  denom: number;
  mesh: THREE.Object3D;
}

type PickHit =
  | { kind: "slot"; denom: number }
  | { kind: "tray" }
  | { kind: "trayPiece"; index: number }
  | { kind: "scanner" }
  | { kind: "bagStack" }
  | { kind: "bag" }
  | { kind: "payment" }
  | { kind: "item"; mesh: THREE.Object3D; ready: boolean };

/** userData.pick tags on clickable stand parts. */
type PickTag = "scanner" | "bagStack" | "bag" | "tray";

// ---------------------------------------------------------------------------
// Piece meshes (notes / coins) — geometry + material cached per denomination
// ---------------------------------------------------------------------------
const pieceGeo = {
  note: new THREE.BoxGeometry(0.12, 0.0025, 0.062),
  // Turned so the printed value on the face reads upright from the cashier side.
  coin: new THREE.CylinderGeometry(0.0115, 0.0115, 0.0035, 18).rotateY(Math.PI / 2),
};
const pieceMats = new Map<number, THREE.Material[]>();

function labelTexture(text: string, bg: string, fg: string, w = 128, h = 64, font = 26): THREE.CanvasTexture {
  const [canvas, ctx] = canvas2d(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `800 ${font}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 1);
  return toTexture(canvas);
}

/** Fewest-pieces breakdown of an amount, e.g. "RM10 + 2×RM1 + 50 sen". */
function changeHintText(sen: number): string {
  const counts = new Map<string, number>();
  for (const d of makeChange(sen)) counts.set(DENOM_LABELS[d], (counts.get(DENOM_LABELS[d]) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${n}×${k}` : k)).join(" + ");
}

/** Banknote face: colour field, pale border and a large value. */
function noteFaceTexture(text: string, color: string): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const [canvas, ctx] = canvas2d(w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,253,245,0.55)";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = "#fffdf5";
  ctx.font = `900 64px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 3);
  return toTexture(canvas);
}

const slotTagGeo = new THREE.PlaneGeometry(1, 1);

/** A flat price-tag strip on the drawer floor naming a slot's denomination. */
function slotTag(text: string, color: string, x: number, z: number, width: number, fg = "#fffdf5"): THREE.Mesh {
  const tag = new THREE.Mesh(
    slotTagGeo,
    new THREE.MeshBasicMaterial({ map: labelTexture(text, color, fg, 256, 80, 52), toneMapped: false }),
  );
  tag.scale.set(width, 0.024, 1);
  tag.rotation.x = -Math.PI / 2 + 0.35; // lies on the floor, tipped toward the cashier
  tag.position.set(x, 0.02, z);
  return tag;
}

function pieceMaterial(denom: number): THREE.Material[] {
  let m = pieceMats.get(denom);
  if (m) return m;
  if (denom >= 100) {
    const color = NOTE_COLORS[denom] ?? "#6fae7c";
    const face = new THREE.MeshLambertMaterial({ map: noteFaceTexture(DENOM_LABELS[denom] ?? "", color) });
    const edge = new THREE.MeshLambertMaterial({ color });
    m = [edge, edge, face, face, edge, edge];
  } else {
    const color = COIN_COLORS[denom] ?? "#cccccc";
    const face = new THREE.MeshLambertMaterial({ map: labelTexture(String(denom), color, "#3a2e1f", 128, 128, 72) });
    const edge = new THREE.MeshLambertMaterial({ color });
    m = [edge, face, face];
  }
  pieceMats.set(denom, m);
  return m;
}

function makePiece(denom: number): THREE.Mesh {
  const m = new THREE.Mesh(denom >= 100 ? pieceGeo.note : pieceGeo.coin, pieceMaterial(denom));
  m.userData.denomSen = denom;
  return m;
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------
export interface CashierMachineOptions {
  /** World position of the stand's floor centre. */
  position: THREE.Vector3;
  checkout: CheckoutFlow | null;
  changeHint: () => boolean;
  toast: (text: string) => void;
}

export class CashierMachine {
  readonly group = new THREE.Group();
  /** Fired when the sale finishes (paid) or is voided. */
  onComplete: ((result: SaleResult) => void) | null = null;

  private readonly opts: CashierMachineOptions;

  // Screens
  private readonly screenCtx: CanvasRenderingContext2D;
  private readonly screenTexture: THREE.CanvasTexture;
  private readonly vfdCtx: CanvasRenderingContext2D;
  private readonly vfdTexture: THREE.CanvasTexture;
  private readonly terminalCtx: CanvasRenderingContext2D;
  private readonly terminalTexture: THREE.CanvasTexture;
  private screenDirty = true;

  // Parts
  private readonly drawerGroup = new THREE.Group();
  private readonly slotHits = new Map<number, THREE.Mesh>();
  private readonly slotStacks = new Map<number, THREE.Group>();
  private readonly trayAnchor = new THREE.Vector3(-0.235, TOP_Y + 0.008, 0.16);
  /** Where cash lands if no customer hand is available (fallback only). */
  private readonly tenderAnchor = new THREE.Vector3(-0.15, TOP_Y + 0.004, -0.19);
  private readonly trayHit: THREE.Mesh;
  private readonly receiptPaper: THREE.Mesh;
  private readonly laser: THREE.Line;
  private readonly laserPositions = new Float32Array(6);
  private readonly scannerTip = new THREE.Object3D();
  private readonly gun = new THREE.Group();
  private readonly holster: THREE.Mesh;
  private readonly gunRestPos = new THREE.Vector3();
  private readonly gunRestQuat = new THREE.Quaternion();
  // Lens down-forward, turned toward the belt on the cashier's left.
  private readonly gunHeldQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.8, 0.5, 0, "YXZ"));
  private readonly holdPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SCANNER_HOLD_Y);
  private readonly bagStack: THREE.Group;
  private readonly placedBagGeo: THREE.BufferGeometry[];
  private readonly placedBagMat = lambert("#f4f4f2");
  private readonly voidPrompt: HTMLDivElement;
  private readonly receiptCard: HTMLDivElement;

  // State
  private drawer: Drawer = startingFloat();
  private floatAddedSen = 0;
  private drawerOpen = false;
  private drawerZ = 0;
  private session: Session | null = null;
  private avatar: CustomerAvatar | null = null;
  private message = "";
  private messageIsError = false;
  private tray: TrayPiece[] = [];
  private placedBags: THREE.Group[] = [];
  private flights: Flight[] = [];
  private timers: Timer[] = [];
  private laserS = 0;
  private receiptS = 0;
  private hovered: THREE.MeshLambertMaterial | null = null;
  private hoveredSlot: THREE.Mesh | null = null;
  private voidOpen = false;
  private finishing = false;
  private scannerHeld = false;
  /** Stand-local point the held scanner follows (under the cursor). */
  private readonly gunTarget = new THREE.Vector3();
  /** > 0 while the scanner dips over a target. */
  private scanS = 0;
  private readonly scanAim = new THREE.Vector3();
  /** The customer is holding out cash / card / phone, waiting for a click. */
  private paymentOffered = false;
  private clockLabel = "";
  private receiptTimers: number[] = [];
  private readonly scratch = new THREE.Vector3();

  constructor(scene: THREE.Scene, opts: CashierMachineOptions) {
    this.opts = opts;
    this.group.name = "pos-stand";
    this.group.position.copy(opts.position);

    let canvas: HTMLCanvasElement;
    [canvas, this.screenCtx] = canvas2d(SCREEN_PX_W, SCREEN_PX_H);
    this.screenTexture = toTexture(canvas);
    [canvas, this.vfdCtx] = canvas2d(VFD_PX_W, VFD_PX_H);
    this.vfdTexture = toTexture(canvas);
    [canvas, this.terminalCtx] = canvas2d(128, 96);
    this.terminalTexture = toTexture(canvas);

    this.buildCabinet();
    this.buildDrawer();
    this.buildMonitor();
    this.buildKeys();
    this.trayHit = this.buildTray();
    this.buildVfd();
    this.buildQrStand();
    this.buildCardTerminal();
    this.receiptPaper = this.buildPrinter();
    this.holster = this.buildScanner();
    this.bagStack = this.buildBagStack();
    this.placedBagGeo = [
      new THREE.BoxGeometry(0.06, 0.08, 0.045).translate(0, 0.04, 0),
      new THREE.TorusGeometry(0.016, 0.003, 4, 8, Math.PI).translate(0, 0.08, 0),
    ];

    const laserGeo = new THREE.BufferGeometry();
    laserGeo.setAttribute("position", new THREE.BufferAttribute(this.laserPositions, 3));
    this.laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85 }));
    this.laser.visible = false;
    this.laser.frustumCulled = false;

    scene.add(this.group, this.laser);
    this.group.updateMatrixWorld(true);

    this.voidPrompt = buildVoidPrompt((yes) => this.answerVoid(yes));
    this.receiptCard = buildReceiptCard();
    this.refreshDrawerStacks();
    this.drawScreen();
    this.drawVfd("SELAMAT DATANG", STORE_NAME);
    this.drawTerminal("READY", "#9fd8a8");
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Solid footprint of the stand for the player controller. */
  colliders(): Aabb[] {
    const p = this.group.position;
    return [{ minX: p.x - STAND_W / 2, maxX: p.x + STAND_W / 2, minZ: p.z - STAND_D / 2, maxZ: p.z + STAND_D / 2 }];
  }

  /**
   * Cashier's-eye camera poses while the till is open: "counter" faces the
   * customer, belt and screen; "drawer" looks down into the open cash drawer.
   */
  cameraPose(view: "counter" | "drawer" = "counter"): { position: THREE.Vector3; target: THREE.Vector3 } {
    const p = this.group.position;
    if (view === "drawer") {
      return {
        position: new THREE.Vector3(p.x - 0.1, 1.6, p.z + 0.7),
        target: new THREE.Vector3(p.x - 0.05, 0.9, p.z + 0.3),
      };
    }
    return {
      position: new THREE.Vector3(p.x - 0.32, 1.72, p.z + 0.5),
      target: new THREE.Vector3(p.x - 0.3, 0.98, p.z - 0.26),
    };
  }

  /** How far the drawer is open, 0 (shut) … 1 (fully out) — drives the camera glance. */
  drawerView(): number {
    return Math.min(1, Math.max(0, this.drawerZ / DRAWER_OPEN_M));
  }

  /** Change owed / on the tray while counting change (null otherwise) — for the HUD panel. */
  changeStatus(): { dueSen: number; onTraySen: number; hint: string | null } | null {
    const s = this.session;
    if (!s || s.phase !== "change") return null;
    const remaining = s.changeDueSen - s.givenSen;
    return {
      dueSen: s.changeDueSen,
      onTraySen: s.givenSen,
      hint: this.opts.changeHint() && remaining > 0 ? changeHintText(remaining) : null,
    };
  }

  isActive(): boolean {
    return this.session !== null;
  }

  isVoidPromptOpen(): boolean {
    return this.voidOpen;
  }

  /** Drawer cash right now, and the float + top-ups that went in today. */
  drawerCount(): { actualSen: number; floatAndTopUpsSen: number } {
    return { actualSen: drawerTotalSen(this.drawer), floatAndTopUpsSen: FLOAT_SEN + this.floatAddedSen };
  }

  /** New day: fresh float. */
  resetDay(): void {
    this.drawer = startingFloat();
    this.floatAddedSen = 0;
    this.refreshDrawerStacks();
  }

  setClockLabel(label: string): void {
    if (label !== this.clockLabel) {
      this.clockLabel = label;
      if (!this.session) this.screenDirty = true;
    }
  }

  begin(avatar: CustomerAvatar): void {
    this.clearSaleVisuals();
    this.avatar = avatar;
    this.session = createSession(avatar.customer.basket);
    this.finishing = false;
    this.paymentOffered = false;
    this.scanS = 0;
    this.setScannerHeld(false);
    this.syncBags();
    this.setMessage("Pick up the scanner, then click each item as it reaches the scan line.");
    avatar.setCarry(null);
    this.opts.checkout?.begin(avatar.customer);
    this.drawVfd("SELAMAT DATANG", STORE_NAME);
    this.drawTerminal("READY", "#9fd8a8");
    const c = avatar.customer;
    this.after(0.9, () => {
      if (this.avatar !== avatar) return;
      if (c.bagsWanted > 0) avatar.sayMoment("wantsBag", { bags: c.bagsWanted });
      else avatar.sayMoment("bringsBag");
    });
  }

  /** Esc at the till: ask before voiding. */
  requestVoid(): void {
    if (!this.session || this.finishing) return;
    this.voidOpen = true;
    this.voidPrompt.hidden = false;
  }

  answerVoid(yes: boolean): void {
    if (!this.voidOpen) return;
    this.voidOpen = false;
    this.voidPrompt.hidden = true;
    if (yes) this.voidSale();
  }

  /** Keyboard input while the till is open: only Esc (void / cancel the void prompt). */
  handleKey(code: string): boolean {
    if (code !== "Escape") return false;
    if (this.voidOpen) this.answerVoid(false);
    else this.requestVoid();
    return true;
  }

  /** Mouse click (pointer unlocked) — scanner, belt pack, bags, customer's payment, drawer, tray. */
  click(raycaster: THREE.Raycaster): void {
    if (!this.session || this.voidOpen || this.finishing) return;
    const hit = this.pick(raycaster);
    if (!hit) return;
    switch (hit.kind) {
      case "scanner":
        this.setScannerHeld(!this.scannerHeld);
        if (this.scannerHeld) this.followCursor(raycaster);
        this.setMessage(
          !this.scannerHeld
            ? "Scanner back in its cradle."
            : this.session.phase === "scanning"
              ? "Scanner in hand — click the item at the scan line."
              : "Scanner in hand.",
        );
        return;
      case "item":
        this.scanItem(hit.mesh, hit.ready);
        return;
      case "bagStack":
        this.changeBags(1);
        return;
      case "bag":
        this.changeBags(-1);
        return;
      case "payment":
        this.takePayment();
        return;
      case "slot":
        this.pickFromDrawer(hit.denom);
        return;
      case "trayPiece":
        this.returnTrayPiece(hit.index);
        return;
      case "tray":
        this.handOverTray();
    }
  }

  /**
   * Mouse move — the held scanner follows the cursor; highlight what a click
   * would do. Returns the CSS cursor to show ("" = default).
   */
  hover(raycaster: THREE.Raycaster | null): string {
    if (this.hovered) this.hovered.emissive.setHex(0x000000);
    this.hovered = null;
    if (this.hoveredSlot) (this.hoveredSlot.material as THREE.MeshBasicMaterial).opacity = 0;
    this.hoveredSlot = null;
    if (!raycaster || !this.session || this.voidOpen) return "";
    if (this.scannerHeld) this.followCursor(raycaster);
    const hit = this.finishing ? null : this.pick(raycaster);
    if (!hit) return "";
    if (hit.kind === "item") return hit.ready ? "pointer" : "not-allowed";
    if (hit.kind === "slot") {
      const mesh = this.slotHits.get(hit.denom);
      if (mesh) {
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.3;
        this.hoveredSlot = mesh;
      }
    }
    const mat =
      hit.kind === "scanner"
        ? this.holster.material
        : hit.kind === "bagStack"
          ? (this.bagStack.children[0] as THREE.Mesh).material
          : hit.kind === "bag"
            ? this.placedBagMat
            : hit.kind === "tray"
              ? this.trayHit.material
              : null;
    if (mat instanceof THREE.MeshLambertMaterial) {
      mat.emissive.setHex(0x4a3600);
      this.hovered = mat;
    }
    return "pointer";
  }

  update(dt: number): void {
    for (let i = 0; i < this.timers.length; i += 1) {
      const timer = this.timers[i];
      timer.t -= dt;
      if (timer.t <= 0) {
        this.timers.splice(i, 1);
        i -= 1;
        timer.fn();
      }
    }
    const target = this.drawerOpen ? DRAWER_OPEN_M : 0;
    this.drawerZ += (target - this.drawerZ) * Math.min(1, dt * 10);
    this.drawerGroup.position.z = DRAWER_BASE_Z + this.drawerZ;
    this.updateScanner(dt);
    this.updateFlights(dt);
    if (this.laserS > 0) {
      this.laserS -= dt;
      if (this.laserS <= 0) this.laser.visible = false;
    }
    if (this.receiptS > 0) {
      this.receiptS = Math.max(0, this.receiptS - dt);
      this.receiptPaper.visible = true;
      this.receiptPaper.scale.y = Math.max(0.02, 1 - this.receiptS);
    }
    if (this.screenDirty) {
      this.screenDirty = false;
      this.drawScreen();
    }
  }

  // -------------------------------------------------------------------------
  // Scanner
  // -------------------------------------------------------------------------

  private setScannerHeld(held: boolean): void {
    if (held === this.scannerHeld) return;
    this.scannerHeld = held;
    this.gunTarget.copy(this.gun.position);
  }

  /** Put the held scanner under the cursor, on a plane just above the belt packs. */
  private followCursor(raycaster: THREE.Raycaster): void {
    const p = raycaster.ray.intersectPlane(this.holdPlane, this.scratch);
    if (!p) return;
    this.group.worldToLocal(p);
    // Stay within arm's reach of the stand (the belt is to the west, −x).
    this.gunTarget.set(THREE.MathUtils.clamp(p.x, -1.6, 0.35), p.y, THREE.MathUtils.clamp(p.z, -0.7, 0.45));
  }

  private updateScanner(dt: number): void {
    if (this.scanS > 0) this.scanS -= dt;
    const k = Math.min(1, dt * (this.scanS > 0 ? 28 : 16));
    if (this.scannerHeld) {
      this.gun.position.lerp(this.scanS > 0 ? this.scanAim : this.gunTarget, k);
      this.gun.quaternion.slerp(this.gunHeldQuat, k);
    } else {
      this.gun.position.lerp(this.gunRestPos, k);
      this.gun.quaternion.slerp(this.gunRestQuat, k);
    }
  }

  /** Dip the held scanner over `point` (world); `onHit` runs as the laser fires. */
  private sweepScanner(point: THREE.Vector3, onHit: () => void): void {
    this.scanS = SCAN_SWEEP_S;
    this.scanAim.copy(point).add(SCAN_AIM_OFFSET);
    this.group.worldToLocal(this.scanAim);
    const target = point.clone();
    const avatar = this.avatar;
    this.after(SCAN_SWEEP_S / 2, () => {
      if (this.avatar !== avatar) return;
      this.flashLaser(target);
      onHit();
    });
  }

  private scanItem(mesh: THREE.Object3D, ready: boolean): void {
    const s = this.session!;
    if (s.phase !== "scanning") return;
    if (!this.scannerHeld) {
      this.setMessage("Pick up the scanner first — click it beside the belt.", true);
      return;
    }
    if (!ready) {
      this.setMessage("That item isn't at the scan line yet…", true);
      return;
    }
    if (this.scanS > 0) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const top = box.getCenter(new THREE.Vector3()).setY(box.max.y);
    this.sweepScanner(top, () => this.scan());
  }

  private scan(): void {
    const s = this.session;
    if (!s || s.phase !== "scanning") return;
    const flow = this.opts.checkout;
    if (flow && flow.isActive() && !flow.canScan()) return;
    const item = s.items[s.scanned];
    this.session = scanNext(s);
    flow?.onItemScanned();
    playBeep();
    this.drawVfd(fitVfd(item.name), `RM${(item.priceSen / 100).toFixed(2).padStart(10)}`);
    if (this.session.phase === "payment") this.onAllScanned();
    else this.setMessage(`${this.session.scanned}/${s.items.length} scanned — click the next item at the scan line.`);
  }

  private onAllScanned(): void {
    const s = this.session!;
    const avatar = this.avatar!;
    const c = avatar.customer;
    this.drawVfd("JUMLAH / TOTAL", `RM${(s.subtotalSen / 100).toFixed(2).padStart(10)}`);
    this.setMessage("All scanned. Bags right? Then take the customer's payment.");
    // A QR customer's phone is scanned with the same scanner — keep it in hand.
    if (c.payment !== "qr") this.after(0.4, () => this.setScannerHeld(false));
    this.after(0.7, () => {
      if (this.avatar !== avatar || !this.session) return;
      if (c.payment === "qr") avatar.sayMoment("payQr");
      else if (c.payment === "card") avatar.sayMoment("payCard");
      else avatar.sayMoment("payCash", { amount: describeTender(c.tender) });
      avatar.gesture("give", c.payment === "cash" ? "note" : c.payment === "card" ? "card" : "phone", 1.0, true);
      this.paymentOffered = true;
      this.setMessage(
        c.payment === "cash"
          ? "Click the cash in the customer's hand."
          : c.payment === "card"
            ? "Click the customer's card to charge it."
            : "Scan the QR on the customer's phone with the scanner.",
      );
    });
  }

  // -------------------------------------------------------------------------
  // Bags
  // -------------------------------------------------------------------------

  private changeBags(delta: 1 | -1): void {
    const s = this.session!;
    const next = delta > 0 ? addBag(s) : removeBag(s);
    if (next === s) {
      this.setMessage(delta > 0 ? "Bags are locked once payment starts." : "No bags to remove.", true);
      playError();
      return;
    }
    this.session = next;
    this.syncBags();
    if (delta > 0 && next.bags > this.avatar!.customer.bagsWanted) this.sayTooManyBags();
    this.setMessage(`Plastic bags: ${next.bags} × 20 sen.`);
  }

  /** Open bags on the customer side of the stand, one per bag on the bill. */
  private syncBags(): void {
    const want = this.session?.bags ?? 0;
    while (this.placedBags.length < want) {
      const i = this.placedBags.length;
      const bag = new THREE.Group();
      for (const g of this.placedBagGeo) bag.add(new THREE.Mesh(g, this.placedBagMat));
      bag.position.set(-0.215 + (i % 3) * 0.06, TOP_Y, -0.2 + Math.floor(i / 3) * 0.075);
      bag.rotation.y = 0.15 * ((i % 3) - 1);
      bag.userData.pick = "bag" satisfies PickTag;
      this.group.add(bag);
      this.placedBags.push(bag);
    }
    while (this.placedBags.length > want) this.group.remove(this.placedBags.pop()!);
  }

  /** "No plastic" from someone with their own bag; "just N" from someone who asked for some. */
  private sayTooManyBags(): void {
    const want = this.avatar!.customer.bagsWanted;
    if (want === 0) this.avatar!.sayMoment("noBagThanks");
    else this.avatar!.sayMoment("tooManyBags", { bags: want });
  }

  /** Bags must match what the customer asked for before payment. */
  private bagsOk(): boolean {
    const s = this.session!;
    const want = this.avatar!.customer.bagsWanted;
    if (s.bags === want) return true;
    playError();
    if (s.bags < want) {
      this.avatar!.sayMoment("bagForgotten", { bags: want });
      this.setMessage(`Customer asked for ${want} plastic bag(s) — click the bag stack.`, true);
    } else {
      this.sayTooManyBags();
      this.setMessage("Too many bags charged — click a bag to take it back.", true);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Payment
  // -------------------------------------------------------------------------

  /** Click on what the customer holds out. The method is the customer's own. */
  private takePayment(): void {
    const s = this.session!;
    const c = this.avatar!.customer;
    if (s.phase !== "payment" || !this.paymentOffered) return;
    if (c.payment === "qr" && !this.scannerHeld) {
      this.setMessage("Pick up the scanner to scan the customer's phone.", true);
      return;
    }
    if (!this.bagsOk()) return;
    this.paymentOffered = false;
    // Choosing the method locks the bags.
    this.session = selectPayment(s, c.payment);
    if (c.payment === "cash") this.takeCash();
    else this.startElectronic(c.payment);
  }

  /** One click: the cash flies into the drawer, which springs open for the change. */
  private takeCash(): void {
    const avatar = this.avatar!;
    const c = avatar.customer;
    const next = receivePayment(this.session!, c.tenderSen);
    if (next.phase === "tender") {
      // Defensive: generated tenders always cover the rounded total.
      console.error("[till] Customer tender below the total.", c.tenderSen, next.totalDueSen);
      this.voidSale();
      return;
    }
    this.session = next;
    avatar.releaseGesture();
    this.openDrawer();
    const from = this.group.worldToLocal(this.handPosition());
    const into = new THREE.Vector3(0, CABINET_H + 0.06, DRAWER_BASE_Z + DRAWER_OPEN_M - 0.08);
    c.tender.forEach((denom, i) => {
      const piece = makePiece(denom);
      piece.position.copy(from);
      this.group.add(piece);
      this.fly(piece, from, into, 0.45, 0.1, i * 0.08, () => {
        this.group.remove(piece);
        if (denom >= 100) playNote();
        else playCoin();
      });
    });
    this.drawer = deposit(this.drawer, c.tender);
    this.refreshDrawerStacks();
    if (next.phase === "done") {
      this.setMessage("Exact money — no change needed.");
      avatar.sayMoment("exact");
      this.finishSale(true);
      return;
    }
    this.drawVfd("BAKI / CHANGE", `RM${(next.changeDueSen / 100).toFixed(2).padStart(10)}`);
    this.setMessage(
      `Received ${describeTender(c.tender)}. Give ${formatRinggit(next.changeDueSen)} change: click notes/coins in the drawer, then click the tray.`,
    );
  }

  /** Card: charged on click. QR: the scanner dips over the customer's phone. */
  private startElectronic(method: "qr" | "card"): void {
    const avatar = this.avatar!;
    const s = this.session!;
    const amount = `RM${(s.totalDueSen / 100).toFixed(2).padStart(10)}`;
    this.drawVfd(method === "qr" ? "IMBAS DUITNOW QR" : "TAP KAD / CARD", amount);
    this.drawTerminal(method === "qr" ? "SCANNING" : "TAP CARD", "#ffe082");
    const approve = (): void => {
      if (this.avatar !== avatar || !this.session) return;
      this.session = confirmElectronic(this.session);
      if (method === "qr") playQrSuccess();
      else playCardApproved();
      this.drawTerminal("APPROVED", "#9fd8a8");
      this.setMessage(method === "qr" ? "DuitNow payment received." : "Card approved.");
      avatar.sayMoment("thanks");
      this.finishSale(false);
    };
    if (method === "card") {
      this.setMessage("Charging the card…");
      this.after(1.2, () => {
        avatar.releaseGesture();
        approve();
      });
      return;
    }
    this.setMessage("Scanning the customer's QR…");
    this.sweepScanner(this.handPosition(), () => {
      playBeep();
      avatar.releaseGesture();
      this.after(0.5, approve);
    });
  }

  // -------------------------------------------------------------------------
  // Change
  // -------------------------------------------------------------------------

  private handOverTray(): void {
    if (this.session!.phase !== "change") return;
    if (this.tray.length === 0) {
      this.setMessage("Pick the change from the drawer first.", true);
      playError();
      return;
    }
    this.handOver();
  }

  private returnTrayPiece(index: number): void {
    const s = this.session!;
    const piece = this.tray[index];
    if (s.phase !== "change" || !piece) return;
    this.session = undoDispense(s, piece.denom);
    this.tray.splice(index, 1);
    this.drawer = deposit(this.drawer, [piece.denom]);
    this.group.remove(piece.mesh);
    this.refreshDrawerStacks();
    this.setMessage(`Put back ${DENOM_LABELS[piece.denom]}. On tray ${formatRinggit(this.session.givenSen)}.`);
  }

  private pickFromDrawer(denom: number): void {
    const s = this.session!;
    if (s.phase !== "change") {
      this.setMessage("No change needed right now.", true);
      return;
    }
    const next = withdraw(this.drawer, denom);
    if (!next) {
      playError();
      this.setMessage(`No ${DENOM_LABELS[denom]} left.`, true);
      this.topUpLow();
      return;
    }
    this.drawer = next;
    this.session = dispense(s, denom);
    const piece = makePiece(denom);
    const slot = this.slotHits.get(denom)!;
    const from = this.group.worldToLocal(slot.getWorldPosition(this.scratch).clone());
    const i = this.tray.length;
    const to = this.trayAnchor.clone().add(new THREE.Vector3(((i % 4) - 1.5) * 0.012, i * 0.0032, ((i % 3) - 1) * 0.01));
    piece.position.copy(from);
    piece.rotation.y = denom >= 100 ? Math.PI / 2 + 0.15 * ((i % 3) - 1) : 0;
    this.group.add(piece);
    this.tray.push({ denom, mesh: piece });
    this.fly(piece, from, to, 0.28, 0.06, 0, () => (denom >= 100 ? playNote() : playCoin()));
    this.refreshDrawerStacks();
    this.topUpLow();
    const remaining = this.session.changeDueSen - this.session.givenSen;
    this.setMessage(
      remaining > 0
        ? `On tray ${formatRinggit(this.session.givenSen)} of ${formatRinggit(this.session.changeDueSen)}.`
        : remaining === 0
          ? "That's the change — click the tray to hand it over."
          : `Tray is ${formatRinggit(-remaining)} over — click a piece on the tray to put it back.`,
    );
  }

  private handOver(): void {
    const avatar = this.avatar!;
    const { session, result } = handOverChange(this.session!);
    this.session = session;
    avatar.gesture("receive", null, 1.0);
    if (result.kind === "short") {
      playError();
      avatar.sayMoment("short", { amount: formatRinggit(result.diffSen) });
      this.setMessage(`Short by ${formatRinggit(result.diffSen)} — add more, then click the tray again.`, true);
      return;
    }
    // The tray goes to the customer's hand.
    const hand = this.group.worldToLocal(this.handPosition());
    this.tray.forEach((p, i) => {
      this.fly(p.mesh, p.mesh.position.clone(), hand, 0.4, 0.1, i * 0.05, () => this.group.remove(p.mesh));
    });
    this.tray = [];
    if (result.kind === "over") {
      // The customer hands the extra back — straight into the drawer.
      this.drawer = deposit(this.drawer, makeChange(result.diffSen));
      avatar.sayMoment("over", { amount: formatRinggit(result.diffSen) });
      this.setMessage(`Customer handed back ${formatRinggit(result.diffSen)} extra.`);
    } else {
      avatar.sayMoment(session.changeAttempts === 1 ? "exact" : "thanks");
      if (session.changeAttempts === 1) playSuccess();
      this.setMessage("Change correct.");
    }
    this.refreshDrawerStacks();
    this.finishSale(true);
  }

  private finishSale(cash: boolean): void {
    if (this.finishing) return;
    this.finishing = true;
    const avatar = this.avatar!;
    const s = this.session!;
    this.drawVfd("TERIMA KASIH", "SILA DATANG LAGI");
    if (cash) this.after(0.8, () => this.closeDrawer());
    this.after(cash ? 1.0 : 0.6, () => {
      playPrinter();
      this.receiptS = 1.0;
      this.showReceipt(s, avatar.customer);
    });
    this.after(cash ? 2.3 : 1.9, () => {
      this.opts.checkout?.clearBag();
      this.receiptPaper.visible = false;
      this.drawTerminal("READY", "#9fd8a8");
      this.endSale(true);
    });
  }

  private voidSale(): void {
    const avatar = this.avatar;
    const s = this.session;
    if (!avatar || !s) return;
    avatar.releaseGesture();
    if (s.tenderedSen !== null) {
      // The tender already went into the drawer — hand it back.
      for (const d of avatar.customer.tender) this.drawer = withdraw(this.drawer, d) ?? this.drawer;
    }
    for (const p of this.tray) {
      this.drawer = deposit(this.drawer, [p.denom]);
      this.group.remove(p.mesh);
    }
    this.tray = [];
    this.refreshDrawerStacks();
    this.closeDrawer();
    this.opts.checkout?.abandon();
    this.drawVfd("TRANSAKSI BATAL", "");
    this.endSale(false);
  }

  private endSale(paid: boolean): void {
    const avatar = this.avatar;
    const session = this.session;
    this.timers = [];
    this.session = null;
    this.avatar = null;
    this.finishing = false;
    this.paymentOffered = false;
    this.scanS = 0;
    this.setScannerHeld(false);
    this.syncBags();
    this.setMessage(paid ? "Next customer, please." : "Transaction voided.");
    this.after(2.5, () => {
      if (!this.session) this.drawVfd("SELAMAT DATANG", STORE_NAME);
    });
    if (avatar && session) this.onComplete?.({ paid, customer: avatar.customer, session });
  }

  // -------------------------------------------------------------------------
  // Drawer
  // -------------------------------------------------------------------------

  private openDrawer(): void {
    if (this.drawerOpen) return;
    this.drawerOpen = true;
    playDrawerOpen();
  }

  private closeDrawer(): void {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    playDrawerClose();
  }

  private topUpLow(): void {
    for (const denom of lowDenominations(this.drawer)) {
      const { drawer, addedSen } = topUp(this.drawer, denom);
      this.drawer = drawer;
      this.floatAddedSen += addedSen;
      this.opts.toast(`Kak Rosnah (supervisor) brings more ${DENOM_LABELS[denom]} — +${formatRinggit(addedSen)} to the float.`);
    }
    this.refreshDrawerStacks();
  }

  private refreshDrawerStacks(): void {
    for (const [denom, stack] of this.slotStacks) {
      const count = this.drawer[denom] ?? 0;
      const shown = count === 0 ? 0 : Math.max(1, Math.min(stack.children.length, Math.ceil(count / (denom >= 100 ? 3 : 8))));
      stack.children.forEach((child, i) => {
        child.visible = i < shown;
      });
    }
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  /** Nearest clickable thing under the cursor ray: stand parts, the belt pack, or the customer's hand. */
  private pick(raycaster: THREE.Raycaster): PickHit | null {
    const targets: THREE.Object3D[] = [this.trayHit, this.holster, this.bagStack, ...this.placedBags];
    // A piece still flying out of its slot would swallow a quick second click on that slot.
    for (const p of this.tray) if (!this.flights.some((f) => f.obj === p.mesh)) targets.push(p.mesh);
    // The held scanner sits under the cursor — never let it block its own aim.
    if (!this.scannerHeld) targets.push(this.gun);
    if (this.drawerZ > DRAWER_OPEN_M * 0.6) targets.push(...this.slotHits.values());
    let best: PickHit | null = null;
    let bestD = Infinity;
    const hit = raycaster.intersectObjects(targets, true)[0];
    if (hit) {
      best = this.classify(hit.object);
      bestD = hit.distance;
    }
    const belt = this.opts.checkout?.pickBelt(raycaster);
    if (belt && belt.distance < bestD) {
      best = { kind: "item", mesh: belt.mesh, ready: belt.ready };
      bestD = belt.distance;
    }
    if (this.paymentOffered) {
      const hand = this.handPosition();
      const d = raycaster.ray.origin.distanceTo(hand);
      if (raycaster.ray.distanceToPoint(hand) < HAND_PICK_RADIUS_M && d < bestD) best = { kind: "payment" };
    }
    return best;
  }

  private classify(obj: THREE.Object3D): PickHit | null {
    const trayIndex = this.tray.findIndex((p) => p.mesh === obj);
    if (trayIndex >= 0) return { kind: "trayPiece", index: trayIndex };
    for (let cur: THREE.Object3D | null = obj; cur && cur !== this.group; cur = cur.parent) {
      const data = cur.userData as { slotDenom?: number; pick?: PickTag };
      if (data.slotDenom) return { kind: "slot", denom: data.slotDenom };
      if (data.pick) return { kind: data.pick };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Helpers: timers, flights, messages
  // -------------------------------------------------------------------------

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  private fly(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, duration: number, arc: number, delay: number, onDone?: () => void): void {
    this.flights.push({ obj, from: from.clone(), to: to.clone(), t: 0, duration, arc, delay, onDone });
  }

  private updateFlights(dt: number): void {
    for (let i = 0; i < this.flights.length; i += 1) {
      const f = this.flights[i];
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.t += dt;
      const u = Math.min(1, f.t / f.duration);
      const e = u * u * (3 - 2 * u);
      f.obj.position.lerpVectors(f.from, f.to, e);
      f.obj.position.y += Math.sin(Math.PI * u) * f.arc;
      if (u >= 1) {
        this.flights.splice(i, 1);
        i -= 1;
        f.onDone?.();
      }
    }
  }

  private handPosition(): THREE.Vector3 {
    if (!this.avatar) return this.group.localToWorld(this.tenderAnchor.clone());
    return this.avatar.handWorldPosition(new THREE.Vector3());
  }

  private setMessage(text: string, error = false): void {
    this.message = text;
    this.messageIsError = error;
    this.screenDirty = true;
  }

  private flashLaser(end: THREE.Vector3): void {
    this.group.updateMatrixWorld(true);
    const tip = this.scannerTip.getWorldPosition(this.scratch);
    this.laserPositions.set([tip.x, tip.y, tip.z, end.x, end.y, end.z]);
    (this.laser.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.laser.visible = true;
    this.laserS = 0.15;
  }

  private clearSaleVisuals(): void {
    for (const p of this.tray) this.group.remove(p.mesh);
    this.tray = [];
    this.flights = [];
    this.receiptPaper.visible = false;
  }

  // -------------------------------------------------------------------------
  // Rendering: POS screen, customer display, card terminal, receipt
  // -------------------------------------------------------------------------

  private drawScreen(): void {
    const ctx = this.screenCtx;
    const W = SCREEN_PX_W;
    const H = SCREEN_PX_H;
    const s = this.session;
    ctx.fillStyle = "#13171c";
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = "#b45309";
    ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = "#fff7e6";
    ctx.font = "800 34px system-ui, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${STORE_NAME} · POS 01`, 22, 33);
    ctx.textAlign = "right";
    ctx.font = "700 28px system-ui, 'Segoe UI', sans-serif";
    ctx.fillText(s ? (this.avatar?.customer.name ?? "") : this.clockLabel, W - 22, 33);

    if (!s) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#e8dcc8";
      ctx.font = "800 64px system-ui, 'Segoe UI', sans-serif";
      ctx.fillText("Selamat Datang", W / 2, H / 2 - 40);
      ctx.font = "600 30px system-ui, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#a89a7c";
      ctx.fillText(this.message || "Waiting for the next customer…", W / 2, H / 2 + 30);
      this.screenTexture.needsUpdate = true;
      return;
    }

    // Left: grouped line items (receipt style)
    const lines = receiptLines(s);
    const listX = 22;
    const listW = 600;
    let y = 116;
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 33px ui-monospace, 'Cascadia Mono', Consolas, monospace";
    for (const l of lines.slice(-10)) {
      ctx.fillStyle = l.pending ? "#6c6656" : l.bag ? "#9cc3ff" : "#e8dcc8";
      ctx.textAlign = "left";
      ctx.fillText(truncate(ctx, `${l.qty > 1 ? `${l.qty} x ` : ""}${l.name}`, listW - 140), listX, y);
      ctx.textAlign = "right";
      ctx.fillText(l.pending ? "" : (l.amountSen / 100).toFixed(2), listX + listW, y);
      y += 46;
    }
    ctx.fillStyle = "#8a826e";
    ctx.textAlign = "left";
    ctx.font = "600 24px system-ui, 'Segoe UI', sans-serif";
    ctx.fillText(`Items ${s.scanned}/${s.items.length}   Plastic bags ${s.bags}`, listX, 600);

    ctx.fillStyle = "#2b3138";
    ctx.fillRect(650, 80, 3, 530);

    // Right: totals
    const rx = W - 26;
    const row = (label: string, value: string, yy: number, color = "#c9bea6", size = 32): void => {
      ctx.font = `600 ${size}px system-ui, 'Segoe UI', sans-serif`;
      ctx.fillStyle = "#8a826e";
      ctx.textAlign = "left";
      ctx.fillText(label, 676, yy);
      ctx.textAlign = "right";
      ctx.fillStyle = color;
      ctx.font = `700 ${size}px ui-monospace, Consolas, monospace`;
      ctx.fillText(value, rx, yy);
    };
    row("Subtotal", (s.subtotalSen / 100).toFixed(2), 112);
    if (s.method === "cash") row("Rounding Adj", signed(s.roundingSen), 152);
    ctx.fillStyle = "#8a826e";
    ctx.textAlign = "left";
    ctx.font = "700 26px system-ui, 'Segoe UI', sans-serif";
    ctx.fillText("TOTAL", 676, 210);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd54f";
    ctx.font = "800 66px ui-monospace, Consolas, monospace";
    ctx.fillText(`RM${(s.totalDueSen / 100).toFixed(2)}`, rx, 276);

    if (s.method) row("Payment", methodLabel(s.method), 330, "#9fd8a8");
    if (s.method === "cash") {
      row("Tendered", s.tenderedSen === null ? "—" : (s.tenderedSen / 100).toFixed(2), 372);
      if (s.phase === "change" || (s.phase === "done" && s.changeDueSen > 0)) {
        row("CHANGE", (s.changeDueSen / 100).toFixed(2), 430, "#7fe0a0", 40);
        row("On tray", (s.givenSen / 100).toFixed(2), 478, s.givenSen === s.changeDueSen ? "#7fe0a0" : "#ffb38a");
      }
    }
    if (s.phase === "change" && this.opts.changeHint()) {
      const remaining = s.changeDueSen - s.givenSen;
      if (remaining > 0) {
        const hint = changeHintText(remaining);
        ctx.textAlign = "left";
        ctx.font = "600 22px system-ui, 'Segoe UI', sans-serif";
        ctx.fillStyle = "#caa46a";
        wrapText(ctx, `Hint: ${hint}`, 676, 516, W - 700, 28);
      }
    }

    // Status bar — what to do next.
    ctx.fillStyle = this.messageIsError ? "#5a2320" : "#1f3a2a";
    ctx.fillRect(0, H - 96, W, 96);
    ctx.fillStyle = this.messageIsError ? "#ffd2c8" : "#d8f5dd";
    ctx.textAlign = "left";
    ctx.font = "700 32px system-ui, 'Segoe UI', sans-serif";
    wrapText(ctx, this.message, 22, H - 56, W - 44, 36);
    this.screenTexture.needsUpdate = true;
  }

  private drawVfd(line1: string, line2: string): void {
    const ctx = this.vfdCtx;
    ctx.fillStyle = "#06120c";
    ctx.fillRect(0, 0, VFD_PX_W, VFD_PX_H);
    ctx.fillStyle = "#38f7a0";
    ctx.shadowColor = "#38f7a0";
    ctx.shadowBlur = 8;
    ctx.font = "700 40px ui-monospace, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(line1.slice(0, 20), 16, 36);
    ctx.fillText(line2.slice(0, 20), 16, 92);
    ctx.shadowBlur = 0;
    this.vfdTexture.needsUpdate = true;
  }

  private drawTerminal(text: string, color: string): void {
    const ctx = this.terminalCtx;
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = color;
    ctx.font = "800 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 48);
    this.terminalTexture.needsUpdate = true;
  }

  private showReceipt(s: Session, customer: Customer): void {
    const lines = receiptLines(s).filter((l) => !l.pending);
    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
    const rule = "-".repeat(RECEIPT_WIDTH);
    const body: string[] = [
      center(STORE_NAME),
      ...STORE_ADDRESS.map(center),
      rule,
      pad(`${date} ${this.clockLabel}`, `#${String(customer.id).padStart(5, "0")}`),
      "Kasir: Anda (POS 01)",
      rule,
      ...lines.flatMap((l) =>
        l.qty > 1
          ? [l.name.slice(0, RECEIPT_WIDTH), pad(`  ${l.qty} x ${(l.unitSen / 100).toFixed(2)}`, (l.amountSen / 100).toFixed(2))]
          : [pad(l.name, (l.amountSen / 100).toFixed(2))],
      ),
      rule,
      pad("SUBTOTAL", (s.subtotalSen / 100).toFixed(2)),
    ];
    if (s.method === "cash") body.push(pad("Rounding Adj", signed(s.roundingSen)));
    body.push(pad("JUMLAH / TOTAL", `RM${(s.totalDueSen / 100).toFixed(2)}`));
    if (s.method === "cash") {
      body.push(pad("TUNAI / CASH", ((s.tenderedSen ?? 0) / 100).toFixed(2)));
      body.push(pad("BAKI / CHANGE", (s.changeDueSen / 100).toFixed(2)));
    } else {
      body.push(pad(s.method === "qr" ? "DUITNOW QR" : "KAD / CARD", (s.totalDueSen / 100).toFixed(2)));
    }
    body.push(rule, center("Terima kasih!"), center("Sila datang lagi :)"));
    this.receiptCard.textContent = body.join("\n");
    this.receiptCard.hidden = false;
    this.receiptCard.classList.remove("receipt-out");
    for (const t of this.receiptTimers) window.clearTimeout(t);
    this.receiptTimers = [
      window.setTimeout(() => this.receiptCard.classList.add("receipt-out"), 4200),
      window.setTimeout(() => {
        this.receiptCard.hidden = true;
      }, 4800),
    ];
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private buildCabinet(): void {
    const wood = lambert("#6b4a2c");
    const dark = lambert("#2d2418");
    const top = lambert("#3a3128");
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(STAND_W, CABINET_H, STAND_D), wood);
    cabinet.position.y = CABINET_H / 2;
    this.group.add(cabinet);
    // Drawer housing (open front so the drawer can slide out).
    const housingSide = new THREE.BoxGeometry(0.04, HOUSING_H, STAND_D);
    for (const x of [-STAND_W / 2 + 0.02, STAND_W / 2 - 0.02]) {
      const side = new THREE.Mesh(housingSide, dark);
      side.position.set(x, CABINET_H + HOUSING_H / 2, 0);
      this.group.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(STAND_W, HOUSING_H, 0.04), dark);
    back.position.set(0, CABINET_H + HOUSING_H / 2, -STAND_D / 2 + 0.02);
    this.group.add(back);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(STAND_W + 0.04, TOP_H, STAND_D + 0.04), top);
    slab.position.y = CABINET_H + HOUSING_H + TOP_H / 2;
    this.group.add(slab);
  }

  private buildDrawer(): void {
    const g = this.drawerGroup;
    g.name = "cash-drawer";
    const body = lambert("#1f1a14");
    const tray = new THREE.Mesh(new THREE.BoxGeometry(DRAWER_W, 0.012, DRAWER_D), body);
    tray.position.y = 0.006;
    g.add(tray);
    for (const x of [-DRAWER_W / 2, DRAWER_W / 2]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.012, DRAWER_H, DRAWER_D), body);
      wall.position.set(x, DRAWER_H / 2, 0);
      g.add(wall);
    }
    const front = new THREE.Mesh(new THREE.BoxGeometry(DRAWER_W + 0.04, DRAWER_H + 0.03, 0.02), lambert("#2d2418"));
    front.position.set(0, DRAWER_H / 2, DRAWER_D / 2 + 0.01);
    g.add(front);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.014, 0.02), lambert("#b89a72"));
    handle.position.set(0, DRAWER_H / 2, DRAWER_D / 2 + 0.03);
    g.add(handle);

    const divider = lambert("#2b241c");
    const hitMat = (): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false });
    // Notes in the back row, coin cups in front (nearest the cashier).
    // Notes lie flat, face up, so the printed value reads from the cashier's
    // side; each stack is neat so the top note's label stays unobscured.
    const noteW = DRAWER_W / DRAWER_NOTES.length;
    const noteZ = -DRAWER_D / 2 + 0.15;
    const noteSlotD = 0.17;
    DRAWER_NOTES.forEach((denom, i) => {
      const x = -DRAWER_W / 2 + noteW * (i + 0.5);
      const stack = new THREE.Group();
      stack.position.set(x, 0.014, noteZ);
      for (let k = 0; k < 6; k += 1) {
        const note = makePiece(denom);
        note.scale.set(0.82, 1, 1.25);
        note.position.set(((k % 2) - 0.5) * 0.002, k * 0.003, ((k % 3) - 1) * 0.002);
        stack.add(note);
      }
      g.add(stack);
      this.slotStacks.set(denom, stack);
      g.add(slotTag(DENOM_LABELS[denom] ?? "", NOTE_COLORS[denom] ?? "#6fae7c", x, noteZ + 0.058, noteW * 0.8));
      const hit = new THREE.Mesh(new THREE.BoxGeometry(noteW * 0.94, 0.06, noteSlotD), hitMat());
      hit.position.set(x, 0.03, noteZ);
      hit.userData.slotDenom = denom;
      g.add(hit);
      this.slotHits.set(denom, hit);
      if (i > 0) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.06, noteSlotD), divider);
        wall.position.set(-DRAWER_W / 2 + noteW * i, 0.03, noteZ);
        g.add(wall);
      }
    });
    // Coins: one tidy pile per cup, the top coin showing its value.
    const coinW = DRAWER_W / DRAWER_COINS.length;
    DRAWER_COINS.forEach((denom, i) => {
      const x = -DRAWER_W / 2 + coinW * (i + 0.5);
      const z = DRAWER_D / 2 - 0.09;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.024, 16, 1, true), divider);
      cup.position.set(x, 0.024, z);
      g.add(cup);
      const stack = new THREE.Group();
      stack.position.set(x, 0.014, z);
      for (let k = 0; k < 6; k += 1) {
        const coin = makePiece(denom);
        coin.scale.set(2.4, 1, 2.4);
        coin.position.set(((k % 2) - 0.5) * 0.003, 0.002 + k * 0.0036, ((k % 3) - 1) * 0.002);
        stack.add(coin);
      }
      g.add(stack);
      this.slotStacks.set(denom, stack);
      g.add(slotTag(DENOM_LABELS[denom] ?? "", COIN_COLORS[denom] ?? "#cccccc", x, z - 0.066, coinW * 0.7, "#3a2e1f"));
      const hit = new THREE.Mesh(new THREE.BoxGeometry(coinW * 0.94, 0.06, 0.13), hitMat());
      hit.position.set(x, 0.03, z);
      hit.userData.slotDenom = denom;
      g.add(hit);
      this.slotHits.set(denom, hit);
    });
    g.position.set(0, CABINET_H + 0.012, DRAWER_BASE_Z);
    this.group.add(g);
  }

  private buildMonitor(): void {
    const dark = lambert("#1d1a17");
    const poleH = MONITOR_Y - TOP_Y - 0.1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, poleH, 10), dark);
    pole.position.set(0.02, TOP_Y + poleH / 2, -0.17);
    this.group.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.015, 14), dark);
    foot.position.set(0.02, TOP_Y + 0.008, -0.17);
    this.group.add(foot);
    const monitor = new THREE.Group();
    monitor.position.set(0.02, MONITOR_Y, -0.15);
    monitor.rotation.x = MONITOR_TILT;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(MONITOR_W + 0.03, MONITOR_H + 0.03, 0.03), dark);
    monitor.add(bezel);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(MONITOR_W, MONITOR_H),
      new THREE.MeshBasicMaterial({ map: this.screenTexture, toneMapped: false }),
    );
    screen.position.z = 0.0155;
    monitor.add(screen);
    this.group.add(monitor);
  }

  /** Decorative keypad — the till is worked with the mouse, not the keys. */
  private buildKeys(): void {
    const originX = -0.1;
    const originZ = 0.04;
    const base = new THREE.Mesh(new THREE.BoxGeometry(6 * KEY_PITCH + 0.016, 0.012, 4 * KEY_PITCH + 0.016), lambert("#1a1612"));
    base.position.set(originX + 2.5 * KEY_PITCH, TOP_Y + 0.006, originZ + 1.5 * KEY_PITCH);
    this.group.add(base);
    for (const k of KEY_LAYOUT) {
      const span = k.w ?? 1;
      const w = span * KEY_PITCH - (KEY_PITCH - KEY_SIZE);
      const sideMat = new THREE.MeshLambertMaterial({ color: k.color });
      const topMat = new THREE.MeshLambertMaterial({
        map: labelTexture(k.label, k.color, "#f5ecd8", 128 * span, 128, k.label.length > 3 ? 32 : 60),
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.016, KEY_SIZE), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
      mesh.position.set(originX + (k.col + (span - 1) / 2) * KEY_PITCH, KEY_REST_Y, originZ + k.row * KEY_PITCH);
      this.group.add(mesh);
    }
  }

  private buildTray(): THREE.Mesh {
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.13), lambert("#4a3b28"));
    tray.position.set(this.trayAnchor.x, TOP_Y + 0.006, this.trayAnchor.z);
    tray.userData.pick = "tray" satisfies PickTag;
    this.group.add(tray);
    // Invisible margin round the tray: a note covers most of it, and a click
    // on a piece puts that piece back, so the edges must still hand over.
    const margin = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.01, 0.15),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    margin.position.y = -0.001;
    tray.add(margin);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.02, 0.006), lambert("#5a4832"));
    lip.position.set(this.trayAnchor.x, TOP_Y + 0.012, this.trayAnchor.z + 0.066);
    this.group.add(lip);
    return tray;
  }

  private buildVfd(): void {
    const dark = lambert("#1d1a17");
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 8), dark);
    pole.position.set(-0.27, TOP_Y + 0.16, -0.22);
    this.group.add(pole);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.075, 0.04), dark);
    box.position.set(-0.27, TOP_Y + 0.36, -0.22);
    this.group.add(box);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.055), new THREE.MeshBasicMaterial({ map: this.vfdTexture, toneMapped: false }));
    face.position.set(-0.27, TOP_Y + 0.36, -0.2405);
    face.rotation.y = Math.PI; // faces the customer (−z)
    this.group.add(face);
  }

  private buildQrStand(): void {
    const g = new THREE.Group();
    const [canvas, ctx] = canvas2d(256, 340);
    ctx.fillStyle = "#e6007e";
    ctx.fillRect(0, 0, 256, 340);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("DuitNow QR", 128, 46);
    ctx.fillRect(38, 70, 180, 180);
    // Deterministic faux QR modules (decorative — encodes nothing).
    ctx.fillStyle = "#111111";
    let seed = 1234567;
    for (let y = 0; y < 21; y += 1) {
      for (let x = 0; x < 21; x += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const fx = x < 7 ? x : x > 13 ? x - 14 : -1;
        const fy = y < 7 ? y : y > 13 ? y - 14 : -1;
        const finder = fx >= 0 && fy >= 0 && !(x > 13 && y > 13);
        const on = finder
          ? fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4)
          : seed % 3 === 0;
        if (on) ctx.fillRect(44 + x * 8, 76 + y * 8, 8, 8);
      }
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.fillText(STORE_NAME, 128, 290);
    ctx.font = "600 18px system-ui, sans-serif";
    ctx.fillText("Imbas untuk bayar", 128, 318);
    // Printed face toward the customer; plain pink back toward the cashier.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.133), new THREE.MeshBasicMaterial({ map: toTexture(canvas) }));
    board.rotation.y = Math.PI;
    board.position.set(0, 0.078, -0.002);
    g.add(board);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.133), new THREE.MeshBasicMaterial({ color: 0xc2006a }));
    back.position.set(0, 0.078, 0.002);
    g.add(back);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.05), lambert("#d0d0d0"));
    foot.position.y = 0.006;
    g.add(foot);
    g.position.set(0.2, TOP_Y, -0.215);
    this.group.add(g);
  }

  private buildCardTerminal(): void {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.15), lambert("#22262b"));
    body.position.y = 0.015;
    g.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.045), new THREE.MeshBasicMaterial({ map: this.terminalTexture, toneMapped: false }));
    screen.rotation.x = -Math.PI / 2;
    screen.rotation.z = Math.PI;
    screen.position.set(0, 0.0305, -0.035);
    g.add(screen);
    g.position.set(0.26, TOP_Y, -0.04);
    g.rotation.y = 0.3;
    this.group.add(g);
  }

  private buildPrinter(): THREE.Mesh {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.12), lambert("#2b2724"));
    body.position.set(0.25, TOP_Y + 0.04, 0.17);
    this.group.add(body);
    const geo = new THREE.BoxGeometry(0.075, 0.14, 0.002);
    geo.translate(0, 0.07, 0); // grow upward out of the slot
    const paper = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xfbfaf5 }));
    paper.position.set(0.25, PRINTER_SLOT_Y, 0.2);
    paper.rotation.x = -0.35;
    paper.visible = false;
    this.group.add(paper);
    return paper;
  }

  /** Handheld scanner in its cradle (returned). Gun and cradle both pick as "scanner". */
  private buildScanner(): THREE.Mesh {
    const dark = lambert("#1a1a1a");
    const holster = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), dark);
    holster.position.set(-STAND_W / 2 + 0.03, TOP_Y + 0.025, -0.06);
    holster.userData.pick = "scanner" satisfies PickTag;
    this.group.add(holster);
    const gun = this.gun;
    gun.userData.pick = "scanner" satisfies PickTag;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.035), dark);
    handle.position.y = 0.05;
    gun.add(handle);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), dark);
    head.position.set(0, 0.11, -0.03);
    gun.add(head);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.03), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    lens.position.set(0, 0.11, -0.091);
    lens.rotation.y = Math.PI;
    gun.add(lens);
    this.scannerTip.position.set(0, 0.11, -0.095);
    gun.add(this.scannerTip);
    gun.position.set(-STAND_W / 2 + 0.03, TOP_Y + 0.03, -0.06);
    gun.rotation.set(-0.35, Math.PI / 2 - 0.3, 0);
    this.gunRestPos.copy(gun.position);
    this.gunRestQuat.copy(gun.quaternion);
    this.group.add(gun);
    return holster;
  }

  /** Folded plastic bags between the cradle and the change tray: click to add one. */
  private buildBagStack(): THREE.Group {
    const g = new THREE.Group();
    const white = lambert("#f4f4f2");
    for (let k = 0; k < 5; k += 1) {
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.005, 0.065), white);
      sheet.position.set(((k % 2) - 0.5) * 0.003, 0.0025 + k * 0.005, 0);
      g.add(sheet);
    }
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.028),
      new THREE.MeshBasicMaterial({ map: labelTexture("BAG 20sen", "#f4f4f2", "#b45309", 256, 90, 44), toneMapped: false }),
    );
    tag.rotation.x = -Math.PI / 2;
    tag.position.y = 0.0255;
    g.add(tag);
    g.position.set(-0.24, TOP_Y, 0.04);
    g.userData.pick = "bagStack" satisfies PickTag;
    this.group.add(g);
    return g;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const RECEIPT_WIDTH = 34;

interface ReceiptLine {
  name: string;
  qty: number;
  unitSen: number;
  amountSen: number;
  pending: boolean;
  bag: boolean;
}

/** Group items by SKU (2 x Maggi); not-yet-scanned items greyed; bags last. */
function receiptLines(s: Session): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  const byKey = new Map<string, ReceiptLine>();
  s.items.forEach((item, i) => {
    const pending = i >= s.scanned;
    const key = `${item.id}:${pending ? "p" : "s"}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.qty += 1;
      existing.amountSen += item.priceSen;
    } else {
      const entry: ReceiptLine = { name: item.name, qty: 1, unitSen: item.priceSen, amountSen: item.priceSen, pending, bag: false };
      byKey.set(key, entry);
      out.push(entry);
    }
  });
  out.sort((a, b) => Number(a.pending) - Number(b.pending));
  if (s.bags > 0) {
    out.push({ name: "Beg Plastik", qty: s.bags, unitSen: 20, amountSen: s.bags * 20, pending: false, bag: true });
  }
  return out;
}

function methodLabel(m: PaymentMethod): string {
  return m === "cash" ? "Cash" : m === "qr" ? "DuitNow QR" : "Card";
}

function signed(sen: number): string {
  return `${sen > 0 ? "+" : sen < 0 ? "-" : ""}${(Math.abs(sen) / 100).toFixed(2)}`;
}

function pad(left: string, right: string): string {
  const l = left.length + right.length >= RECEIPT_WIDTH ? left.slice(0, RECEIPT_WIDTH - right.length - 1) : left;
  return l + " ".repeat(Math.max(1, RECEIPT_WIDTH - l.length - right.length)) + right;
}

function center(text: string): string {
  const t = text.slice(0, RECEIPT_WIDTH);
  return " ".repeat(Math.max(0, Math.floor((RECEIPT_WIDTH - t.length) / 2))) + t;
}

function fitVfd(text: string): string {
  return text.length > 20 ? `${text.slice(0, 19)}…` : text;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  let lineText = "";
  let yy = y;
  for (const word of text.split(" ")) {
    const test = lineText ? `${lineText} ${word}` : word;
    if (ctx.measureText(test).width > maxW && lineText) {
      ctx.fillText(lineText, x, yy);
      lineText = word;
      yy += lineH;
    } else {
      lineText = test;
    }
  }
  if (lineText) ctx.fillText(lineText, x, yy);
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function lambert(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function buildVoidPrompt(onAnswer: (yes: boolean) => void): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "void-prompt";
  el.hidden = true;
  el.innerHTML = `
    <div class="void-card">
      <div class="void-title">Void this transaction?</div>
      <div class="void-body">The customer leaves without paying.</div>
      <div class="void-actions">
        <button type="button" class="void-yes">Void</button>
        <button type="button" class="void-no">Keep serving <kbd>Esc</kbd></button>
      </div>
    </div>`;
  el.querySelector(".void-yes")!.addEventListener("click", () => onAnswer(true));
  el.querySelector(".void-no")!.addEventListener("click", () => onAnswer(false));
  document.body.appendChild(el);
  return el;
}

function buildReceiptCard(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "receipt-card";
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}
