// Checkout-flow runtime: the physical belt pipeline behind the register
// overlay. Owns the belt slab / kraft bag / kraft tote props (built in
// checkoutProps.ts) plus the item clones that travel from the customer's tote
// onto the belt, slide east to the scanner, and are lifted into the bag after
// scanning.
//
// The pure state machine in src/game/belt.ts decides WHERE every item is; this
// module only mirrors that state into three.js and runs the two animations the
// state machine doesn't know about: the customer's parabolic placement toss and
// the post-scan lift-into-bag tween.
//
// Geometry reconciliation (Task 2 report flagged the belt prop's pinned
// maxima): the counter archetype is measured once, exactly like
// storeLayout.ts does for its conveyor + mat, then the belt prop is stretched
// in x to span the west conveyor lip → the bagging end. Roller cross-sections
// are counter-scaled in x so they stay round. The belt ends just west of the
// kraft bag, and the bag sits at the counter's east end (2 cm proud) so a wide
// pack can rest at the scanner without touching the bag wall.
//
// Belt-state x is measured from the western lip. The visual centre adds
// ITEM_ENTRY_MARGIN_M so a pack's west edge starts on the belt instead of
// hanging half off the lip. The scan marker and the waiting position use the
// same margin.
//
// Bag tip-in trigger: the shipped glTF counter is only ~0.97 m wide, so the
// pure defaults (1.3 m scan wait / 1.6 m bag exit) would run past the bag. The
// constructor derives a BeltGeometry from the measured counter and bag: the
// scan line sits at the mat's west edge (clamped clear of the bag wall) and the
// bag exit is the belt's east end. The runtime starts the tip-in as soon as a
// bagging item's east edge reaches the bag's west wall (or at the derived bag
// exit as a fallback) — the item is then lifted vertically above the rim,
// carried over the mouth and dropped in. That avoids sliding a pack through
// the bag wall, which sits above the belt surface.
import * as THREE from "three";
import {
  BELT_SPACING_M,
  advance,
  canPlace,
  createBelt,
  placeNext,
  scanFront,
  stripBagging,
  type Belt,
  type BeltGeometry,
} from "../game/belt";
import type { Customer } from "../customers/generate";
import type { AssetBundle } from "./assets";
import { buildBeltProps } from "./checkoutProps";
import { TILL_X, TILL_Z } from "./storeLayout";

// ---------------------------------------------------------------------------
// Mirrors of storeLayout.ts's private checkout constants. storeLayout builds
// its conveyor + mat from these; the belt must occupy the same footprint.
// Keep in sync (they are deliberately not exported there).
// ---------------------------------------------------------------------------
const CONVEYOR_X_FRACTION = -0.27;
const CONVEYOR_MAX_W_M = 0.95;
const CONVEYOR_D_M = 0.62;
const CONVEYOR_SINK_M = 0.02;
const MAT_X_FRACTION = 0.27;
const MAT_W_M = 0.5;
const MAT_H_M = 0.025;

/** customers3d.ts's QUEUE_HEAD_Z: the customer stands this far north of the till. */
const CUSTOMER_STAND_Z = TILL_Z - 0.85;

// Placement animation.
const FIRST_PLACE_DELAY_S = 0.35;
const PLACE_INTERVAL_S = 0.75;
const ARC_DURATION_S = 0.6;
const ARC_APEX_M = 0.35;
const ARC_LEAN_RAD = 0.3;
const ARC_YAW_WOBBLE_RAD = 0.12;

// Bag tip-in: lift → carry over the mouth → drop.
const TIP_DURATION_S = 0.4;
const TIP_LIFT_END = 0.3;
const TIP_CARRY_END = 0.7;
const BAG_MOUTH_CLEARANCE_M = 0.06;
const BAG_CONTENT_DEPTH_M = 0.12;

// Belt / item placement.
const ITEM_ENTRY_MARGIN_M = 0.14;
const ITEM_MAX_HALF_WIDTH_M = 0.15;
const ITEM_CLEARANCE_M = 0.002;
const BELT_Z_JITTER_M = 0.035;
const BELT_YAW_JITTER_RAD = 0.04;
const BAG_COUNTER_OVERHANG_M = 0.02;
const BELT_BAG_GAP_M = 0.03;
const BAG_EDGE_EPSILON_M = 0.005;

// Tote on the customer's right hip (their right is −x; they face +z).
const TOTE_HIP_X = -0.36;
const TOTE_BASE_Y = 0.68;
const TOTE_ITEM_LIFT_M = 0.12;

const SCAN_LINE_COLOR = "#e8b45a";
const FALLBACK_PRODUCT_COLOR = "#b45309";

export interface CheckoutBasketItem {
  id: string;
  name: string;
  priceSen: number;
}

interface Flight {
  item: CheckoutBasketItem;
  mesh: THREE.Group;
  elapsed: number;
  yaw: number;
  zOffset: number;
  halfWidth: number;
  end: THREE.Vector3;
}

interface TipIn {
  mesh: THREE.Group;
  elapsed: number;
  from: THREE.Vector3;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function easeOut(u: number): number {
  return 1 - (1 - u) * (1 - u);
}

function easeInOut(u: number): number {
  return u * u * (3 - 2 * u);
}

function easeIn(u: number): number {
  return u * u;
}

/**
 * Owns the checkout belt's three.js side. The belt/bag/tote props are added to
 * the scene once in the constructor and persist for the session; `begin()`
 * only resets the per-sale state and reveals the customer's tote.
 */
export class CheckoutFlow {
  private readonly scene: THREE.Scene;
  private readonly bundle: AssetBundle;
  private readonly beltGroup: THREE.Group;
  private readonly bagGroup: THREE.Group;
  private readonly toteGroup: THREE.Group;
  private readonly scanLine: THREE.Mesh;

  private readonly westLipX: number;
  private readonly beltCenterZ: number;
  private readonly beltSurfaceY: number;
  private readonly bagWestX: number;
  private readonly bagMouthX: number;
  private readonly bagMouthZ: number;
  private readonly bagTopY: number;
  private readonly bagInsideY: number;
  private readonly toteItemStart: THREE.Vector3;
  /** Distances derived from the measured counter; drives the pure belt state. */
  private readonly geometry: BeltGeometry;

  private belt: Belt = createBelt();
  private beltMeshes: THREE.Group[] = [];
  private beltHalfWidths: number[] = [];
  private beltZOffsets: number[] = [];
  private flights: Flight[] = [];
  private tipIns: TipIn[] = [];
  private bagContent: THREE.Group | null = null;

  /**
   * Fired when a tossed pack lands on the belt. main.ts hooks the placement
   * "plip" cue here; audio stays out of the 3D module.
   */
  onItemPlaced: (() => void) | null = null;
  /** Fired when the customer reaches into the basket for the next pack. */
  onItemLaunched: (() => void) | null = null;

  private active = false;
  private basket: CheckoutBasketItem[] = [];
  private nextPlaceIndex = 0;
  private placeTimer = 0;
  private bagged = 0;

  /** Reused per-frame position scratch — never allocate inside update(). */
  private readonly scratch = new THREE.Vector3();
  /** Reused only at spawn (rare), keeps the bbox size read allocation-free. */
  private readonly scratchSize = new THREE.Vector3();

  constructor(scene: THREE.Scene, bundle: AssetBundle) {
    this.scene = scene;
    this.bundle = bundle;

    // Measure the counter archetype the same way storeLayout measures its
    // placed clone: same scale, centred on x/z, base at y = 0.
    const counterBox = new THREE.Box3().setFromObject(bundle.counter);
    const counterSize = counterBox.getSize(new THREE.Vector3());
    const counterWidth = finiteOr(counterSize.x, 1.9);
    const counterDepth = finiteOr(counterSize.z, 0.75);
    const counterCenterX =
      TILL_X + (counterBox.min.x + counterBox.max.x) / 2;
    const counterCenterZ =
      TILL_Z + (counterBox.min.z + counterBox.max.z) / 2;
    const topY = finiteOr(counterBox.max.y, 0.95);

    // The belt occupies the store's conveyor footprint and extends east to the
    // bagging end. The old conveyor/mat are hidden beneath its slab (the slab
    // is 2 mm proud of the old conveyor so their faces never z-fight).
    const conveyorW = Math.min(CONVEYOR_MAX_W_M, counterWidth * 0.48);
    const conveyorD = Math.min(CONVEYOR_D_M, counterDepth * 0.82);
    const conveyorCenterX =
      counterCenterX + CONVEYOR_X_FRACTION * counterWidth;
    const westLipX = conveyorCenterX - conveyorW / 2;
    const matCenterX = counterCenterX + MAT_X_FRACTION * counterWidth;
    const matEastX = matCenterX + MAT_W_M / 2;
    const beltDepthM = conveyorD + 0.004;
    const beltOriginY = topY - CONVEYOR_SINK_M + 0.002;

    const props = buildBeltProps();
    this.beltGroup = props.beltGroup;
    this.bagGroup = props.bagGroup;
    this.toteGroup = props.toteGroup;

    // Stretch the belt in x to span west lip → bagging end, and in z to cover
    // the old conveyor with a hair to spare. Raw bbox is measured first so the
    // prop's own dimensions are not duplicated as constants.
    const rawBeltBox = new THREE.Box3().setFromObject(this.beltGroup);
    const rawBeltSize = rawBeltBox.getSize(new THREE.Vector3());

    // Bag first: its west wall sets the belt's east end.
    const bagBox = new THREE.Box3().setFromObject(this.bagGroup);
    const bagSize = bagBox.getSize(new THREE.Vector3());
    const counterEastX = counterCenterX + counterWidth / 2;
    const bagCenterX =
      counterEastX - bagSize.x / 2 + BAG_COUNTER_OVERHANG_M;
    const bagWestX = bagCenterX - bagSize.x / 2;
    const beltEndX = Math.min(matEastX, bagWestX - BELT_BAG_GAP_M);
    const beltSpanM = Math.max(0.5, beltEndX - westLipX);

    // Derive the state-machine distances from the measured layout instead of
    // the pinned defaults. The scan line keeps at least a full item half-width
    // clear of the bag wall; on the narrow glTF counter that lands at the
    // scanner mat's west edge. The bag exit is the belt's east end, and is
    // never allowed to strip an item still waiting at the scanner.
    const scanLineX = Math.min(
      matCenterX,
      bagWestX - ITEM_MAX_HALF_WIDTH_M - BAG_EDGE_EPSILON_M,
    );
    const scanWaitX = Math.min(
      Math.max(scanLineX - westLipX - ITEM_ENTRY_MARGIN_M, 0.12),
      Math.max(0.12, beltSpanM - 0.05),
    );
    const bagExitX = Math.max(beltSpanM, scanWaitX + BELT_SPACING_M);
    const geometry: BeltGeometry = { scanWaitX, bagExitX };
    // Visual scan marker: the same state-space x, translated by the margin.
    const scanMarkX = westLipX + ITEM_ENTRY_MARGIN_M + scanWaitX;

    const scaleX = beltSpanM / Math.max(rawBeltSize.x, 1e-4);
    const scaleZ = beltDepthM / Math.max(rawBeltSize.z, 1e-4);
    this.beltGroup.scale.set(scaleX, 1, scaleZ);
    this.beltGroup.position.set(
      westLipX + beltSpanM / 2,
      beltOriginY,
      counterCenterZ,
    );
    // The x stretch would flatten the roller cylinders into ovals — undo it
    // on their local x scale. (Only the rollers are cylinders.)
    this.beltGroup.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.geometry.type === "CylinderGeometry"
      ) {
        child.scale.x = 1 / scaleX;
      }
    });

    // Belt surface = roller tops (the rollers protrude above the slab).
    const beltSurfaceY = beltOriginY + rawBeltSize.y;

    // The bag overlaps the scanner mat at the counter's east end, so it
    // stands on the mat top (1 mm proud) rather than sinking 25 mm into it.
    const bagBaseY = topY + MAT_H_M + 0.001;
    this.bagGroup.position.set(
      bagCenterX,
      bagBaseY,
      counterCenterZ,
    );
    const bagTopY = bagBaseY + bagSize.y;

    this.toteGroup.position.set(TOTE_HIP_X, TOTE_BASE_Y, CUSTOMER_STAND_Z);
    this.toteGroup.visible = false;

    // Warm scanner line across the belt at the waiting position. It sits on
    // the slab top (below the items resting on the rollers) and marks where a
    // front pack stops for E.
    this.scanLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.004, beltDepthM * 0.86),
      new THREE.MeshBasicMaterial({ color: SCAN_LINE_COLOR }),
    );
    this.scanLine.name = "checkout:scan-line";
    this.scanLine.position.set(
      scanMarkX,
      beltOriginY + 0.102,
      counterCenterZ,
    );

    scene.add(this.beltGroup, this.bagGroup, this.toteGroup, this.scanLine);

    this.westLipX = westLipX;
    this.beltCenterZ = counterCenterZ;
    this.beltSurfaceY = beltSurfaceY;
    this.bagWestX = bagWestX;
    this.bagMouthX = bagCenterX;
    this.bagMouthZ = counterCenterZ;
    this.bagTopY = bagTopY;
    this.bagInsideY = bagTopY - BAG_CONTENT_DEPTH_M;
    this.toteItemStart = new THREE.Vector3(
      TOTE_HIP_X,
      TOTE_BASE_Y + TOTE_ITEM_LIFT_M,
      CUSTOMER_STAND_Z,
    );
    this.geometry = geometry;
  }

  /**
   * Start a sale for `customer`: reset the belt and begin the customer's
   * one-at-a-time placement tosses. The bag (and any groceries left in it from
   * the previous sale) persists.
   */
  begin(customer: Customer): void {
    this.abandon();
    this.active = true;
    this.basket = customer.basket;
    this.nextPlaceIndex = 0;
    this.placeTimer = FIRST_PLACE_DELAY_S;
    this.bagged = 0;
    this.toteGroup.visible = true;
  }

  /** Advance the belt state, the placement arcs and the bag tip-ins. */
  update(dt: number): void {
    if (!this.active) return;
    this.belt = advance(this.belt, dt, this.geometry);
    this.updateFlights(dt);
    this.updatePlacement(dt);
    this.syncBeltMeshes();
    this.collectBagged();
    this.updateTipIns(dt);
  }

  /**
   * A session scan consumed the next basket item: send the front pack to the
   * bag. No-op when the belt has no sliding/waiting item (the register gate
   * should prevent this).
   */
  onItemScanned(): void {
    if (!this.active) return;
    const result = scanFront(this.belt);
    if (result) this.belt = result.belt;
  }

  /** True when the front pack has reached the scanner and can be scanned. */
  canScan(): boolean {
    return (
      this.active && this.belt.items.some((item) => item.state === "waiting")
    );
  }

  /** Clear the belt, arcs and tip-ins, hide the tote. The bag stays. */
  abandon(): void {
    for (const flight of this.flights) this.scene.remove(flight.mesh);
    this.flights = [];
    for (const mesh of this.beltMeshes) this.scene.remove(mesh);
    this.beltMeshes = [];
    this.beltHalfWidths = [];
    this.beltZOffsets = [];
    for (const tip of this.tipIns) this.scene.remove(tip.mesh);
    this.tipIns = [];
    this.belt = createBelt();
    this.basket = [];
    this.nextPlaceIndex = 0;
    this.placeTimer = 0;
    this.bagged = 0;
    this.active = false;
    this.toteGroup.visible = false;
  }

  /** World point on the belt's scan line (scanner laser target). */
  scanPoint(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.scanLine.position).setY(this.scanLine.position.y + 0.05);
  }

  /** The customer took the bag: empty it for the next sale. */
  clearBag(): void {
    if (this.bagContent) {
      this.scene.remove(this.bagContent);
      this.bagContent = null;
    }
  }

  /** Items that have been lifted into the bag this sale. */
  baggedCount(): number {
    return this.bagged;
  }

  isActive(): boolean {
    return this.active;
  }

  // -------------------------------------------------------------------------
  // Placement toss
  // -------------------------------------------------------------------------

  private updatePlacement(dt: number): void {
    this.placeTimer -= dt;
    if (this.placeTimer > 0) return;
    if (this.nextPlaceIndex >= this.basket.length) return;
    if (!canPlace(this.belt)) return;

    // placeNext always spawns at x = 0, so wait for the previous pack to
    // clear the lip before tossing the next one — otherwise two packs overlap.
    const last = this.belt.items[this.belt.items.length - 1];
    if (last && last.x < BELT_SPACING_M) return;

    const index = this.nextPlaceIndex;
    this.startFlight(this.basket[index], index);
    this.onItemLaunched?.();
    this.nextPlaceIndex += 1;
    this.placeTimer = PLACE_INTERVAL_S;
  }

  private startFlight(item: CheckoutBasketItem, index: number): void {
    const mesh = this.spawnItemMesh(item.id);
    const halfWidth = this.measureHalfWidth(mesh);
    const yaw = (index % 2 === 0 ? -1 : 1) * BELT_YAW_JITTER_RAD;
    const zOffset = ((index % 3) - 1) * BELT_Z_JITTER_M;
    const end = new THREE.Vector3(
      this.westLipX + ITEM_ENTRY_MARGIN_M,
      this.beltSurfaceY + ITEM_CLEARANCE_M,
      this.beltCenterZ + zOffset,
    );

    mesh.position.copy(this.toteItemStart);
    mesh.rotation.set(0, yaw, 0);

    this.flights.push({
      item: { id: item.id, name: item.name, priceSen: item.priceSen },
      mesh,
      elapsed: 0,
      yaw,
      zOffset,
      halfWidth,
      end,
    });
  }

  private updateFlights(dt: number): void {
    for (let i = 0; i < this.flights.length; i += 1) {
      const flight = this.flights[i];
      flight.elapsed += dt;
      const t = Math.min(1, flight.elapsed / ARC_DURATION_S);
      const inv = 1 - t;

      this.scratch.set(
        this.toteItemStart.x * inv + flight.end.x * t,
        this.toteItemStart.y * inv +
          flight.end.y * t +
          4 * ARC_APEX_M * t * inv,
        this.toteItemStart.z * inv + flight.end.z * t,
      );
      flight.mesh.position.copy(this.scratch);
      flight.mesh.rotation.set(
        0,
        flight.yaw + ARC_YAW_WOBBLE_RAD * Math.sin(Math.PI * t),
        -ARC_LEAN_RAD * Math.sin(Math.PI * t),
      );

      if (t < 1) continue;

      // Land: hand the mesh to the pure belt state.
      this.flights.splice(i, 1);
      i -= 1;
      flight.mesh.position.copy(flight.end);
      flight.mesh.rotation.set(0, flight.yaw, 0);
      this.belt = placeNext(this.belt, flight.item);
      this.beltMeshes.push(flight.mesh);
      this.beltHalfWidths.push(flight.halfWidth);
      this.beltZOffsets.push(flight.zOffset);
      this.onItemPlaced?.();
    }
  }

  private spawnItemMesh(id: string): THREE.Group {
    const archetype = this.bundle.products.get(id);
    if (archetype) {
      const mesh = archetype.clone(true);
      // clone() copies userData, but keep identity explicit for hover.
      mesh.userData.productId = id;
      this.scene.add(mesh);
      return mesh;
    }

    // Defensive: baskets are drawn from the catalog, so this never runs for a
    // normal sale. Keep the belt alive rather than throwing mid-service.
    const fallback = new THREE.Group();
    fallback.userData.productId = id;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshLambertMaterial({
        color: FALLBACK_PRODUCT_COLOR,
        flatShading: true,
      }),
    );
    box.position.y = 0.06;
    fallback.add(box);
    this.scene.add(fallback);
    return fallback;
  }

  private measureHalfWidth(mesh: THREE.Group): number {
    const size = new THREE.Box3()
      .setFromObject(mesh)
      .getSize(this.scratchSize);
    return Math.max(
      0.03,
      Math.min(size.x / 2, ITEM_MAX_HALF_WIDTH_M),
    );
  }

  // -------------------------------------------------------------------------
  // Belt sync + bagging
  // -------------------------------------------------------------------------

  private syncBeltMeshes(): void {
    for (let i = 0; i < this.belt.items.length; i += 1) {
      const mesh = this.beltMeshes[i];
      if (!mesh) continue;
      mesh.position.set(
        this.westLipX + ITEM_ENTRY_MARGIN_M + this.belt.items[i].x,
        this.beltSurfaceY + ITEM_CLEARANCE_M,
        this.beltCenterZ + this.beltZOffsets[i],
      );
    }
  }

  /**
   * Remove bagging packs from the belt once they reach the bag wall (or the
   * derived bag-exit fallback) and start their lift-into-bag tween. Bagging
   * items are always the front prefix, so index 0 is the one to inspect.
   */
  private collectBagged(): void {
    while (this.belt.items.length > 0) {
      const item = this.belt.items[0];
      if (item.state !== "bagging") break;

      const centerX = this.westLipX + ITEM_ENTRY_MARGIN_M + item.x;
      const halfWidth =
        this.beltHalfWidths[0] ?? ITEM_MAX_HALF_WIDTH_M;
      const reachedBag =
        centerX + halfWidth >= this.bagWestX - BAG_EDGE_EPSILON_M;
      if (!reachedBag && item.x < this.geometry.bagExitX) break;

      const mesh = this.beltMeshes[0];
      if (mesh) {
        this.tipIns.push({
          mesh,
          elapsed: 0,
          from: mesh.position.clone(),
        });
      }
      this.belt = { ...this.belt, items: this.belt.items.slice(1) };
      this.beltMeshes.shift();
      this.beltHalfWidths.shift();
      this.beltZOffsets.shift();
      this.bagged += 1;
    }

    // Contract safety net: anything the visual trigger somehow missed is
    // dropped at the derived bag exit rather than ghosting on the belt.
    const before = this.belt.items.length;
    this.belt = stripBagging(this.belt, this.geometry);
    const dropped = before - this.belt.items.length;
    if (dropped > 0) {
      for (let i = 0; i < dropped; i += 1) {
        const mesh = this.beltMeshes.shift();
        if (mesh) this.scene.remove(mesh);
        this.beltHalfWidths.shift();
        this.beltZOffsets.shift();
      }
      this.bagged += dropped;
    }
  }

  // -------------------------------------------------------------------------
  // Bag tip-in
  // -------------------------------------------------------------------------

  private updateTipIns(dt: number): void {
    for (let i = 0; i < this.tipIns.length; i += 1) {
      const tip = this.tipIns[i];
      tip.elapsed += dt;
      const t = Math.min(1, tip.elapsed / TIP_DURATION_S);
      this.applyTipPosition(tip, t);
      if (t < 1) continue;

      this.tipIns.splice(i, 1);
      i -= 1;
      this.retainBagContent(tip.mesh);
    }
  }

  /** Three-phase tween: lift clear of the rim, carry over the mouth, drop in. */
  private applyTipPosition(tip: TipIn, t: number): void {
    const liftY = this.bagTopY + BAG_MOUTH_CLEARANCE_M;

    if (t < TIP_LIFT_END) {
      const u = t / TIP_LIFT_END;
      tip.mesh.position.set(
        tip.from.x,
        tip.from.y + (liftY - tip.from.y) * easeOut(u),
        tip.from.z,
      );
    } else if (t < TIP_CARRY_END) {
      const u = (t - TIP_LIFT_END) / (TIP_CARRY_END - TIP_LIFT_END);
      const e = easeInOut(u);
      tip.mesh.position.set(
        tip.from.x + (this.bagMouthX - tip.from.x) * e,
        liftY,
        tip.from.z + (this.bagMouthZ - tip.from.z) * e,
      );
    } else {
      const u = (t - TIP_CARRY_END) / (1 - TIP_CARRY_END);
      tip.mesh.position.set(
        this.bagMouthX,
        liftY + (this.bagInsideY - liftY) * easeIn(u),
        this.bagMouthZ,
      );
    }

    tip.mesh.rotation.set(0, 0, 0.12 * Math.sin(Math.PI * t));
  }

  /**
   * Keep the just-bagged pack inside the bag (replacing the previous one) so
   * the bag stays visibly full between sales, as decided in the grilling.
   */
  private retainBagContent(mesh: THREE.Group): void {
    if (this.bagContent && this.bagContent !== mesh) {
      this.scene.remove(this.bagContent);
    }
    this.bagContent = mesh;
    mesh.position.set(this.bagMouthX, this.bagInsideY, this.bagMouthZ);
    mesh.rotation.set(0, 0, 0);
  }
}
