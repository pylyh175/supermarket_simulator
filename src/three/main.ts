import * as THREE from "three";
import "../style.css";
import { WebGLCheck } from "./WebGLCheck";
import { buildStoreShell } from "./storeShell";
import { buildStore } from "./storeLayout";
import { loadAssets } from "./assets";
import { FpsController } from "../player/FpsController";
import { eyeHeightM } from "../player/movement";
import { Customers3D } from "../game/customers3d";
import { TillStation } from "../game/TillStation";
import { RegisterController } from "../ui/RegisterController";
import { formatRinggit } from "../register/money";
import { loadGame, saveGame } from "../state/save";
import type { Customer } from "../customers/generate";

// Clamp the per-frame delta (≤ 50 ms) so a tab-switch resume can't tunnel
// the player through walls. Declared above the boot guard: boot() runs
// synchronously and animate() reads this on the first frame.
const MAX_FRAME_DELTA_S = 0.05;

const loading = createLoadingOverlay();

if (WebGLCheck.assert()) {
  showLoading(loading);
  boot();
}

function boot(): void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    // WebGL context creation can still fail even if the check passed.
    WebGLCheck.showFallback();
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("game")?.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f5efe0"); // warm cream

  // Cozy warm lighting, flat-shaded look — shadows intentionally OFF.
  // Hemisphere: warm white sky over tan ground. Directional: soft warm
  // key light from a slight angle, plus a dim warm fill from the doorway
  // side so the back aisles never fall into harsh shadow.
  const hemisphere = new THREE.HemisphereLight(0xfff3e0, 0xb89a72, 1.0);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe6c0, 1.4);
  sun.position.set(6, 9, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffe0bd, 0.5);
  fill.position.set(-5, 6, -8);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.rotation.order = "YXZ"; // yaw (Y) then pitch (X)

  // Shell builds floor + walls + fog and returns the shared wall colliders.
  // The player starts against walls-only colliders; once the asset bundle
  // resolves, buildStore() appends the props and we swap in the merged list.
  const shellColliders = buildStoreShell(scene);
  const player = new FpsController(shellColliders, renderer.domElement);
  camera.position.set(player.position().x, eyeHeightM(), player.position().z);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Invisible till zone on the cashier side of the counter; the E/Space
  // handler below polls it every press.
  const tillStation = new TillStation();
  // While the till is "open" the player is frozen in place; mouse-look is
  // already dead because we exit pointer lock.
  let playerFrozen = false;
  // Filled once the asset bundle resolves (customers come from the bundle).
  let customers: Customers3D | null = null;

  // Plain-DOM register overlay (Task 7). The 2D Phaser scene is gone; the
  // controller renders straight into index.html's #register-ui skeleton.
  const registerController = new RegisterController();
  // Cash-in-till, integer sen. Task 8: loaded from the save at boot before
  // the first HUD render (no RM0.00 flash), and persisted on every completed
  // sale inside creditMoney() — the one place money changes hands.
  let moneySen = loadSavedMoney() ?? 0;
  renderMoneyHud(moneySen);
  const creditMoney = (amountSen: number): void => {
    moneySen += amountSen;
    renderMoneyHud(moneySen);
    persistMoney(moneySen);
  };
  // The customer currently at the till — captured at open time so the close
  // handler can credit the right basket and complete the service.
  let tillCustomer: Customer | null = null;
  // #labels (customer name DOM, built from JS by customers3d.ts) hides while
  // the till is open — the customer is across the counter and irrelevant to
  // the overlay — and comes back when it closes.
  const setLabelsHidden = (hidden: boolean): void => {
    const labels = document.getElementById("labels");
    if (labels) labels.hidden = hidden;
  };
  registerController.onClose(({ completed }) => {
    const served = tillCustomer;
    tillCustomer = null;
    setLabelsHidden(false);
    // Post-close pointer-lock hint: Chrome's ~1.25 s post-Esc cooldown (or
    // the thank-you timer path) often rejects the immediate re-lock, leaving
    // a dead mouse with no explanation. Show a transient pill for ~3 s; FpsController's
    // click handler does the actual re-lock on the player's next click.
    showLockHint();
    // ANY close path (exact change, or Escape abandon) sends the customer on
    // their way; only a completed sale credits the till.
    customers?.completeService();
    playerFrozen = false;
    // Re-lock pointer inside this gesture where there is one (Escape
    // keydown). The thank-you path closes from a timer — not a gesture —
    // so Chrome may refuse; swallow either way. FpsController's click
    // handler re-locks on the player's next click regardless.
    try {
      const result = renderer.domElement.requestPointerLock() as
        | Promise<void>
        | undefined;
      result?.catch?.(() => {});
    } catch {
      // Pointer lock denied — re-lock happens on the next canvas click.
    }
    if (completed && served) creditMoney(served.basketTotalSen);
  });

  // E / Space at the till: open it for the waiting customer. Multiple
  // presses can't double-launch because beginService() only flips from
  // "waiting" — the second press returns false while we are "serving".
  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyE" && event.code !== "Space") return;
    if (!tillStation.isPlayerInside(player.position())) return;
    if (!customers) return;
    const customer = customers.getActiveCustomer();
    if (!customer) return;
    if (!customers.beginService()) return;
    playerFrozen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    tillCustomer = customer;
    setLabelsHidden(true);
    registerController.open(customer);
    event.preventDefault();
  });

  // Kick off the asset pipeline. The scene shell renders immediately;
  // the bundle resolves in the background (procedural builds are fast,
  // glTFs are small local files) and the overlay fades out on resolve.
  // loadAssets() never throws — a total failure still hides the overlay.
  loadAssets((label, progress) => updateLoading(loading, label, progress))
    .then((bundle) => {
      // Store is built once, here — inject the merged shell+prop collider
      // list so shelves/counters are solid without rebuilding the player.
      try {
        player.setColliders(buildStore(scene, bundle));
      } catch (error) {
        // Store stays unbuilt but the game still boots on shell colliders.
        console.error("[main] buildStore failed — props not shown.", error);
      }
      // Customer flow — bundle ships the 3 capsule variants.
      try {
        customers = new Customers3D(scene, camera, bundle.customers);
        customers.spawnNextCustomer();
      } catch (error) {
        console.error("[main] Customer setup failed — no customers will spawn.", error);
      }
      hideLoading(loading);
    })
    .catch(() => hideLoading(loading));

  const clock = new THREE.Clock();
  const animate = (): void => {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), MAX_FRAME_DELTA_S);
    // Frozen while the till is open: no movement (mouse-look is already
    // dead — pointer lock was exited). The camera still tracks the spot.
    if (!playerFrozen) player.update(dt);
    customers?.update(dt);
    camera.position.set(player.position().x, eyeHeightM(), player.position().z);
    camera.rotation.set(player.pitch(), player.yaw(), 0); // order stays YXZ
    renderer.render(scene, camera);
  };
  animate();
}

// Boot seam (Task 8): load the saved till cash before the first HUD render.
// loadGame already returns null for corrupt/wrong-version saves; the
// try/catch covers a storage that throws on access. Never throws — a bad
// save boots the game with RM0.00.
function loadSavedMoney(): number | null {
  try {
    return loadGame()?.moneySen ?? null;
  } catch {
    return null;
  }
}

// Credit seam (Task 8): persist right after the tally update. A storage
// failure must never reach the game loop or lose the in-memory sale.
function persistMoney(moneySen: number): void {
  try {
    saveGame({ version: 1, moneySen });
  } catch {
    // Storage full/blocked — the sale still counts in memory.
  }
}

function renderMoneyHud(moneySen: number): void {
  const hud = document.getElementById("money-hud");
  if (hud) hud.textContent = `Money: ${formatRinggit(moneySen)}`;
}

// Transient "click the canvas to look around" pill, shown after the till
// closes (covers both the Esc-abandon and the timer-based thank-you paths).
// Auto-hides after ~3 s. A re-show resets the hide timer.
let lockHintTimer: number | undefined;
function showLockHint(): void {
  const hint = document.getElementById("lock-hint");
  if (!hint) return;
  hint.hidden = false;
  window.clearTimeout(lockHintTimer);
  lockHintTimer = window.setTimeout(() => {
    hint.hidden = true;
  }, 3000);
}

// ---------------------------------------------------------------------------
// Loading overlay (#loading): warm cream card, store name, status line and
// progress bar. Built from JS so index.html (Task 1 skeleton) stays untouched;
// hidden until showLoading() runs and removed after the fade-out.
// ---------------------------------------------------------------------------
interface LoadingOverlay {
  root: HTMLDivElement;
  status: HTMLDivElement;
  fill: HTMLDivElement;
}

function createLoadingOverlay(): LoadingOverlay {
  const style = document.createElement("style");
  style.textContent = `
    #loading {
      position: fixed; inset: 0; z-index: 90;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at center, #f9f1de 0%, #efe2c4 100%);
      font-family: system-ui, "Segoe UI", "Trebuchet MS", sans-serif;
      opacity: 1; transition: opacity 0.45s ease;
    }
    #loading[hidden] { display: none; }
    #loading.loading-fade { opacity: 0; pointer-events: none; }
    #loading .loading-card { text-align: center; color: #4a3b28; }
    #loading .loading-store {
      font-size: 13px; font-weight: 800; letter-spacing: 0.35em;
      text-transform: uppercase; color: #a1603a; margin-bottom: 6px;
    }
    #loading .loading-title { font-size: 30px; font-weight: 800; letter-spacing: 0.02em; }
    #loading .loading-status {
      margin-top: 14px; font-size: 14px; color: #6d5a41; min-height: 1.4em;
    }
    #loading .loading-track {
      margin: 10px auto 0; width: 240px; height: 10px;
      background: #e2d3b4; border: 1px solid #caa46a; border-radius: 999px;
      overflow: hidden;
    }
    #loading .loading-fill {
      height: 100%; width: 0%; background: #b45309; border-radius: 999px;
      transition: width 0.25s ease;
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "loading";
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <div class="loading-card">
      <div class="loading-store">Mini Market</div>
      <div class="loading-title">KEDAI RUNCIT</div>
      <div class="loading-status">Menyediakan kedai…</div>
      <div class="loading-track"><div class="loading-fill"></div></div>
    </div>
  `;
  const status = root.querySelector<HTMLDivElement>(".loading-status");
  const fill = root.querySelector<HTMLDivElement>(".loading-fill");
  if (!status || !fill) throw new Error("loading overlay markup incomplete");
  document.body.appendChild(root);
  return { root, status, fill };
}

function showLoading(loading: LoadingOverlay): void {
  loading.root.hidden = false;
}

function updateLoading(loading: LoadingOverlay, label: string, progress: number): void {
  loading.status.textContent = label;
  loading.fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
}

function hideLoading(loading: LoadingOverlay): void {
  loading.root.classList.add("loading-fade");
  const root = loading.root;
  window.setTimeout(() => {
    root.hidden = true;
    root.classList.remove("loading-fade");
  }, 500);
}
