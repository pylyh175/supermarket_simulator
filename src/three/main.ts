import * as THREE from "three";
import "../style.css";
import { WebGLCheck } from "./WebGLCheck";
import { buildStoreShell } from "./storeShell";
import { buildStore } from "./storeLayout";
import { loadAssets } from "./assets";
import { FpsController } from "../player/FpsController";
import { eyeHeightM } from "../player/movement";
import { Customers3D } from "../game/customers3d";
import type { CustomerAvatar } from "../game/customers3d";
import { TillStation } from "../game/TillStation";
import { CheckoutFlow } from "./checkoutFlow";
import { buildCashierMachineProps, createCashierMachine, type CashierMachine } from "./cashierMachine";
import { TILL_X, TILL_Z } from "./storeLayout";
import { playBeep, playPlip, primeAudio } from "../audio/cues";
import { formatRinggit } from "../register/money";
import { loadGame, saveGame } from "../state/save";
import { resolveTooltip, TOOLTIP_MAX_DISTANCE_M } from "../game/hover";
import type { Customer } from "../customers/generate";

// Clamp the per-frame delta (≤ 50 ms) so a tab-switch resume can't tunnel
// the player through walls. Declared above the boot guard: boot() runs
// synchronously and animate() reads this on the first frame.
const MAX_FRAME_DELTA_S = 0.05;

// Hover tint written into the hovered instance's instanceColor slot and the
// write-back value used on unhover (identity — meshes with no instanceColor
// render base white anyway). Shared, never mutated: InstancedMesh.setColorAt
// copies the values into the InstancedBufferAttribute.
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

  // The cashier machine's screen is a plain DOM element glued to the machine's
// WORLD position (see updateMachineScreen below) — not a CSS2DObject — so it
// stays on the register instead of tracking the camera.
  // Base pixel size of the machine-screen DOM element (matches
  // createMachineScreenDOM in cashierMachine.ts). main.ts scales it to the
  // projected size of the 3D screen face each frame.
  const MACHINE_SCREEN_BASE_W = 160; // matches POLE_SCREEN_W_M (0.16 m)
  const MACHINE_SCREEN_BASE_H = 100; // matches POLE_SCREEN_H_M (0.10 m)
  // Half-extents of the 3D screen face (metres) — see cashierMachine.ts.
  const MACHINE_SCREEN_HALF_H_M = 0.05; // POLE_SCREEN_H_M / 2

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Shell builds floor + walls + fog and returns the shared wall colliders.
  // The player starts against walls-only colliders; once the asset bundle
  // resolves, buildStore() appends the props and we swap in the merged list.
  const shellColliders = buildStoreShell(scene);
  const player = new FpsController(shellColliders, renderer.domElement);
  camera.position.set(player.position().x, eyeHeightM(), player.position().z);

  // Invisible till zone on the cashier side of the counter; the E/Space
  // handler below polls it every press.
  const tillStation = new TillStation();
  // While the till is "open" the player is frozen in place; mouse-look is
  // already dead because we exit pointer lock.
  let playerFrozen = false;
  // The POS strip no longer covers the canvas, so a click above it would
  // re-lock the pointer mid-sale and steal the cursor from the change pad.
  // Keep the old modal input behaviour: ignore canvas clicks while frozen
  // (the view stays put; the belt is still visible above the strip).
  renderer.domElement.addEventListener(
    "click",
    (event) => {
      if (playerFrozen) event.stopImmediatePropagation();
    },
    true,
  );
  // Filled once the asset bundle resolves (customers come from the bundle).
  let customers: Customers3D | null = null;
  // Belt/bag/tote props + item pipeline; built with the store bundle so the
  // hover snapshot includes the props as occluders.
  let checkoutFlow: CheckoutFlow | null = null;
  // Cashier machine — owns screen, scanner, keypad, drawer, printer.
  let cashierMachine: CashierMachine | null = null;

  // -------------------------------------------------------------------------
  // Hover tooltip + crosshair (Task 3). A center-screen raycast shows a
  // name + price pill within 2.2 m of a shelf product and brightens the
  // hovered instance via instanceColor — a warm tint written to one slot and
  // cleared back to white on unhover. Instanced product meshes SHARE materials
  // with their archetypes, so shared materials are never mutated; the old
  // material-swap path survives only as a defensive fallback for non-instanced
  // meshes, cloning materials and restoring the originals on unhover.
  // -------------------------------------------------------------------------
  const crosshairEl = document.getElementById("crosshair");
  const tooltipEl = document.getElementById("item-tooltip");
  const tooltipTitleEl =
    tooltipEl?.querySelector<HTMLDivElement>(".tip-title") ?? null;
  const tooltipPriceEl =
    tooltipEl?.querySelector<HTMLDivElement>(".tip-price") ?? null;

  // Reused query state — no per-frame allocation beyond three's own hit list.
  const hoverRaycaster = new THREE.Raycaster();
  hoverRaycaster.far = TOOLTIP_MAX_DISTANCE_M;
  const raycastCenter = new THREE.Vector2(0, 0);
  // Snapshot of every mesh in the scene, rebuilt on every customer
  // spawn/despawn (see syncHoverCandidates) — products arrive after the first
  // build, and despawned avatars must not ghost as invisible occluders.
  // Product meshes win via their productId ancestor; every other mesh acts
  // as an occluder, so looking through a shelf at a far-side product shows
  // nothing.
  let hoverCandidates: THREE.Mesh[] = [];
  // Undefined = nothing cached; forces a re-resolve after a hide so a
  // re-hover of the same product rewrites the pill exactly once.
  let lastTooltipId: string | undefined;

  const setCrosshairHidden = (hidden: boolean): void => {
    if (crosshairEl) crosshairEl.hidden = hidden;
  };

  // Crosshair dot visibility: always visible while pointer-locked, and only
  // while the till overlay is closed. Recomputed from pointerlockchange and
  // from the till open/close paths (which keep their own explicit hide/show
  // calls — this composes with them). main owns this listener; FpsController
  // only requests/releases the lock.
  const registerUiEl = document.getElementById("register-ui");
  const updateCrosshairVisibility = (): void => {
    const tillOpen = registerUiEl ? !registerUiEl.hidden : false;
    setCrosshairHidden(document.pointerLockElement == null || tillOpen);
  };
  document.addEventListener("pointerlockchange", updateCrosshairVisibility);
  // Initial state — not locked at boot, so the dot starts hidden.
  updateCrosshairVisibility();

  // Mirror of the element's visibility — lets repeat calls no-op.
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
        // Unknown id — hide rather than show an empty pill.
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

  // Single-slot memo: at most one highlight is live at a time. Instanced
  // hits restore via instanceColor (slot written back to white); the old
  // material-swap path stays for non-instanced meshes (defensive — the
  // store build only spawns InstancedMesh product meshes today). Instanced
  // path shares the archetype's materials, so they are never cloned/mutated.
  const HOVER_EMISSIVE = "#3a2a00";
  interface HoverLift {
    mesh: THREE.Mesh;
    // Set when the lift went through instanceColor; original/clones stay null.
    instanceId: number | null;
    // Material-swap fallback state; null when the lift went through instanceColor.
    original: THREE.Material | THREE.Material[] | null;
    clones: THREE.Material[];
  }
  let hoverLift: HoverLift | null = null;

  const liftOne = (material: THREE.Material): THREE.Material => {
    const clone = material.clone();
    // Lambert/Standard all have emissive; Basic doesn't — lift only a glow.
    const emissive = (clone as THREE.MeshStandardMaterial).emissive;
    if (emissive) emissive.set(HOVER_EMISSIVE);
    return clone;
  };

  const unliftHovered = (): void => {
    if (!hoverLift) return;
    const { mesh, instanceId, original, clones } = hoverLift;
    if (instanceId !== null && (mesh as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = mesh as THREE.InstancedMesh;
      // instanceColor exists by now (set at lift time); guard for the
      // "lifted before any setColorAt" edge anyway.
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
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh)
      : null;
    const slot =
      instanced &&
      typeof instanceId === "number" &&
      Number.isInteger(instanceId) &&
      instanceId >= 0 &&
      instanceId < instanced.count
        ? instanceId
        : null;
    if (instanced) {
      if (slot === null) {
        // Missing/out-of-range instanceId — clear any prior lift; never
        // fall through to the swap path (materials are shared by the bake).
        unliftHovered();
        return;
      }
      if (hoverLift?.mesh === mesh && hoverLift.instanceId === slot) return;
      unliftHovered();
      instanced.setColorAt(slot, HOVER_TINT);
      if (instanced.instanceColor) {
        instanced.instanceColor.needsUpdate = true;
      }
      hoverLift = { mesh, instanceId: slot, original: null, clones: [] };
      return;
    }
    if (hoverLift?.mesh === mesh && hoverLift.instanceId === null) return;
    unliftHovered();
    // Defensive fallback: non-instanced mesh — old material-swap path.
    const original = mesh.material;
    if (Array.isArray(original)) {
      // Every face glows slightly — boxes/tins use shared material arrays.
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

  // Nearest mesh at or below this distance with an ancestor carrying
  // userData.productId shows the tooltip; anything else hides it.
  const productIdOf = (obj: THREE.Object3D): string | null => {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const id: unknown = cur.userData?.productId;
      if (typeof id === "string" && id.length > 0) return id;
      cur = cur.parent;
    }
    return null;
  };

  // One traverse per call. Run at boot (after the store + first customer
  // exist) and again on every customer spawn/despawn via syncHoverCandidates.
  // Hidden groups (the checkout tote between sales) must not ghost as
  // invisible occluders — three's raycaster ignores Object3D.visible.
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
      // Rail tag planes are zero-thickness prints; excluded from the hover ray so packs behind them remain hoverable.
      if (mesh.userData?.isRailTag === true) return;
      candidates.push(mesh);
    });
    hoverCandidates = candidates;
  };

  // Customers spawn/despawn dynamically: despawn() removes the old group from
  // the scene and immediately spawns the next one, all inside
  // customers3d.update(). Rebuilding on any change of the active-customer
  // reference (one per lifecycle) keeps the snapshot accurate — a per-frame
  // reference compare is free, the traverse only runs on an actual change.
  let lastHoverCustomer: Customer | null = null;
  const syncHoverCandidates = (): void => {
    const current = customers?.getActiveCustomer() ?? null;
    if (current === lastHoverCustomer) return;
    lastHoverCustomer = current;
    collectHoverCandidates();
  };

  const updateHover = (): void => {
    if (playerFrozen) {
      hideHover();
      return;
    }
    hoverRaycaster.setFromCamera(raycastCenter, camera);
    // Flat list — recursive=false; hits are meshes themselves, no duplicates,
    // and three sorts them nearest-first, so hits[0] is the closest mesh.
    const hits = hoverRaycaster.intersectObjects(hoverCandidates, false);
    const hit =
      hits.length > 0 && hits[0].distance <= TOOLTIP_MAX_DISTANCE_M
        ? hits[0]
        : undefined;
    const mesh = hit?.object as THREE.Mesh | undefined;
    const productId = hit ? productIdOf(hit.object) : null;
    if (hit && mesh?.isMesh && productId) {
      showTooltip(productId);
      liftHovered(mesh, hit.instanceId);
    } else {
      hideHover();
    }
  };

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

  // Interaction state for cashier machine (laser now handled in cashierMachine)

  // Till open: E when player is at till and NOT frozen.
  window.addEventListener("keydown", (event) => {
    if (playerFrozen) return; // only when NOT in a sale
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
    setCrosshairHidden(true);
    hideHover();
    // This keypress is the user gesture that unlocks WebAudio, and the sale
    // starts the customer's placement tosses.
    primeAudio();
    checkoutFlow?.begin(customer);
    const customerAvatar = customers?.getActiveCustomerAvatar?.() ?? undefined;
    cashierMachine?.begin(customer, customerAvatar);
    // Register-ui is up now — keep the dot hidden (it stays hidden even if
    // the lock exit hasn't landed yet).
    updateCrosshairVisibility();
    event.preventDefault();
  });

  // In-sale controls: only active when playerFrozen is true.
  // F = scan item, G = give change, D = toggle drawer, Esc = abandon.
  window.addEventListener("keydown", (event) => {
    if (!playerFrozen) return;

    if (event.code === "Escape") {
      event.preventDefault();
      cashierMachine!.abandon(); // triggers onComplete with completed=false
      return;
    }

    if (event.code === "KeyF" && cashierMachine!.canScan()) {
      // Scan item at scanner gun
      event.preventDefault();
      cashierMachine!.onItemScanned();
      playBeep();
      return;
    }

    if (event.code === "KeyG") {
      // Give change — pick the suggested denomination and hand it over
      event.preventDefault();
      const remaining = cashierMachine!.getRemainingChange?.();
      if (remaining && remaining > 0) {
        // Suggest the largest denomination that fits
        const denoms = [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5];
        for (const d of denoms) {
          if (d <= remaining) {
            cashierMachine!.onChangeGiven(d);
            break;
          }
        }
      }
      return;
    }

    if (event.code === "KeyD") {
      // Toggle cash drawer
      event.preventDefault();
      cashierMachine!.toggleDrawer();
      return;
    }
  });

  // Mouse click for keypad and drawer handle (when pointer unlocked, i.e., till open)
  renderer.domElement.addEventListener("click", (event) => {
    if (!playerFrozen) return;
    // We need pointer lock released for mouse clicks to work on CSS2D/raycast
    if (document.pointerLockElement) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Check drawer handle first
    const drawerHandle = cashierMachine!.getDrawerHandle();
    const handleHits = raycaster.intersectObject(drawerHandle, true);
    if (handleHits.length > 0) {
      cashierMachine!.toggleDrawer();
      return;
    }

    // Check keypad buttons
    const keyMeshes = cashierMachine!.getKeyMeshes();
    for (const [denom, mesh] of keyMeshes) {
      const hits = raycaster.intersectObject(mesh, true);
      if (hits.length > 0) {
        cashierMachine!.onChangeGiven(denom);
        return;
      }
    }
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
      // Checkout belt: built with the bundle so its belt/bag/tote props are in
      // the scene before the hover snapshot below. A failure leaves the
      // register fully usable (canScan falls back to true).
      try {
        checkoutFlow = new CheckoutFlow(scene, bundle);
        checkoutFlow.onItemPlaced = playPlip;
      } catch (error) {
        checkoutFlow = null;
        console.error("[main] Checkout flow setup failed — belt disabled.", error);
      }
      // Cashier machine: built with the bundle so its prop is in the scene.
      try {
        const machineProps = buildCashierMachineProps();
        // Position machine on counter (north of belt, centered)
        // Counter center is at TILL_X, TILL_Z; belt is south of center.
        // Machine sits north of belt on counter top.
        const counterBox = new THREE.Box3().setFromObject(bundle.counter);
        const counterSize = counterBox.getSize(new THREE.Vector3());
        const counterCenterX = TILL_X + (counterBox.min.x + counterBox.max.x) / 2;
        const counterCenterZ = TILL_Z + (counterBox.min.z + counterBox.max.z) / 2;
        const topY = counterBox.max.y;
        machineProps.group.position.set(counterCenterX, topY, counterCenterZ + 0.15); // north of belt
        cashierMachine = createCashierMachine(scene, machineProps, {
          canScan: () => checkoutFlow?.canScan() ?? true,
          onItemScanned: () => checkoutFlow?.onItemScanned(),
          abandon: () => checkoutFlow?.abandon(),
          update: (dt: number) => checkoutFlow?.update(dt),
        });

        // Cashier machine completion handler — register AFTER machine exists
        cashierMachine.onComplete((completed: boolean, servedCustomer: Customer | null) => {
          setLabelsHidden(false);
          setCrosshairHidden(false);
          updateCrosshairVisibility();
          hideHover();
          showLockHint();
          checkoutFlow?.abandon();
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
          if (completed && servedCustomer) creditMoney(servedCustomer.basketTotalSen);
          tillCustomer = null;
        });
      } catch (error) {
        cashierMachine = null;
        console.error("[main] Cashier machine setup failed.", error);
      }
      // Customer flow — bundle ships the 3 capsule variants.
      try {
        customers = new Customers3D(scene, camera, bundle.customers);
        customers.spawnNextCustomer();
      } catch (error) {
        console.error("[main] Customer setup failed — no customers will spawn.", error);
      }
      // Hover snapshot — after the store (and first customer) exist. Seed
      // the tracker so the first animate() frame doesn't re-traverse.
      collectHoverCandidates();
      lastHoverCustomer = customers?.getActiveCustomer() ?? null;
      hideLoading(loading);
    })
    .catch(() => hideLoading(loading));

  // Anchor the machine screen DOM to the machine's WORLD position.
  //
  // Each frame we project the 3D screen centre (and its top edge, to gauge
  // scale) through the camera and place the DOM element there. This keeps the
  // screen fixed on the register — it moves with the world as you look/walk,
  // and is hidden when the machine is behind the camera or off the viewport.
  // (A CSS2DObject would do the same in principle, but this manual projection
  // gives us exact control over scale + occlusion and removes any chance the
  // overlay behaves like a camera-locked HUD.)
  const machineScreenScratch = new THREE.Vector3();
  const machineScreenTopScratch = new THREE.Vector3();
  const updateMachineScreen = (): void => {
    const el = cashierMachine?.getScreenElement();
    if (!el || !cashierMachine) return;

    machineScreenScratch.copy(cashierMachine.getScreenCenter());
    machineScreenTopScratch
      .copy(machineScreenScratch)
      .setY(machineScreenScratch.y + MACHINE_SCREEN_HALF_H_M);

    // Project to NDC using the camera transform that was just rendered.
    machineScreenScratch.project(camera);
    machineScreenTopScratch.project(camera);

    const ndc = machineScreenScratch;
    const inFront =
      ndc.z > -1 && ndc.z < 1 && ndc.x > -1.1 && ndc.x < 1.1 && ndc.y > -1.1 && ndc.y < 1.1;
    if (!inFront) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    // Restore the flex-column layout the screen DOM ships with (clearing the
    // property would fall back to `block` and break the vertical stacking).
    if (el.style.display === "none") el.style.display = "flex";

    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = (ndc.x * 0.5 + 0.5) * w;
    const cy = (-ndc.y * 0.5 + 0.5) * h;
    const topY = (-machineScreenTopScratch.y * 0.5 + 0.5) * h;
    // Projected height (px) of half the screen face → full face is ×2.
    const projectedHalfH = Math.abs(cy - topY);
    const scale = Math.max(0.05, (projectedHalfH * 2) / MACHINE_SCREEN_BASE_H);

    // Centre the element on (cx, cy), then scale about its top-left origin.
    const left = cx - (MACHINE_SCREEN_BASE_W * scale) / 2;
    const top = cy - (MACHINE_SCREEN_BASE_H * scale) / 2;
    el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) scale(${scale.toFixed(4)})`;
  };

  const clock = new THREE.Clock();
  const animate = (): void => {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), MAX_FRAME_DELTA_S);
    // Frozen while the till is open: no movement (mouse-look is already
    // dead — pointer lock was exited). The camera still tracks the spot.
    if (!playerFrozen) player.update(dt);
    customers?.update(dt);
    // The belt keeps moving while the player is frozen at the till — that is
    // exactly when its placement/slide/bag animations matter.
    checkoutFlow?.update(dt);
    cashierMachine?.update(dt);
    // Customers add/remove meshes inside update() — rebuild the hover
    // snapshot if the active customer changed this frame.
    syncHoverCandidates();
    camera.position.set(player.position().x, eyeHeightM(), player.position().z);
    camera.rotation.set(player.pitch(), player.yaw(), 0); // order stays YXZ
    // Raycast after the camera transform is final so hits match the render.
    updateHover();
    renderer.render(scene, camera);
    // After the camera transform is final, glue the machine screen DOM to the
    // machine's world position (projection uses the freshly-rendered camera).
    updateMachineScreen();
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
