import * as THREE from "three";
import "../style.css";
import { WebGLCheck } from "./WebGLCheck";
import { buildStoreShell } from "./storeShell";
import { buildStore, TILL_X, TILL_Z } from "./storeLayout";
import { loadAssets } from "./assets";
import { FpsController } from "../player/FpsController";
import { eyeHeightM } from "../player/movement";
import type { Aabb } from "../player/colliders";
import { Customers3D, type CustomerAvatar } from "../game/customers3d";
import { TillStation } from "../game/TillStation";
import { CheckoutFlow } from "./checkoutFlow";
import { CashierMachine, STAND_W, STORE_NAME, type SaleResult } from "./cashierMachine";
import { playDoorChime, playPlip, primeAudio, setMasterVolume, startAmbience } from "../audio/cues";
import { formatRinggit } from "../register/money";
import { loadGame, saveGame } from "../state/save";
import { loadSettings, saveSettings, type Settings } from "../state/settings";
import { resolveTooltip, TOOLTIP_MAX_DISTANCE_M } from "../game/hover";
import {
  SHIFT_OPEN_MIN,
  advanceClock,
  emptyStats,
  formatClock,
  isAfterClosing,
  recordSale,
  type ShiftStats,
} from "../game/shift";
import { FLOAT_SEN } from "../register/drawer";

// Clamp the per-frame delta (≤ 50 ms) so a tab-switch resume can't tunnel
// the player through walls. Declared above the boot guard: boot() runs
// synchronously and animate() reads this on the first frame.
const MAX_FRAME_DELTA_S = 0.05;
/** Seconds the camera takes to glide to / from the cashier's view. */
const CAMERA_GLIDE_S = 0.55;

// Hover tint written into the hovered instance's instanceColor slot and the
// write-back value used on unhover. Shared, never mutated.
const HOVER_TINT = new THREE.Color(1.35, 1.25, 1.12);
const INSTANCE_BASE_COLOR = new THREE.Color(1, 1, 1);

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
  const hemisphere = new THREE.HemisphereLight(0xfff3e0, 0xb89a72, 1.0);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe6c0, 1.4);
  sun.position.set(6, 9, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffe0bd, 0.5);
  fill.position.set(-5, 6, -8);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.rotation.order = "YXZ"; // yaw (Y) then pitch (X)

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // -------------------------------------------------------------------------
  // Settings, save, HUD
  // -------------------------------------------------------------------------
  let settings: Settings = loadSettings();
  setMasterVolume(settings.volume);

  const saved = loadSavedGame();
  let moneySen = saved?.moneySen ?? 0;
  let day = saved?.day ?? 1;
  let clockMinutes = SHIFT_OPEN_MIN;
  let stats: ShiftStats = emptyStats();
  let dayOver = false;

  const hud = buildHud();
  const renderMoney = (): void => {
    hud.money.textContent = `Takings: ${formatRinggit(moneySen)}`;
  };
  let lastChangeKey = "";
  const renderChangePanel = (status: { dueSen: number; onTraySen: number; hint: string | null } | null): void => {
    const key = status ? `${status.dueSen}|${status.onTraySen}|${status.hint ?? ""}` : "";
    if (key === lastChangeKey) return;
    lastChangeKey = key;
    hud.change.hidden = status === null;
    if (!status) return;
    hud.change.querySelector(".cp-due")!.textContent = formatRinggit(status.dueSen);
    const tray = hud.change.querySelector<HTMLElement>(".cp-tray")!;
    tray.textContent = formatRinggit(status.onTraySen);
    tray.dataset.state = status.onTraySen === status.dueSen ? "exact" : status.onTraySen > status.dueSen ? "over" : "short";
    const hint = hud.change.querySelector<HTMLElement>(".cp-hint")!;
    hint.hidden = status.hint === null;
    hint.textContent = status.hint ? `Hint: ${status.hint}` : "";
  };
  const renderClock = (): void => {
    hud.clock.textContent = `Hari ${day} · ${formatClock(clockMinutes)}`;
  };
  renderMoney();
  renderClock();
  const persist = (): void => {
    try {
      saveGame({ version: 2, moneySen, day });
    } catch {
      // Storage full/blocked — progress still counts in memory.
    }
  };

  // Shell builds floor + walls + fog and returns the shared wall colliders.
  const shellColliders = buildStoreShell(scene);
  const player = new FpsController(shellColliders, renderer.domElement);
  player.setSensitivity(settings.sensitivity);
  camera.position.set(player.position().x, eyeHeightM(), player.position().z);

  const tillStation = new TillStation();
  // While the till is open the player is frozen and the mouse is free for
  // the scanner, bags, the customer's payment and the drawer.
  let playerFrozen = false;
  let paused = true; // start screen
  let awaitingResume = false;
  let summaryOpen = false;
  let customers: Customers3D | null = null;
  let checkoutFlow: CheckoutFlow | null = null;
  let machine: CashierMachine | null = null;
  let tillAvatar: CustomerAvatar | null = null;

  // -------------------------------------------------------------------------
  // Hover tooltip + crosshair. A center-screen raycast shows a name + price
  // pill within 2.2 m of a shelf product and brightens the hovered instance
  // via instanceColor. Shared materials are never mutated.
  // -------------------------------------------------------------------------
  const crosshairEl = document.getElementById("crosshair");
  const tooltipEl = document.getElementById("item-tooltip");
  const tooltipTitleEl = tooltipEl?.querySelector<HTMLDivElement>(".tip-title") ?? null;
  const tooltipPriceEl = tooltipEl?.querySelector<HTMLDivElement>(".tip-price") ?? null;

  const hoverRaycaster = new THREE.Raycaster();
  hoverRaycaster.far = TOOLTIP_MAX_DISTANCE_M;
  const raycastCenter = new THREE.Vector2(0, 0);
  let hoverCandidates: THREE.Mesh[] = [];
  let lastTooltipId: string | undefined;

  const setCrosshairHidden = (hidden: boolean): void => {
    if (crosshairEl) crosshairEl.hidden = hidden;
  };
  const updateCrosshairVisibility = (): void => {
    setCrosshairHidden(document.pointerLockElement == null);
  };
  updateCrosshairVisibility();

  let tooltipVisible = false;
  const setTooltipVisible = (visible: boolean): void => {
    if (!tooltipEl || tooltipVisible === visible) return;
    tooltipVisible = visible;
    tooltipEl.hidden = !visible;
    tooltipEl.setAttribute("aria-hidden", visible ? "false" : "true");
  };

  const showTooltip = (productId: string): void => {
    if (productId !== lastTooltipId) {
      const resolved = resolveTooltip(productId);
      if (!resolved) {
        lastTooltipId = undefined;
        setTooltipVisible(false);
        return;
      }
      if (tooltipTitleEl) tooltipTitleEl.textContent = resolved.title;
      if (tooltipPriceEl) tooltipPriceEl.textContent = resolved.price;
      lastTooltipId = productId;
    }
    setTooltipVisible(true);
  };

  const hideTooltip = (): void => {
    lastTooltipId = undefined;
    setTooltipVisible(false);
  };

  const HOVER_EMISSIVE = "#3a2a00";
  interface HoverLift {
    mesh: THREE.Mesh;
    instanceId: number | null;
    original: THREE.Material | THREE.Material[] | null;
    clones: THREE.Material[];
  }
  let hoverLift: HoverLift | null = null;

  const liftOne = (material: THREE.Material): THREE.Material => {
    const clone = material.clone();
    const emissive = (clone as THREE.MeshStandardMaterial).emissive;
    if (emissive) emissive.set(HOVER_EMISSIVE);
    return clone;
  };

  const unliftHovered = (): void => {
    if (!hoverLift) return;
    const { mesh, instanceId, original, clones } = hoverLift;
    if (instanceId !== null && (mesh as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = mesh as THREE.InstancedMesh;
      if (instanced.instanceColor) {
        instanced.setColorAt(instanceId, INSTANCE_BASE_COLOR);
        instanced.instanceColor.needsUpdate = true;
      }
    } else if (original !== null) {
      mesh.material = original;
      for (const clone of clones) clone.dispose();
    }
    hoverLift = null;
  };

  const liftHovered = (mesh: THREE.Mesh, instanceId?: number): void => {
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const slot =
      instanced && typeof instanceId === "number" && Number.isInteger(instanceId) && instanceId >= 0 && instanceId < instanced.count
        ? instanceId
        : null;
    if (instanced) {
      if (slot === null) {
        unliftHovered();
        return;
      }
      if (hoverLift?.mesh === mesh && hoverLift.instanceId === slot) return;
      unliftHovered();
      instanced.setColorAt(slot, HOVER_TINT);
      if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      hoverLift = { mesh, instanceId: slot, original: null, clones: [] };
      return;
    }
    if (hoverLift?.mesh === mesh && hoverLift.instanceId === null) return;
    unliftHovered();
    const original = mesh.material;
    if (Array.isArray(original)) {
      const clones = original.map(liftOne);
      mesh.material = clones;
      hoverLift = { mesh, instanceId: null, original, clones };
      return;
    }
    const clone = liftOne(original);
    mesh.material = clone;
    hoverLift = { mesh, instanceId: null, original, clones: [clone] };
  };

  const hideHover = (): void => {
    hideTooltip();
    unliftHovered();
  };

  const productIdOf = (obj: THREE.Object3D): string | null => {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const id: unknown = cur.userData?.productId;
      if (typeof id === "string" && id.length > 0) return id;
      cur = cur.parent;
    }
    return null;
  };

  // Hidden groups must not ghost as invisible occluders — three's raycaster
  // ignores Object3D.visible.
  const isVisibleInScene = (obj: THREE.Object3D): boolean => {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  };
  const collectHoverCandidates = (): void => {
    const candidates: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!isVisibleInScene(mesh)) return;
      if (mesh.userData?.isRailTag === true) return;
      candidates.push(mesh);
    });
    hoverCandidates = candidates;
  };

  // Shoppers spawn/despawn dynamically — rebuild the occluder snapshot when
  // the crowd changes (cheap version compare per frame).
  let lastCrowdVersion = -1;
  const syncHoverCandidates = (): void => {
    const version = customers?.version ?? 0;
    if (version === lastCrowdVersion) return;
    lastCrowdVersion = version;
    collectHoverCandidates();
  };

  const updateHover = (): void => {
    if (playerFrozen || paused) {
      hideHover();
      return;
    }
    hoverRaycaster.setFromCamera(raycastCenter, camera);
    const hits = hoverRaycaster.intersectObjects(hoverCandidates, false);
    const hit = hits.length > 0 && hits[0].distance <= TOOLTIP_MAX_DISTANCE_M ? hits[0] : undefined;
    const mesh = hit?.object as THREE.Mesh | undefined;
    const productId = hit ? productIdOf(hit.object) : null;
    if (hit && mesh?.isMesh && productId) {
      showTooltip(productId);
      liftHovered(mesh, hit.instanceId);
    } else {
      hideHover();
    }
  };

  // -------------------------------------------------------------------------
  // Camera: first-person, or a glide to/from the cashier's view at the till.
  // -------------------------------------------------------------------------
  type CameraMode = "player" | "toTill" | "till" | "toPlayer";
  let cameraMode: CameraMode = "player";
  let glideT = 0;
  const glideFromPos = new THREE.Vector3();
  const glideFromQuat = new THREE.Quaternion();
  const glideToPos = new THREE.Vector3();
  const tillPos = new THREE.Vector3();
  const tillQuat = new THREE.Quaternion();
  const drawerPos = new THREE.Vector3();
  const drawerQuat = new THREE.Quaternion();
  const playerQuat = new THREE.Quaternion();
  const playerEuler = new THREE.Euler(0, 0, 0, "YXZ");
  // A Camera (not a plain Object3D): its lookAt aims −Z, like the render camera.
  const lookHelper = new THREE.Camera();

  const updateCamera = (dt: number): void => {
    // Slightly wider lens at the till so the customer, belt and drawer fit.
    const fovTarget = cameraMode === "till" || cameraMode === "toTill" ? 76 : 70;
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    }
    if (cameraMode === "player") {
      camera.position.set(player.position().x, eyeHeightM(), player.position().z);
      camera.rotation.set(player.pitch(), player.yaw(), 0);
      return;
    }
    if (cameraMode === "till") {
      // Glance down into the cash drawer while it is open.
      const k = machine?.drawerView() ?? 0;
      const e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(tillPos, drawerPos, e);
      camera.quaternion.slerpQuaternions(tillQuat, drawerQuat, e);
      return;
    }
    glideT = Math.min(1, glideT + dt / CAMERA_GLIDE_S);
    const e = glideT * glideT * (3 - 2 * glideT);
    if (cameraMode === "toTill") {
      camera.position.lerpVectors(glideFromPos, tillPos, e);
      camera.quaternion.slerpQuaternions(glideFromQuat, tillQuat, e);
      if (glideT >= 1) cameraMode = "till";
    } else {
      glideToPos.set(player.position().x, eyeHeightM(), player.position().z);
      playerEuler.set(player.pitch(), player.yaw(), 0, "YXZ");
      playerQuat.setFromEuler(playerEuler);
      camera.position.lerpVectors(glideFromPos, glideToPos, e);
      camera.quaternion.slerpQuaternions(glideFromQuat, playerQuat, e);
      if (glideT >= 1) cameraMode = "player";
    }
  };

  const glideToTill = (): void => {
    if (!machine) return;
    const pose = machine.cameraPose("counter");
    tillPos.copy(pose.position);
    lookHelper.position.copy(pose.position);
    lookHelper.lookAt(pose.target);
    tillQuat.copy(lookHelper.quaternion);
    const drawer = machine.cameraPose("drawer");
    drawerPos.copy(drawer.position);
    lookHelper.position.copy(drawer.position);
    lookHelper.lookAt(drawer.target);
    drawerQuat.copy(lookHelper.quaternion);
    glideFromPos.copy(camera.position);
    glideFromQuat.copy(camera.quaternion);
    glideT = 0;
    cameraMode = "toTill";
  };

  const glideToPlayer = (): void => {
    glideFromPos.copy(camera.position);
    glideFromQuat.copy(camera.quaternion);
    glideT = 0;
    cameraMode = "toPlayer";
  };

  // -------------------------------------------------------------------------
  // Till open / close
  // -------------------------------------------------------------------------
  const openTill = (): void => {
    if (!machine || !customers || playerFrozen) return;
    const avatar = customers.getTillCustomer();
    if (!avatar || !customers.beginService()) return;
    primeAudio();
    tillAvatar = avatar;
    try {
      machine.begin(avatar);
    } catch (error) {
      console.error("[main] Could not open the till — sale rolled back.", error);
      checkoutFlow?.abandon();
      customers.completeService(false);
      tillAvatar = null;
      return;
    }
    playerFrozen = true;
    awaitingResume = false;
    player.releaseKeys();
    if (document.pointerLockElement) document.exitPointerLock();
    hideHover();
    setCrosshairHidden(true);
    hud.legend.hidden = false;
    hud.prompt.hidden = true;
    hud.resume.hidden = true;
    glideToTill();
  };

  const onSaleComplete = (result: SaleResult): void => {
    const s = result.session;
    if (result.paid && s.method) {
      moneySen += s.totalDueSen;
      stats = recordSale(stats, {
        method: s.method,
        totalSen: s.totalDueSen,
        bags: s.bags,
        roundingSen: s.roundingSen,
        changeFirstTry: s.changeDueSen > 0 ? s.changeAttempts === 1 && s.returnedSen === 0 : null,
      });
      renderMoney();
      persist();
    }
    customers?.completeService(result.paid);
    tillAvatar = null;
    playerFrozen = false;
    hud.legend.hidden = true;
    machine?.hover(null);
    renderer.domElement.style.cursor = "";
    glideToPlayer();
    // Browsers usually refuse a pointer-lock request outside a user gesture,
    // so ask for one click to resume walking.
    awaitingResume = true;
    hud.resume.hidden = false;
  };

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  window.addEventListener("keydown", (event) => {
    if (summaryOpen) return;
    if (playerFrozen) {
      if (machine?.handleKey(event.code)) event.preventDefault();
      return;
    }
    if (paused) return;
    // E is the only key outside the till: serve, or close up once everyone's gone.
    if (event.code === "KeyE" && tillStation.isPlayerInside(player.position())) {
      if (customers?.getTillCustomer()) openTill();
      else if (dayOver && customers?.storeEmpty()) openSummary();
      event.preventDefault();
    }
  });

  const pointer = new THREE.Vector2();
  const clickRaycaster = new THREE.Raycaster();
  const toPointer = (event: MouseEvent): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    clickRaycaster.setFromCamera(pointer, camera);
  };
  // Capture phase on the canvas: while the till is open this listener takes
  // the click (scanner, belt, bags, payment, drawer, tray) and stops it reaching the
  // FpsController, whose click handler would re-lock the pointer. Stopping
  // propagation here used to swallow the till's own handler too.
  renderer.domElement.addEventListener(
    "click",
    (event) => {
      if (!playerFrozen) return;
      event.stopImmediatePropagation();
      if (!machine || cameraMode !== "till") return;
      toPointer(event);
      machine.click(clickRaycaster);
    },
    true,
  );
  renderer.domElement.addEventListener("mousemove", (event) => {
    if (!playerFrozen || !machine || cameraMode !== "till") return;
    toPointer(event);
    renderer.domElement.style.cursor = machine.hover(clickRaycaster);
  });

  // -------------------------------------------------------------------------
  // Start / pause menu with settings
  // -------------------------------------------------------------------------
  const menu = buildMenu(settings, (next) => {
    settings = next;
    saveSettings(settings);
    setMasterVolume(settings.volume);
    player.setSensitivity(settings.sensitivity);
  });
  const resumePlay = (): void => {
    paused = false;
    menu.root.hidden = true;
  };
  menu.onPlay = () => {
    primeAudio();
    startAmbience();
    try {
      const result = renderer.domElement.requestPointerLock() as Promise<void> | undefined;
      // Pointer lock refused (e.g. cooldown right after Esc) — play anyway;
      // the next canvas click locks the mouse.
      result?.catch?.(() => resumePlay());
    } catch {
      resumePlay();
    }
  };
  menu.setDay(day);
  menu.show(day === 1 && moneySen === 0 ? "Selamat datang!" : `Hari ${day}`);

  document.addEventListener("pointerlockchange", () => {
    updateCrosshairVisibility();
    if (document.pointerLockElement === renderer.domElement) {
      resumePlay();
      awaitingResume = false;
      hud.resume.hidden = true;
      return;
    }
    // Esc while walking → pause menu (the till and summary own their own UI).
    if (!playerFrozen && !awaitingResume && !summaryOpen) {
      paused = true;
      menu.show("Paused");
    }
  });

  // -------------------------------------------------------------------------
  // Closing time + end-of-shift summary
  // -------------------------------------------------------------------------
  const summary = buildSummary();
  const openSummary = (): void => {
    if (!machine) return;
    summaryOpen = true;
    paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    hud.banner.hidden = true;
    const drawer = machine.drawerCount();
    summary.render(day, stats, {
      floatSen: FLOAT_SEN,
      topUpsSen: drawer.floatAndTopUpsSen - FLOAT_SEN,
      cashSalesSen: stats.byMethod.cash.sen,
      expectedSen: drawer.floatAndTopUpsSen + stats.byMethod.cash.sen,
      countedSen: drawer.actualSen,
    });
    summary.root.hidden = false;
  };
  summary.onNextDay = () => {
    day += 1;
    clockMinutes = SHIFT_OPEN_MIN;
    stats = emptyStats();
    dayOver = false;
    machine?.resetDay();
    customers?.reset();
    persist();
    renderClock();
    summary.root.hidden = true;
    summaryOpen = false;
    menu.setDay(day);
    menu.show(`Hari ${day}`);
  };

  // -------------------------------------------------------------------------
  // Assets → store, belt, POS, customers
  // -------------------------------------------------------------------------
  loadAssets((label, progress) => updateLoading(loading, label, progress))
    .then((bundle) => {
      let colliders: Aabb[] = shellColliders;
      try {
        colliders = buildStore(scene, bundle);
      } catch (error) {
        console.error("[main] buildStore failed — props not shown.", error);
      }
      try {
        checkoutFlow = new CheckoutFlow(scene, bundle);
        checkoutFlow.onItemPlaced = playPlip;
        checkoutFlow.onItemLaunched = () => tillAvatar?.gesture("reach", null, 0.55);
      } catch (error) {
        checkoutFlow = null;
        console.error("[main] Checkout flow setup failed — belt disabled.", error);
      }
      try {
        // POS stand beside the counter's east end, on the cashier's right.
        const counterBox = new THREE.Box3().setFromObject(bundle.counter);
        const standX = TILL_X + counterBox.max.x + 0.06 + STAND_W / 2;
        const standZ = TILL_Z + 0.12;
        machine = new CashierMachine(scene, {
          position: new THREE.Vector3(standX, 0, standZ),
          checkout: checkoutFlow,
          changeHint: () => settings.changeHint,
          toast: (text) => hud.toast(text),
        });
        machine.onComplete = onSaleComplete;
        colliders = [...colliders, ...machine.colliders()];
      } catch (error) {
        machine = null;
        console.error("[main] Cashier machine setup failed.", error);
      }
      player.setColliders(colliders);
      try {
        customers = new Customers3D(scene, camera);
        customers.onArrive = playDoorChime;
      } catch (error) {
        console.error("[main] Customer setup failed — no customers will come.", error);
      }
      collectHoverCandidates();
      hideLoading(loading);
    })
    .catch(() => hideLoading(loading));

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------
  // Dev-only handle for automated play-testing (stripped from production).
  if (import.meta.env.DEV) {
    (window as unknown as { __sim: unknown }).__sim = {
      player,
      camera,
      customers: () => customers,
      machine: () => machine,
      setClock: (minutes: number) => {
        clockMinutes = minutes;
      },
    };
  }

  const timer = new THREE.Timer();
  let lastClockLabel = "";
  const animate = (timestamp?: number): void => {
    requestAnimationFrame(animate);
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), MAX_FRAME_DELTA_S);
    // The world keeps moving at the till; the pause menu and summary stop it.
    const simRunning = playerFrozen || !paused;

    if (simRunning) {
      if (!playerFrozen && cameraMode === "player") player.update(dt);
      clockMinutes = advanceClock(clockMinutes, dt, settings.shiftMinutes * 60);
      if (!dayOver && isAfterClosing(clockMinutes)) {
        dayOver = true;
        hud.toast("10:00 PM — doors closed. Serve the customers still inside.");
      }
      customers?.update(dt, player.position(), clockMinutes, !dayOver);
      checkoutFlow?.update(dt);
      machine?.update(dt);
    }

    const label = formatClock(clockMinutes);
    if (label !== lastClockLabel) {
      lastClockLabel = label;
      renderClock();
      machine?.setClockLabel(label);
    }

    // Context prompt at the till.
    if (!playerFrozen && !paused && tillStation.isPlayerInside(player.position())) {
      const ready = customers?.getTillCustomer();
      hud.prompt.hidden = false;
      hud.prompt.textContent = ready
        ? `E — Serve ${ready.customer.name}`
        : dayOver && customers?.storeEmpty()
          ? "E — Close up and count the drawer"
          : "Waiting for the next customer…";
    } else {
      hud.prompt.hidden = true;
    }
    hud.banner.hidden = !(dayOver && customers?.storeEmpty() && !summaryOpen && !playerFrozen);
    renderChangePanel(cameraMode === "till" ? (machine?.changeStatus() ?? null) : null);

    syncHoverCandidates();
    updateCamera(dt);
    updateHover();
    renderer.render(scene, camera);
  };
  animate();
}

function loadSavedGame(): { moneySen: number; day: number } | null {
  try {
    return loadGame();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HUD: takings, clock, toasts, prompts, till key legend, closing banner
// ---------------------------------------------------------------------------
interface Hud {
  money: HTMLElement;
  clock: HTMLElement;
  prompt: HTMLElement;
  legend: HTMLElement;
  resume: HTMLElement;
  banner: HTMLElement;
  change: HTMLElement;
  toast: (text: string) => void;
}

function buildHud(): Hud {
  const money = document.getElementById("money-hud") ?? document.body.appendChild(document.createElement("div"));
  const clock = document.createElement("div");
  clock.id = "clock-hud";
  document.body.appendChild(clock);

  const prompt = document.createElement("div");
  prompt.id = "interact-prompt";
  prompt.hidden = true;
  document.body.appendChild(prompt);

  const resume = document.getElementById("lock-hint") ?? document.body.appendChild(document.createElement("div"));
  resume.textContent = "Click to resume walking";
  resume.hidden = true;

  const legend = document.createElement("div");
  legend.id = "till-legend";
  legend.hidden = true;
  legend.innerHTML = `
    <div class="legend-title">At the till</div>
    <div>Pick up the scanner, click the item at the scan line</div>
    <div>Click the bag stack to add a bag, a bag to take it back</div>
    <div>Click what the customer holds out to take payment</div>
    <div>Change: click the drawer, then the tray</div>
    <div class="legend-foot"><kbd>Esc</kbd> void the sale</div>`;
  document.body.appendChild(legend);

  const banner = document.createElement("div");
  banner.id = "close-banner";
  banner.hidden = true;
  banner.innerHTML = `<b>Kedai tutup!</b> Everyone's served — press <kbd>E</kbd> at the till to close up and count the drawer.`;
  document.body.appendChild(banner);

  const toastRoot = document.createElement("div");
  toastRoot.id = "toasts";
  document.body.appendChild(toastRoot);
  const toast = (text: string): void => {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    toastRoot.appendChild(el);
    window.setTimeout(() => el.classList.add("toast-out"), 3800);
    window.setTimeout(() => el.remove(), 4300);
  };
  // Large read-out while counting change — the till screen is small from the drawer view.
  const change = document.createElement("div");
  change.id = "change-panel";
  change.hidden = true;
  change.innerHTML = `<div class="cp-row"><span>Change / Baki</span><b class="cp-due"></b></div>
    <div class="cp-row"><span>On tray</span><b class="cp-tray"></b></div>
    <div class="cp-hint"></div>`;
  document.body.appendChild(change);
  return { money, clock, prompt, legend, resume, banner, change, toast };
}

// ---------------------------------------------------------------------------
// Start / pause menu
// ---------------------------------------------------------------------------
interface Menu {
  root: HTMLDivElement;
  onPlay: (() => void) | null;
  show(title: string): void;
  setDay(day: number): void;
}

function buildMenu(initial: Settings, onChange: (s: Settings) => void): Menu {
  const root = document.createElement("div");
  root.id = "menu";
  root.innerHTML = `
    <div class="menu-card">
      <div class="menu-store">${STORE_NAME}</div>
      <div class="menu-title">Selamat datang!</div>
      <div class="menu-sub"></div>
      <button class="menu-play" type="button">Mula kerja — Start shift</button>
      <div class="menu-grid">
        <div class="menu-controls">
          <div class="menu-h">Controls</div>
          <div><kbd>WASD</kbd> walk · mouse to look</div>
          <div><kbd>E</kbd> serve the customer at the till</div>
          <div>Aim at a shelf item to see its price</div>
          <div><kbd>Esc</kbd> pause</div>
        </div>
        <div class="menu-settings">
          <div class="menu-h">Settings</div>
          <label>Mouse sensitivity <input data-k="sensitivity" type="range" min="0.3" max="2" step="0.05"></label>
          <label>Volume <input data-k="volume" type="range" min="0" max="1" step="0.05"></label>
          <label class="menu-check"><input data-k="changeHint" type="checkbox"> Show suggested change</label>
          <label>Shift length
            <select data-k="shiftMinutes">
              <option value="8">8 min (busy)</option>
              <option value="12">12 min</option>
              <option value="20">20 min (relaxed)</option>
            </select>
          </label>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const title = root.querySelector<HTMLDivElement>(".menu-title")!;
  const sub = root.querySelector<HTMLDivElement>(".menu-sub")!;
  const play = root.querySelector<HTMLButtonElement>(".menu-play")!;
  const sens = root.querySelector<HTMLInputElement>('[data-k="sensitivity"]')!;
  const vol = root.querySelector<HTMLInputElement>('[data-k="volume"]')!;
  const hint = root.querySelector<HTMLInputElement>('[data-k="changeHint"]')!;
  const shift = root.querySelector<HTMLSelectElement>('[data-k="shiftMinutes"]')!;
  sens.value = String(initial.sensitivity);
  vol.value = String(initial.volume);
  hint.checked = initial.changeHint;
  shift.value = String(initial.shiftMinutes);
  const emit = (): void => {
    onChange({
      sensitivity: Number(sens.value),
      volume: Number(vol.value),
      changeHint: hint.checked,
      shiftMinutes: Number(shift.value) as Settings["shiftMinutes"],
    });
  };
  for (const el of [sens, vol, hint, shift]) el.addEventListener("input", emit);
  const menu: Menu = {
    root,
    onPlay: null,
    show(text: string) {
      title.textContent = text;
      play.textContent = text === "Paused" ? "Sambung — Resume" : "Mula kerja — Start shift";
      root.hidden = false;
    },
    setDay(day: number) {
      sub.textContent = `Hari ${day} · You're on the till today, 9:00 AM – 10:00 PM.`;
    },
  };
  play.addEventListener("click", () => menu.onPlay?.());
  return menu;
}

// ---------------------------------------------------------------------------
// End-of-shift summary
// ---------------------------------------------------------------------------
interface DrawerCount {
  floatSen: number;
  topUpsSen: number;
  cashSalesSen: number;
  expectedSen: number;
  countedSen: number;
}

interface Summary {
  root: HTMLDivElement;
  onNextDay: (() => void) | null;
  render(day: number, s: ShiftStats, d: DrawerCount): void;
}

function buildSummary(): Summary {
  const root = document.createElement("div");
  root.id = "summary";
  root.hidden = true;
  document.body.appendChild(root);
  const api: Summary = {
    root,
    onNextDay: null,
    render(day, s, d) {
      const rm = formatRinggit;
      const balanced = d.countedSen === d.expectedSen;
      const accuracy = s.changeGiven === 0 ? "—" : `${s.changeFirstTry} / ${s.changeGiven}`;
      root.innerHTML = `
        <div class="summary-card">
          <div class="menu-store">${STORE_NAME}</div>
          <div class="menu-title">Hari ${day} selesai!</div>
          <div class="summary-grid">
            <div class="summary-col">
              <div class="menu-h">Shift</div>
              <div class="srow"><span>Customers served</span><b>${s.customers}</b></div>
              <div class="srow"><span>Total sales</span><b>${rm(s.salesSen)}</b></div>
              <div class="srow"><span>Cash</span><b>${s.byMethod.cash.count} · ${rm(s.byMethod.cash.sen)}</b></div>
              <div class="srow"><span>DuitNow QR</span><b>${s.byMethod.qr.count} · ${rm(s.byMethod.qr.sen)}</b></div>
              <div class="srow"><span>Card</span><b>${s.byMethod.card.count} · ${rm(s.byMethod.card.sen)}</b></div>
              <div class="srow"><span>Plastic bags sold</span><b>${s.bagsSold} · ${rm(s.bagsSold * 20)}</b></div>
              <div class="srow"><span>Rounding (net)</span><b>${s.roundingSen >= 0 ? "+" : "−"}${rm(Math.abs(s.roundingSen))}</b></div>
              <div class="srow"><span>Change right first time</span><b>${accuracy}</b></div>
            </div>
            <div class="summary-col">
              <div class="menu-h">Drawer count</div>
              <div class="srow"><span>Opening float</span><b>${rm(d.floatSen)}</b></div>
              <div class="srow"><span>Supervisor top-ups</span><b>${rm(d.topUpsSen)}</b></div>
              <div class="srow"><span>Cash sales</span><b>${rm(d.cashSalesSen)}</b></div>
              <div class="srow total"><span>Expected</span><b>${rm(d.expectedSen)}</b></div>
              <div class="srow total"><span>Counted</span><b>${rm(d.countedSen)}</b></div>
              <div class="balanced ${balanced ? "ok" : "off"}">${balanced ? "✓ Drawer balanced — cun!" : `Off by ${rm(Math.abs(d.countedSen - d.expectedSen))}`}</div>
            </div>
          </div>
          <button class="menu-play" type="button">Buka kedai — Hari ${day + 1}</button>
        </div>`;
      root.querySelector<HTMLButtonElement>(".menu-play")!.addEventListener("click", () => api.onNextDay?.());
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Loading overlay (#loading): warm cream card, store name, status line and
// progress bar. Hidden until showLoading() runs and removed after the fade.
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
    #loading .loading-status { margin-top: 14px; font-size: 14px; color: #6d5a41; min-height: 1.4em; }
    #loading .loading-track {
      margin: 10px auto 0; width: 240px; height: 10px;
      background: #e2d3b4; border: 1px solid #caa46a; border-radius: 999px; overflow: hidden;
    }
    #loading .loading-fill {
      height: 100%; width: 0%; background: #b45309; border-radius: 999px; transition: width 0.25s ease;
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
      <div class="loading-store">Pasaraya</div>
      <div class="loading-title">${STORE_NAME}</div>
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
