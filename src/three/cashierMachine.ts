// Cashier machine prop + runtime (Phase 1).
// Procedural Three.js model: screen, scanner gun, keypad, cash drawer, receipt printer.
// The screen is a plain DOM overlay glued to the machine's world position by
// main.ts (manual projection), so it never tracks the camera.
import * as THREE from "three";
import type { AssetBundle } from "./assets";
import { TILL_X, TILL_Z } from "./storeLayout";
import { animateCustomerHandoff } from "../game/customers3d";
import type { CustomerAvatar } from "../game/customers3d";

// ---------------------------------------------------------------------------
// Machine dimensions (metres) — tuned to fit the counter north of the belt.
// ---------------------------------------------------------------------------
const MACHINE_WIDTH_M = 0.48;    // x span (centered on counter)
const MACHINE_DEPTH_M = 0.38;    // z span (north of belt, facing player)
const MACHINE_HEIGHT_M = 0.42;   // body height; screen adds more

const SCREEN_WIDTH_M = 0.32;
const SCREEN_HEIGHT_M = 0.28;
const SCREEN_THICKNESS_M = 0.018;
const SCREEN_BOTTOM_ABOVE_BODY_M = 0.02;

const SCANNER_GUN_WIDTH_M = 0.05;
const SCANNER_GUN_HEIGHT_M = 0.07;
const SCANNER_GUN_DEPTH_M = 0.14;
const SCANNER_GUN_OFFSET_X = 0.18;  // right side of machine (player's right)
const SCANNER_GUN_OFFSET_Z = -0.02; // slightly forward of machine front

const KEYPAD_WIDTH_M = 0.14;
const KEYPAD_HEIGHT_M = 0.008;
const KEYPAD_DEPTH_M = 0.16;
const KEYPAD_OFFSET_X = -0.15; // left side of machine
const KEYPAD_OFFSET_Z = -0.02;
const KEY_SIZE_M = 0.018;
const KEY_GAP_M = 0.003;

const DRAWER_WIDTH_M = 0.36;
const DRAWER_HEIGHT_M = 0.11;
const DRAWER_DEPTH_M = 0.32;
const DRAWER_BOTTOM_ABOVE_BASE_M = 0.02;
const DRAWER_HANDLE_HEIGHT_M = 0.008;
const DRAWER_HANDLE_DEPTH_M = 0.025;
const DRAWER_PULL_DISTANCE_M = 0.28; // how far it slides out

const PRINTER_WIDTH_M = 0.1;
const PRINTER_HEIGHT_M = 0.07;
const PRINTER_DEPTH_M = 0.12;
const PRINTER_OFFSET_X = 0.22; // far right
const PRINTER_OFFSET_Z = 0.05; // back

const BODY_COLOUR = 0x2d2418;      // dark wood
const SCREEN_BG_COLOUR = 0x1a1610; // very dark
const SCREEN_BORDER_COLOUR = 0xcaa46a;
const SCANNER_COLOUR = 0x1a1a1a;
const SCANNER_LENS_COLOUR = 0xcc0000;
const KEYPAD_COLOUR = 0x1f1a14;
const KEY_COLOUR = 0x3a3328;
const KEY_TEXT_COLOUR = 0xe8dcc8;
const DRAWER_COLOUR = 0x3d2f1f;
const DRAWER_HANDLE_COLOUR = 0xb89a72;
const PRINTER_COLOUR = 0x2d2418;
const PRINTER_PAPER_COLOUR = 0xffffff;

// Malaysian denomination order for keypad (RM100 → 5 sen)
const DENOM_LABELS: Record<number, string> = {
  10000: "RM100",
  5000: "RM50",
  2000: "RM20",
  1000: "RM10",
  500: "RM5",
  100: "RM1",
  50: "50s",
  20: "20s",
  10: "10s",
  5: "5s",
};
const DENOMS_SEN = [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5];

// ---------------------------------------------------------------------------
// Prop builder — returns a group with all static parts.
// Caller positions the group on the counter.
// ---------------------------------------------------------------------------
export interface CashierMachineProps {
  group: THREE.Group;
  /** Screen face center (world) — for CSS2DObject positioning. */
  screenCenter: THREE.Vector3;
  /** Scanner gun tip (world) — for laser origin. */
  scannerTip: THREE.Vector3;
  /** Scanner gun direction (world, normalized) — points at belt. */
  scannerDir: THREE.Vector3;
  /** Keypad button meshes — for raycast clicks. */
  keyMeshes: Map<number, THREE.Mesh>; // denomSen -> mesh
  /** Drawer group (animates open/close). */
  drawerGroup: THREE.Group;
  /** Drawer handle mesh (for raycast to open). */
  drawerHandle: THREE.Mesh;
  /** Printer paper slot mesh (for visual feedback). */
  printerSlot: THREE.Mesh;
  /** Bill/coin meshes in drawer compartments — for raycast picking. */
  billCoinMeshes: Map<number, THREE.Group[]>; // denomSen -> array of meshes (multiple bills/coins per denom)
}

export function buildCashierMachineProps(): CashierMachineProps {
  const group = new THREE.Group();
  group.name = "cashier-machine";

  const bodyMat = new THREE.MeshLambertMaterial({ color: BODY_COLOUR, flatShading: true });
  const screenBgMat = new THREE.MeshBasicMaterial({ color: SCREEN_BG_COLOUR });
  const screenBorderMat = new THREE.MeshLambertMaterial({ color: SCREEN_BORDER_COLOUR, flatShading: true });
  const scannerMat = new THREE.MeshLambertMaterial({ color: SCANNER_COLOUR, flatShading: true });
  const scannerLensMat = new THREE.MeshBasicMaterial({ color: SCANNER_LENS_COLOUR });
  const keypadMat = new THREE.MeshLambertMaterial({ color: KEYPAD_COLOUR, flatShading: true });
  const keyMat = new THREE.MeshLambertMaterial({ color: KEY_COLOUR, flatShading: true });
  const drawerMat = new THREE.MeshLambertMaterial({ color: DRAWER_COLOUR, flatShading: true });
  const handleMat = new THREE.MeshLambertMaterial({ color: DRAWER_HANDLE_COLOUR, flatShading: true });
  const printerMat = new THREE.MeshLambertMaterial({ color: PRINTER_COLOUR, flatShading: true });
  const paperMat = new THREE.MeshBasicMaterial({ color: PRINTER_PAPER_COLOUR });

  // --- Body (main box) ---
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(MACHINE_WIDTH_M, MACHINE_HEIGHT_M, MACHINE_DEPTH_M),
    bodyMat,
  );
  body.position.y = MACHINE_HEIGHT_M / 2;
  group.add(body);

  // --- Screen (on top of body, slightly back) ---
  const screenBorder = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN_WIDTH_M + 0.01, SCREEN_HEIGHT_M + 0.01, SCREEN_THICKNESS_M + 0.002),
    screenBorderMat,
  );
  const screenZ = MACHINE_DEPTH_M / 2 - SCREEN_THICKNESS_M / 2 - 0.01; // back face of body
  screenBorder.position.set(0, MACHINE_HEIGHT_M + SCREEN_BOTTOM_ABOVE_BODY_M + SCREEN_HEIGHT_M / 2, screenZ);
  group.add(screenBorder);

  const screenFace = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN_WIDTH_M, SCREEN_HEIGHT_M, SCREEN_THICKNESS_M),
    screenBgMat,
  );
  screenFace.position.set(0, MACHINE_HEIGHT_M + SCREEN_BOTTOM_ABOVE_BODY_M + SCREEN_HEIGHT_M / 2, screenZ + 0.001);
  group.add(screenFace);

  const screenCenter = new THREE.Vector3(0, MACHINE_HEIGHT_M + SCREEN_BOTTOM_ABOVE_BODY_M + SCREEN_HEIGHT_M / 2, screenZ + SCREEN_THICKNESS_M / 2 + 0.001);

  // --- Scanner gun (right side, angled down toward belt) ---
  const scannerGroup = new THREE.Group();
  scannerGroup.name = "scanner-gun";

  const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(SCANNER_GUN_WIDTH_M, SCANNER_GUN_HEIGHT_M, SCANNER_GUN_DEPTH_M),
    scannerMat,
  );
  gunBody.position.set(0, SCANNER_GUN_HEIGHT_M / 2, 0);
  scannerGroup.add(gunBody);

  // Trigger
  const trigger = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.02, 0.012),
    scannerMat,
  );
  trigger.position.set(0, -SCANNER_GUN_HEIGHT_M / 2 + 0.01, SCANNER_GUN_DEPTH_M / 2 - 0.02);
  scannerGroup.add(trigger);

  // Lens (front face, red)
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 0.004, 12),
    scannerLensMat,
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, SCANNER_GUN_DEPTH_M / 2 + 0.002);
  scannerGroup.add(lens);

  // Position scanner on machine right side
  scannerGroup.position.set(
    MACHINE_WIDTH_M / 2 + SCANNER_GUN_OFFSET_X,
    MACHINE_HEIGHT_M + SCANNER_GUN_HEIGHT_M / 2 - 0.02,
    MACHINE_DEPTH_M / 2 + SCANNER_GUN_OFFSET_Z,
  );
  // Angle down slightly toward belt (rotate around X)
  scannerGroup.rotation.x = -0.25;
  group.add(scannerGroup);

  // Scanner tip (world) and direction for laser
  const scannerTipLocal = new THREE.Vector3(0, -SCANNER_GUN_HEIGHT_M / 2, SCANNER_GUN_DEPTH_M / 2);
  const scannerDirLocal = new THREE.Vector3(0, -Math.sin(0.25), Math.cos(0.25));

  // --- Keypad (left side, flat on top front) ---
  const keypadGroup = new THREE.Group();
  keypadGroup.name = "keypad";

  const keypadBase = new THREE.Mesh(
    new THREE.BoxGeometry(KEYPAD_WIDTH_M, KEYPAD_HEIGHT_M, KEYPAD_DEPTH_M),
    keypadMat,
  );
  keypadBase.position.y = KEYPAD_HEIGHT_M / 2;
  keypadGroup.add(keypadBase);

  const keyMeshes = new Map<number, THREE.Mesh>();
  const keysPerRow = 5;
  const keyStartX = -(KEYPAD_WIDTH_M / 2) + KEY_SIZE_M / 2 + KEY_GAP_M;
  const keyStartZ = -(KEYPAD_DEPTH_M / 2) + KEY_SIZE_M / 2 + KEY_GAP_M;

  for (let i = 0; i < DENOMS_SEN.length; i++) {
    const denom = DENOMS_SEN[i];
    const row = Math.floor(i / keysPerRow);
    const col = i % keysPerRow;
    const key = new THREE.Mesh(
      new THREE.BoxGeometry(KEY_SIZE_M, KEY_SIZE_M * 1.5, KEY_SIZE_M),
      keyMat,
    );
    key.position.set(
      keyStartX + col * (KEY_SIZE_M + KEY_GAP_M),
      KEYPAD_HEIGHT_M + KEY_SIZE_M * 1.5 / 2,
      keyStartZ + row * (KEY_SIZE_M + KEY_GAP_M),
    );
    key.name = `key-${denom}`;
    key.userData.denomSen = denom;
    keypadGroup.add(key);
    keyMeshes.set(denom, key);

    // Key label as text texture (CanvasTexture) — simple text on top face
    const labelTexture = createKeyLabelTexture(DENOM_LABELS[denom]);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthTest: false });
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(KEY_SIZE_M * 0.8, KEY_SIZE_M * 0.6),
      labelMat,
    );
    label.position.set(0, KEY_SIZE_M * 1.5 / 2 + 0.001, 0);
    label.rotation.x = -Math.PI / 2;
    key.add(label);
  }

  keypadGroup.position.set(
    -MACHINE_WIDTH_M / 2 + KEYPAD_OFFSET_X,
    MACHINE_HEIGHT_M + KEYPAD_HEIGHT_M / 2,
    MACHINE_DEPTH_M / 2 + KEYPAD_OFFSET_Z,
  );
  group.add(keypadGroup);

  // --- Cash drawer (front, below keypad/scanner) ---
  const drawerGroup = new THREE.Group();
  drawerGroup.name = "cash-drawer";

  const drawerBody = new THREE.Mesh(
    new THREE.BoxGeometry(DRAWER_WIDTH_M, DRAWER_HEIGHT_M, DRAWER_DEPTH_M),
    drawerMat,
  );
  drawerBody.position.set(0, DRAWER_HEIGHT_M / 2, 0);
  drawerGroup.add(drawerBody);

  // Drawer handle (centered on front face)
  const drawerHandle = new THREE.Mesh(
    new THREE.BoxGeometry(DRAWER_WIDTH_M * 0.4, DRAWER_HANDLE_HEIGHT_M, DRAWER_HANDLE_DEPTH_M),
    handleMat,
  );
  drawerHandle.position.set(
    0,
    DRAWER_HEIGHT_M / 2,
    DRAWER_DEPTH_M / 2 + DRAWER_HANDLE_DEPTH_M / 2,
  );
  drawerHandle.name = "drawer-handle";
  drawerGroup.add(drawerHandle);

  // Drawer compartments (visual only — 6 note slots front, 4 coin slots back)
  const slotMat = new THREE.MeshBasicMaterial({ color: 0x1a1410, transparent: true, opacity: 0.6 });
  const noteSlotW = DRAWER_WIDTH_M / 6;
  const noteSlotD = DRAWER_DEPTH_M * 0.55;
  const coinSlotW = DRAWER_WIDTH_M / 4;
  const coinSlotD = DRAWER_DEPTH_M * 0.35;
  const noteDenoms = [10000, 5000, 2000, 1000, 500, 100]; // 6 note slots
  const coinDenoms = [50, 20, 10, 5]; // 4 coin slots
  const billCoinMeshes = new Map<number, THREE.Group[]>();

  // Bill colors (Malaysian Ringgit approximate)
  const billColors: Record<number, number> = {
    10000: 0x8fbc8f, // RM100 - green
    5000: 0x4682b4,  // RM50 - blue
    2000: 0xffa500,  // RM20 - orange
    1000: 0xff6347,  // RM10 - red
    500: 0x9370db,   // RM5 - purple
    100: 0x2e8b57,   // RM1 - dark green
  };
  const coinColors: Record<number, number> = {
    50: 0xffd700,    // 50 sen - gold
    20: 0xc0c0c0,    // 20 sen - silver
    10: 0xcd7f32,    // 10 sen - bronze
    5: 0xb87333,     // 5 sen - copper
  };

  // Create bill meshes in note slots (front row)
  for (let i = 0; i < 6; i++) {
    const denom = noteDenoms[i];
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(noteSlotW * 0.9, DRAWER_HEIGHT_M * 0.7, noteSlotD),
      slotMat,
    );
    slot.position.set(
      -DRAWER_WIDTH_M / 2 + noteSlotW / 2 + i * noteSlotW,
      DRAWER_HEIGHT_M * 0.5,
      -DRAWER_DEPTH_M / 2 + noteSlotD / 2 + 0.01,
    );
    drawerGroup.add(slot);

    // Add 3-4 bills per denomination slot
    const billMeshes: THREE.Group[] = [];
    const billsPerSlot = 4;
    const billWidth = 0.07;  // ~7cm wide (like real bills)
    const billHeight = 0.001; // 1mm thick
    const billDepth = 0.035; // ~3.5cm tall
    for (let b = 0; b < billsPerSlot; b++) {
      const bill = createBillMesh(denom, billColors[denom], billWidth, billHeight, billDepth);
      bill.position.set(
        slot.position.x + (b - billsPerSlot / 2 + 0.5) * (billWidth * 0.8),
        DRAWER_HEIGHT_M * 0.5 + billHeight / 2 + b * 0.001,
        slot.position.z,
      );
      bill.name = `bill-${denom}-${b}`;
      bill.userData.denomSen = denom;
      drawerGroup.add(bill);
      billMeshes.push(bill);
    }
    billCoinMeshes.set(denom, billMeshes);
  }

  // Create coin meshes in coin slots (back row)
  for (let i = 0; i < 4; i++) {
    const denom = coinDenoms[i];
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(coinSlotW * 0.9, DRAWER_HEIGHT_M * 0.5, coinSlotD),
      slotMat,
    );
    slot.position.set(
      -DRAWER_WIDTH_M / 2 + coinSlotW / 2 + i * coinSlotW,
      DRAWER_HEIGHT_M * 0.35,
      DRAWER_DEPTH_M / 2 - coinSlotD / 2 - 0.01,
    );
    drawerGroup.add(slot);

    // Add 4-5 coins per denomination slot
    const coinMeshes: THREE.Group[] = [];
    const coinsPerSlot = 5;
    const coinRadius = 0.012; // 1.2cm radius
    const coinThickness = 0.002; // 2mm thick
    for (let c = 0; c < coinsPerSlot; c++) {
      const coin = createCoinMesh(denom, coinColors[denom], coinRadius, coinThickness);
      coin.position.set(
        slot.position.x + (c - coinsPerSlot / 2 + 0.5) * (coinRadius * 1.8),
        DRAWER_HEIGHT_M * 0.35 + coinThickness / 2 + c * 0.001,
        slot.position.z,
      );
      coin.name = `coin-${denom}-${c}`;
      coin.userData.denomSen = denom;
      drawerGroup.add(coin);
      coinMeshes.push(coin);
    }
    billCoinMeshes.set(denom, coinMeshes);
  }

  // Drawer starts closed (positioned at machine front)
  drawerGroup.position.set(
    0,
    DRAWER_BOTTOM_ABOVE_BASE_M + DRAWER_HEIGHT_M / 2,
    MACHINE_DEPTH_M / 2 + DRAWER_DEPTH_M / 2,
  );
  group.add(drawerGroup);

  // --- Receipt printer (far right, back) ---
  const printerGroup = new THREE.Group();
  printerGroup.name = "printer";

  const printerBody = new THREE.Mesh(
    new THREE.BoxGeometry(PRINTER_WIDTH_M, PRINTER_HEIGHT_M, PRINTER_DEPTH_M),
    printerMat,
  );
  printerBody.position.y = PRINTER_HEIGHT_M / 2;
  printerGroup.add(printerBody);

  // Paper slot (front face)
  const printerSlot = new THREE.Mesh(
    new THREE.BoxGeometry(PRINTER_WIDTH_M * 0.7, 0.004, PRINTER_DEPTH_M * 0.3),
    paperMat,
  );
  printerSlot.position.set(
    0,
    PRINTER_HEIGHT_M * 0.3,
    PRINTER_DEPTH_M / 2 + 0.002,
  );
  printerSlot.name = "printer-slot";
  printerGroup.add(printerSlot);

  printerGroup.position.set(
    MACHINE_WIDTH_M / 2 + PRINTER_OFFSET_X,
    MACHINE_HEIGHT_M + PRINTER_HEIGHT_M / 2,
    MACHINE_DEPTH_M / 2 - PRINTER_DEPTH_M / 2 + PRINTER_OFFSET_Z,
  );
  group.add(printerGroup);

  return {
    group,
    screenCenter,
    scannerTip: scannerTipLocal.clone().applyMatrix4(scannerGroup.matrixWorld),
    scannerDir: scannerDirLocal.clone().applyMatrix4(scannerGroup.matrixWorld).normalize(),
    keyMeshes,
    drawerGroup,
    drawerHandle,
    printerSlot,
    billCoinMeshes,
  };
}

// ---------------------------------------------------------------------------
// CSS2D screen overlay content — mirrors RegisterController's display but
// optimized for a portrait cashier machine screen.
// ---------------------------------------------------------------------------
function createMachineScreenDOM(): HTMLElement {
  const root = document.createElement("div");
  root.className = "machine-screen";
  root.style.cssText = `
    width: 320px; height: 280px;
    background: #1a1610;
    border: 3px solid #caa46a;
    border-radius: 8px;
    font-family: system-ui, "Segoe UI", "Trebuchet MS", sans-serif;
    color: #e8dcc8;
    display: flex; flex-direction: column;
    padding: 12px; box-sizing: border-box;
    overflow: hidden;
  `;
  root.innerHTML = `
    <div class="screen-header" style="font-size: 11px; font-weight: 800; letter-spacing: 0.15em; color: #caa46a; margin-bottom: 8px; text-transform: uppercase;">KEDAI RUNCIT</div>
    <div class="screen-total" style="font-size: 42px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; color: #ffeb3b; margin-bottom: 6px; line-height: 1;">RM0.00</div>
    <div class="screen-sub" style="font-size: 13px; color: #a89a7c; min-height: 1.4em; margin-bottom: 10px;">Waiting for items…</div>
    <div class="screen-items" style="flex: 1; overflow-y: auto; font-size: 12px; line-height: 1.6; color: #c8b898;"></div>
    <div class="screen-payment" style="font-size: 14px; font-weight: 700; color: #ffeb3b; text-align: center; min-height: 1.5em;"></div>
    <div class="screen-change" style="font-size: 13px; color: #8ab87c; text-align: center; min-height: 1.4em;"></div>
    <div class="screen-hint" style="font-size: 11px; color: #caa46a; text-align: center; min-height: 1.2em;"></div>
  `;
  return root;
}

// ---------------------------------------------------------------------------
// CashierMachine runtime — owns the 3D prop, screen overlay, scanner,
// keypad, drawer, and printer. Integrates with CheckoutFlow and session.
// ---------------------------------------------------------------------------
export interface CashierMachine {
  /** Call once per frame with clamped dt. */
  update(dt: number): void;
  /** Start a sale for the given customer. */
  begin(customer: Customer, customerAvatar?: CustomerAvatar): void;
  /** Abandon the current sale (Escape). */
  abandon(): void;
  /** True when a pack is waiting at the scanner and can be scanned. */
  canScan(): boolean;
  /** Called when player scans an item at the machine. */
  onItemScanned(): void;
  /** Called when player receives cash from customer. */
  onCashReceived(): void;
  /** Called when player gives change (denomination in sen). */
  onChangeGiven(denomSen: number): void;
  /** True if drawer is open. */
  isDrawerOpen(): boolean;
  /** Toggle drawer open/closed (hold E on handle/front). */
  toggleDrawer(): void;
  /** The screen DOM element (positioned by main.ts via world projection). */
  getScreenElement(): HTMLElement;
  /** The screen centre in WORLD coordinates (projected by main.ts). */
  getScreenCenter(): THREE.Vector3;
  /** Get scanner tip world position for laser. */
  getScannerTip(): THREE.Vector3;
  /** Get scanner direction for laser. */
  getScannerDir(): THREE.Vector3;
  /** Get keypad meshes for raycast. */
  getKeyMeshes(): Map<number, THREE.Mesh>;
  /** Get drawer handle mesh for raycast. */
  getDrawerHandle(): THREE.Mesh;
  /** Get printer slot mesh for visual feedback. */
  getPrinterSlot(): THREE.Mesh;
  /** Get bill/coin meshes in drawer for raycast picking. */
  getBillCoinMeshes(): Map<number, THREE.Group[]>;
  /** Register a callback fired when the sale completes (exact change given). */
  onComplete(handler: (completed: boolean, customer: Customer | null) => void): void;
}

interface Customer {
  name: string;
  basket: { id: string; name: string; priceSen: number }[];
  basketTotalSen: number;
  tenderNoteSen: number;
}

type Phase = "idle" | "scanning" | "payment" | "change" | "done";

interface MachineSession {
  customer: Customer;
  scanned: number;
  totalSen: number;
  phase: Phase;
  tenderedSen: number | null;
  changeDueSen: number;
  given: number[];
  givenSen: number;
}

function createMachineSession(customer: Customer): MachineSession {
  return {
    customer,
    scanned: 0,
    totalSen: 0,
    phase: "scanning",
    tenderedSen: null,
    changeDueSen: 0,
    given: [],
    givenSen: 0,
  };
}

function formatSen(sen: number): string {
  const rm = sen / 100;
  return `RM${rm.toFixed(2)}`;
}

export function createCashierMachine(
  scene: THREE.Scene,
  props: ReturnType<typeof buildCashierMachineProps>,
  checkoutFlow: { canScan: () => boolean; onItemScanned: () => void; abandon: () => void; update: (dt: number) => void },
): CashierMachine {
  let completeHandler: ((completed: boolean, customer: Customer | null) => void) | null = null;
  const THANK_YOU_MS = 1000;
  let thankYouTimer: ReturnType<typeof setTimeout> | null = null;
  const { group, screenCenter, scannerTip, scannerDir, keyMeshes, drawerGroup, drawerHandle, printerSlot, billCoinMeshes } = props;

  // Add prop group to scene
  scene.add(group);

  // Screen DOM overlay.
  //
  // This is deliberately NOT a CSS2DObject: the DOM layer is glued to the
  // machine's WORLD position by main.ts (projecting getScreenCenter() each
  // frame), so the screen stays on the register and never tracks the camera.
  // The element lives in <body> at a fixed 320x280 base size; main.ts
  // translates + scales it to cover the machine's 3D screen face.
  const screenDom = createMachineScreenDOM();
  screenDom.style.position = "fixed";
  screenDom.style.left = "0";
  screenDom.style.top = "0";
  screenDom.style.transformOrigin = "top left";
  screenDom.style.pointerEvents = "none";
  screenDom.style.zIndex = "10";
  screenDom.style.display = "none"; // hidden until main.ts projects it on-screen
  screenDom.style.willChange = "transform";
  document.body.appendChild(screenDom);

  // DOM element references
  const totalEl = screenDom.querySelector(".screen-total")! as HTMLElement;
  const subEl = screenDom.querySelector(".screen-sub")! as HTMLElement;
  const itemsEl = screenDom.querySelector(".screen-items")! as HTMLElement;
  const paymentEl = screenDom.querySelector(".screen-payment")! as HTMLElement;
  const changeEl = screenDom.querySelector(".screen-change")! as HTMLElement;
  const hintEl = screenDom.querySelector(".screen-hint")! as HTMLElement;

  // Scanner laser line
  const laserMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });
  const laserGeometry = new THREE.BufferGeometry();
  const laserPositions = new Float32Array(6); // 2 points * 3
  laserGeometry.setAttribute("position", new THREE.BufferAttribute(laserPositions, 3));
  const laserLine = new THREE.Line(laserGeometry, laserMaterial);
  laserLine.visible = false;
  scene.add(laserLine);

  // Drawer animation state
  let drawerOpen = false;
  let drawerTargetZ = 0; // 0 = closed, DRAWER_PULL_DISTANCE_M = open
  let drawerCurrentZ = 0;

  // Session state
  let session: MachineSession | null = null;
  let active = false;

  // Laser flash timer
  let laserTimer = 0;
  const LASER_DURATION_S = 0.15;

  // Printer animation
  let printerTimer = 0;
  const PRINTER_DURATION_S = 1.0;

  // Current customer avatar for handoff animations
  let currentCustomerAvatar: CustomerAvatar | null = null;

  // Helper to update screen DOM from session
  function renderScreen(): void {
    if (!session) return;
    const s = session;

    totalEl.textContent = formatSen(s.totalSen);

    if (s.phase === "scanning") {
      subEl.textContent = s.scanned === 0
        ? "Waiting for items…"
        : `✓ ${s.customer.basket[s.scanned - 1].name} — ${formatSen(s.customer.basket[s.scanned - 1].priceSen)} · ${s.scanned}/${s.customer.basket.length}`;

      // Item list
      itemsEl.innerHTML = s.customer.basket.map((item, i) => {
        if (i < s.scanned) {
          return `<div style="color:#8ab87c;">✓ ${item.name} <span style="float:right;">${formatSen(item.priceSen)}</span></div>`;
        } else if (i === s.scanned) {
          return `<div style="color:#ffeb3b;">→ ${item.name} <span style="float:right;">${formatSen(item.priceSen)}</span></div>`;
        } else {
          return `<div style="color:#888;">${item.name} <span style="float:right;">${formatSen(item.priceSen)}</span></div>`;
        }
      }).join("");

      paymentEl.textContent = "";
      changeEl.textContent = "";
      hintEl.textContent = "";
    } else if (s.phase === "payment") {
      subEl.textContent = `${s.customer.name} is paying…`;
      paymentEl.textContent = `Received: ${formatSen(s.tenderedSen ?? 0)}`;
      changeEl.textContent = "";
      hintEl.textContent = "";
    } else if (s.phase === "change") {
      subEl.textContent = `${s.customer.name} is waiting for change…`;
      paymentEl.textContent = `Received: ${formatSen(s.tenderedSen ?? 0)}`;
      changeEl.textContent = `Change due: ${formatSen(s.changeDueSen)}  |  Given: ${formatSen(s.givenSen)}`;
      const remaining = s.changeDueSen - s.givenSen;
      if (remaining > 0) {
        // Suggest next denomination
        for (const d of DENOMS_SEN) {
          if (d <= remaining) {
            hintEl.textContent = `Suggested: ${DENOM_LABELS[d]}`;
            break;
          }
        }
      } else {
        hintEl.textContent = "Change complete — close drawer";
      }
    } else if (s.phase === "done") {
      subEl.textContent = "Terima kasih! Come again.";
      paymentEl.textContent = "";
      changeEl.textContent = "";
      hintEl.textContent = "";
    }
  }

  // Drawer animation
  function updateDrawer(dt: number): void {
    const speed = 1.2; // m/s
    if (drawerOpen) {
      drawerCurrentZ = Math.min(DRAWER_PULL_DISTANCE_M, drawerCurrentZ + speed * dt);
    } else {
      drawerCurrentZ = Math.max(0, drawerCurrentZ - speed * dt);
    }
    drawerGroup.position.z = MACHINE_DEPTH_M / 2 + DRAWER_DEPTH_M / 2 + drawerCurrentZ;
  }

  // Laser flash
  function updateLaser(dt: number): void {
    if (laserTimer > 0) {
      laserTimer -= dt;
      if (laserTimer <= 0) {
        laserLine.visible = false;
      }
    }
  }

  // Printer paper feed animation
  function updatePrinter(dt: number): void {
    if (printerTimer > 0) {
      printerTimer -= dt;
      // Pulse the paper slot brightness
      const pulse = Math.sin(printerTimer * 20) * 0.5 + 0.5;
      (printerSlot.material as THREE.MeshBasicMaterial).opacity = 0.5 + pulse * 0.5;
      if (printerTimer <= 0) {
        (printerSlot.material as THREE.MeshBasicMaterial).opacity = 1;
      }
    }
  }

  return {
    update(dt: number) {
      if (!active) return;
      checkoutFlow.update?.(dt); // delegate belt movement
      updateDrawer(dt);
      updateLaser(dt);
      updatePrinter(dt);

      // Auto-close when sale is done (after thank you delay)
      if (session?.phase === "done" && !thankYouTimer) {
        thankYouTimer = setTimeout(() => {
          thankYouTimer = null;
          if (active && session?.phase === "done") {
            const servedCustomer = session.customer;
            active = false;
            session = null;
            drawerOpen = false;
            drawerTargetZ = 0;
            renderScreen();
            completeHandler?.(true, servedCustomer);
          }
        }, THANK_YOU_MS);
      }
    },

    begin(customer: Customer, customerAvatar?: CustomerAvatar) {
      checkoutFlow.abandon();
      if (thankYouTimer) {
        clearTimeout(thankYouTimer);
        thankYouTimer = null;
      }
      session = createMachineSession(customer);
      active = true;
      drawerOpen = false;
      drawerTargetZ = 0;
      drawerCurrentZ = 0;
      currentCustomerAvatar = customerAvatar ?? null;
      renderScreen();
    },

    abandon() {
      if (thankYouTimer) {
        clearTimeout(thankYouTimer);
        thankYouTimer = null;
      }
      active = false;
      session = null;
      drawerOpen = false;
      drawerTargetZ = 0;
      currentCustomerAvatar = null;
      renderScreen();
      completeHandler?.(false, null);
    },

    canScan() {
      return active && session?.phase === "scanning" && checkoutFlow.canScan();
    },

    onItemScanned() {
      if (!active || !session || session.phase !== "scanning") return;
      const item = session.customer.basket[session.scanned];
      session.scanned += 1;
      session.totalSen += item.priceSen;

      if (session.scanned >= session.customer.basket.length) {
        session.phase = "payment";
        // Auto-receive payment after a short beat (customer hands cash)
        setTimeout(() => {
          if (active && session && session.phase === "payment") {
            session.tenderedSen = session.customer.tenderNoteSen;
            session.changeDueSen = session.tenderedSen - session.totalSen;
            if (session.changeDueSen === 0) {
              session.phase = "done";
            } else {
              session.phase = "change";
            }
            // Customer hands cash to player
            if (currentCustomerAvatar) {
              animateCustomerHandoff(currentCustomerAvatar, "give", () => {
                // Midpoint: cash transfers from customer to player
                // Could add 3D bill animation here
              });
            }
            renderScreen();
          }
        }, 800);
      }

      checkoutFlow.onItemScanned();
      // Flash scanner laser
      laserTimer = LASER_DURATION_S;
      laserLine.visible = true;
      const tip = new THREE.Vector3().copy(scannerTip).applyMatrix4(group.matrixWorld);
      const dir = new THREE.Vector3().copy(scannerDir).applyMatrix4(group.matrixWorld).normalize();
      const end = tip.clone().addScaledVector(dir, 1.5); // long enough to hit belt
      laserPositions[0] = tip.x; laserPositions[1] = tip.y; laserPositions[2] = tip.z;
      laserPositions[3] = end.x; laserPositions[4] = end.y; laserPositions[5] = end.z;
      laserGeometry.attributes.position.needsUpdate = true;

      renderScreen();
    },

    onCashReceived() {
      // Called when player clicks to receive cash from customer
      // Payment phase auto-advances after timeout above
    },

    onChangeGiven(denomSen: number) {
      if (!active || !session || session.phase !== "change") return;
      session.given.push(denomSen);
      session.givenSen += denomSen;
      // Player gives change to customer
      if (currentCustomerAvatar) {
        animateCustomerHandoff(currentCustomerAvatar, "receive", () => {
          // Midpoint: change transfers from player to customer
        });
      }
      if (session.givenSen >= session.changeDueSen) {
        session.phase = "done";
        // Printer animation
        printerTimer = PRINTER_DURATION_S;
      }
      renderScreen();
    },

    isDrawerOpen() {
      return drawerOpen;
    },

    toggleDrawer() {
      drawerOpen = !drawerOpen;
    },

    getScreenElement() {
      return screenDom;
    },

    getScreenCenter() {
      return screenCenter.clone().applyMatrix4(group.matrixWorld);
    },

    getScannerTip() {
      return new THREE.Vector3().copy(scannerTip).applyMatrix4(group.matrixWorld);
    },

    getScannerDir() {
      return new THREE.Vector3().copy(scannerDir).applyMatrix4(group.matrixWorld).normalize();
    },

    getKeyMeshes() {
      return keyMeshes;
    },

    getDrawerHandle() {
      return drawerHandle;
    },

    getPrinterSlot() {
      return printerSlot;
    },

    getBillCoinMeshes() {
      return billCoinMeshes;
    },

    onComplete(handler: (completed: boolean, customer: Customer | null) => void) {
      completeHandler = handler;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createKeyLabelTexture(text: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a1610";
  ctx.fillRect(0, 0, size, size);
  ctx.font = `bold ${size * 0.35}px system-ui, sans-serif`;
  ctx.fillStyle = "#e8dcc8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createBillMesh(denom: number, color: number, width: number, height: number, depth: number): THREE.Group {
  const group = new THREE.Group();

  // Bill body
  const bodyGeo = new THREE.BoxGeometry(width, height, depth);
  const bodyMat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Denomination text on both sides (CanvasTexture)
  const label = createBillLabelTexture(DENOM_LABELS[denom], color);
  const labelMat = new THREE.MeshBasicMaterial({ map: label, transparent: true, side: THREE.DoubleSide, depthTest: false });
  const labelGeo = new THREE.PlaneGeometry(width * 0.8, depth * 0.6);
  const frontLabel = new THREE.Mesh(labelGeo, labelMat);
  frontLabel.position.set(0, height / 2 + 0.0001, depth / 2 + 0.0001);
  frontLabel.rotation.x = -Math.PI / 2;
  group.add(frontLabel);
  const backLabel = frontLabel.clone();
  backLabel.position.z = -depth / 2 - 0.0001;
  backLabel.rotation.x = Math.PI / 2;
  group.add(backLabel);

  // Security strip (thin vertical line)
  const stripGeo = new THREE.BoxGeometry(0.001, height * 2, depth * 0.3);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const strip = new THREE.Mesh(stripGeo, stripMat);
  strip.position.set(width * 0.3, 0, 0);
  group.add(strip);

  return group;
}

function createCoinMesh(denom: number, color: number, radius: number, thickness: number): THREE.Group {
  const group = new THREE.Group();

  // Coin body (cylinder)
  const bodyGeo = new THREE.CylinderGeometry(radius, radius, thickness, 24);
  const bodyMat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Denomination text on both faces
  const label = createCoinLabelTexture(DENOM_LABELS[denom], color);
  const labelMat = new THREE.MeshBasicMaterial({ map: label, transparent: true, side: THREE.DoubleSide, depthTest: false });
  const labelGeo = new THREE.CircleGeometry(radius * 0.7, 16);
  const frontLabel = new THREE.Mesh(labelGeo, labelMat);
  frontLabel.position.set(0, thickness / 2 + 0.0001, 0);
  frontLabel.rotation.x = -Math.PI / 2;
  group.add(frontLabel);
  const backLabel = frontLabel.clone();
  backLabel.position.y = -thickness / 2 - 0.0001;
  backLabel.rotation.x = Math.PI / 2;
  group.add(backLabel);

  // Reeded edge (thin torus)
  const edgeGeo = new THREE.TorusGeometry(radius, 0.0005, 8, 32);
  const edgeMat = new THREE.MeshLambertMaterial({ color: Math.max(0, color - 0x202020), flatShading: true });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.rotation.x = Math.PI / 2;
  group.add(edge);

  return group;
}

function createBillLabelTexture(text: string, bgColor: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Background
  ctx.fillStyle = `#${bgColor.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, size, size);
  // Subtle pattern
  ctx.fillStyle = `rgba(255,255,255,0.1)`;
  for (let x = 0; x < size; x += 8) {
    for (let y = 0; y < size; y += 8) {
      ctx.fillRect(x, y, 4, 4);
    }
  }
  // Text
  ctx.font = `bold ${size * 0.25}px system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createCoinLabelTexture(text: string, bgColor: number): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Background circle
  ctx.fillStyle = `#${bgColor.toString(16).padStart(6, '0')}`;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  // Text
  ctx.font = `bold ${size * 0.3}px system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}