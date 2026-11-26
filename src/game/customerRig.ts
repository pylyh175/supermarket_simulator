// Procedural low-poly customer rig: legs, torso, head with eyes, shoulder-
// pivoted arms with hand anchors, headwear, and the things customers carry
// (red shopping basket, plastic bag, own tote, a note / phone / card in hand).
//
// Coordinates: feet on y = 0, facing +Z. Arms and legs hang along −Y from
// their pivots, so rotation.x = −π/2 swings a limb straight forward (+Z).
// Geometries and materials are cached and shared between rigs — never
// dispose them per customer.
import * as THREE from "three";

export type Headwear = "none" | "songkok" | "tudung" | "cap" | "bun" | "long";
export type HandProp = "note" | "phone" | "card" | null;
export type Carry = "basket" | "bag-plastic" | "bag-own" | null;

export interface Look {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  headwear: Headwear;
  headwearColor: string;
  /** Uniform height scale. */
  height: number;
  /** Long top that covers the hips (baju kurung / kurta). */
  longTop?: boolean;
  /** Reusable tote colour when this customer brings their own bag. */
  tote: string;
}

/** Eight looks — variety in build, clothing and headwear, no caricature. */
export const LOOKS: readonly Look[] = [
  { shirt: "#2f7f7a", pants: "#3b3b3b", skin: "#8d5a3b", hair: "#1d1712", headwear: "songkok", headwearColor: "#151515", height: 1.0, tote: "#6d8f3a" },
  { shirt: "#d36b8f", pants: "#d36b8f", skin: "#a9714b", hair: "#1d1712", headwear: "tudung", headwearColor: "#e9d8b4", height: 0.94, longTop: true, tote: "#3a6f9f" },
  { shirt: "#f2f2f2", pants: "#2c3e50", skin: "#e0b48c", hair: "#1a1410", headwear: "none", headwearColor: "#1a1410", height: 1.04, tote: "#8a5a2e" },
  { shirt: "#e5a33b", pants: "#5d4037", skin: "#f0c8a0", hair: "#222222", headwear: "bun", headwearColor: "#222222", height: 0.95, tote: "#c2185b" },
  { shirt: "#fafafa", pants: "#1f3f7a", skin: "#a0704a", hair: "#15110d", headwear: "none", headwearColor: "#15110d", height: 0.9, tote: "#1f3f7a" },
  { shirt: "#c0392b", pants: "#7f8c8d", skin: "#c69a6d", hair: "#2a2017", headwear: "cap", headwearColor: "#1e3a5f", height: 1.02, tote: "#2e7d32" },
  { shirt: "#5b6abf", pants: "#2b2b2b", skin: "#c08a5e", hair: "#1d1712", headwear: "tudung", headwearColor: "#2b4a7a", height: 0.96, tote: "#f2c230" },
  { shirt: "#8e44ad", pants: "#8e44ad", skin: "#6e4a2c", hair: "#111111", headwear: "long", headwearColor: "#111111", height: 0.95, longTop: true, tote: "#e67e22" },
];

// Body proportions (metres, before the look's height scale).
const HIP_Y = 0.82;
const LEG_LEN = 0.78;
const LEG_R = 0.07;
const TORSO_Y = 1.12;
const TORSO_R = 0.165;
const TORSO_LEN = 0.3;
const HEAD_Y = 1.56;
const HEAD_R = 0.11;
const SHOULDER_Y = 1.37;
const SHOULDER_X = 0.215;
const ARM_LEN = 0.58;
const ARM_R = 0.045;
const HAND_R = 0.05;
/** Top of the head (for bubble anchors), before height scale. */
export const RIG_HEAD_TOP_M = HEAD_Y + HEAD_R + 0.04;

const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.MeshLambertMaterial>();

function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    geometryCache.set(key, g);
  }
  return g;
}

function mat(color: string): THREE.MeshLambertMaterial {
  let m = materialCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materialCache.set(color, m);
  }
  return m;
}

function mesh(g: THREE.BufferGeometry, color: string): THREE.Mesh {
  return new THREE.Mesh(g, mat(color));
}

export interface Rig {
  root: THREE.Group;
  /** Everything above the feet — bobs while walking. */
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  /** Prop anchors at the palms. */
  handL: THREE.Group;
  handR: THREE.Group;
  props: Record<Exclude<HandProp, null>, THREE.Object3D>;
  carries: Record<Exclude<Carry, null>, THREE.Object3D>;
  /** Height scale applied to the root. */
  scale: number;
}

function buildLeg(look: Look, side: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.085, HIP_Y, 0);
  const leg = mesh(geo("leg", () => new THREE.CylinderGeometry(LEG_R, LEG_R * 0.85, LEG_LEN, 8)), look.pants);
  leg.position.y = -LEG_LEN / 2;
  pivot.add(leg);
  const shoe = mesh(geo("shoe", () => new THREE.BoxGeometry(0.11, 0.06, 0.2)), "#2a221b");
  shoe.position.set(0, -LEG_LEN + 0.01, 0.04);
  pivot.add(shoe);
  return pivot;
}

function buildArm(look: Look, side: number): { pivot: THREE.Group; hand: THREE.Group } {
  const pivot = new THREE.Group();
  pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
  const sleeve = mesh(geo("sleeve", () => new THREE.CylinderGeometry(ARM_R * 1.25, ARM_R * 1.15, ARM_LEN * 0.45, 8)), look.shirt);
  sleeve.position.y = -ARM_LEN * 0.22;
  pivot.add(sleeve);
  const forearm = mesh(geo("forearm", () => new THREE.CylinderGeometry(ARM_R, ARM_R * 0.9, ARM_LEN * 0.6, 8)), look.skin);
  forearm.position.y = -ARM_LEN * 0.68;
  pivot.add(forearm);
  const palm = mesh(geo("palm", () => new THREE.SphereGeometry(HAND_R, 8, 6)), look.skin);
  palm.position.y = -ARM_LEN - 0.01;
  pivot.add(palm);
  const hand = new THREE.Group();
  hand.position.y = -ARM_LEN - 0.02;
  pivot.add(hand);
  return { pivot, hand };
}

function buildHeadwear(look: Look): THREE.Object3D | null {
  switch (look.headwear) {
    case "songkok": {
      const m = mesh(geo("songkok", () => new THREE.CylinderGeometry(HEAD_R * 0.86, HEAD_R * 0.9, 0.085, 14)), look.headwearColor);
      m.position.y = HEAD_R * 0.62;
      return m;
    }
    case "tudung": {
      const g = new THREE.Group();
      const hood = mesh(geo("tudung-hood", () => new THREE.SphereGeometry(HEAD_R * 1.18, 12, 10)), look.headwearColor);
      hood.scale.set(1, 1.08, 1.02);
      hood.position.set(0, 0.005, -0.012);
      g.add(hood);
      const drape = mesh(geo("tudung-drape", () => new THREE.CylinderGeometry(HEAD_R * 0.9, 0.2, 0.2, 12, 1, true)), look.headwearColor);
      drape.position.y = -HEAD_R - 0.06;
      g.add(drape);
      return g;
    }
    case "cap": {
      const g = new THREE.Group();
      const crown = mesh(geo("cap-crown", () => new THREE.SphereGeometry(HEAD_R * 1.04, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), look.headwearColor);
      crown.position.y = HEAD_R * 0.18;
      g.add(crown);
      const brim = mesh(geo("cap-brim", () => new THREE.BoxGeometry(0.15, 0.012, 0.1)), look.headwearColor);
      brim.position.set(0, HEAD_R * 0.22, HEAD_R + 0.03);
      g.add(brim);
      return g;
    }
    case "bun":
    case "long":
    case "none": {
      const g = new THREE.Group();
      const hair = mesh(geo("hair", () => new THREE.SphereGeometry(HEAD_R * 1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.9)), look.hair);
      hair.position.set(0, 0.012, -0.008);
      g.add(hair);
      if (look.headwear === "bun") {
        const bun = mesh(geo("bun", () => new THREE.SphereGeometry(0.05, 8, 6)), look.hair);
        bun.position.set(0, HEAD_R * 0.55, -HEAD_R * 0.8);
        g.add(bun);
      } else if (look.headwear === "long") {
        const back = mesh(geo("hair-long", () => new THREE.BoxGeometry(0.2, 0.26, 0.06)), look.hair);
        back.position.set(0, -0.08, -HEAD_R * 0.85);
        g.add(back);
      }
      return g;
    }
    default:
      return null;
  }
}

function buildBasket(): THREE.Group {
  const g = new THREE.Group();
  g.name = "carry:basket";
  const red = "#d32f2f";
  const w = 0.36;
  const h = 0.2;
  const d = 0.25;
  const t = 0.012;
  const bottom = mesh(geo("basket-bottom", () => new THREE.BoxGeometry(w, t, d)), red);
  bottom.position.y = -h;
  g.add(bottom);
  const side = geo("basket-side", () => new THREE.BoxGeometry(w, h, t));
  const end = geo("basket-end", () => new THREE.BoxGeometry(t, h, d));
  for (const z of [-d / 2, d / 2]) {
    const m = mesh(side, red);
    m.position.set(0, -h / 2, z);
    g.add(m);
  }
  for (const x of [-w / 2, w / 2]) {
    const m = mesh(end, red);
    m.position.set(x, -h / 2, 0);
    g.add(m);
  }
  const handle = mesh(geo("basket-handle", () => new THREE.TorusGeometry(0.1, 0.01, 6, 12, Math.PI)), "#b71c1c");
  handle.position.y = -0.01;
  g.add(handle);
  // A few packs peeking out so it reads as a full basket.
  const colors = ["#f2c230", "#1f6f3f", "#2050a0"];
  colors.forEach((c, i) => {
    const pack = mesh(geo(`basket-pack-${i}`, () => new THREE.BoxGeometry(0.09, 0.13, 0.07)), c);
    pack.position.set(-0.1 + i * 0.1, -h + 0.07, (i % 2 === 0 ? 0.03 : -0.04));
    g.add(pack);
  });
  // Hang from the hand: rotate so the long side runs front-to-back.
  g.rotation.y = Math.PI / 2;
  g.position.y = 0.02;
  return g;
}

function buildBag(color: string, plastic: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = plastic ? "carry:bag-plastic" : "carry:bag-own";
  const body = mesh(
    geo(plastic ? "bag-plastic" : "bag-own", () =>
      plastic ? new THREE.CylinderGeometry(0.13, 0.16, 0.3, 8) : new THREE.BoxGeometry(0.3, 0.3, 0.12)),
    color,
  );
  body.position.y = -0.2;
  g.add(body);
  const loop = mesh(geo("bag-loop", () => new THREE.TorusGeometry(0.06, 0.008, 5, 10, Math.PI)), color);
  loop.position.y = -0.04;
  g.add(loop);
  return g;
}

function buildHandProps(): Record<Exclude<HandProp, null>, THREE.Object3D> {
  const note = mesh(geo("prop-note", () => new THREE.BoxGeometry(0.14, 0.004, 0.07)), "#6fae7c");
  note.position.set(0, -0.02, 0.04);
  const phone = mesh(geo("prop-phone", () => new THREE.BoxGeometry(0.075, 0.15, 0.01)), "#1b1b1f");
  phone.position.set(0, -0.05, 0.03);
  const screen = mesh(geo("prop-phone-screen", () => new THREE.PlaneGeometry(0.064, 0.13)), "#7fd3ff");
  screen.position.set(0, 0, 0.0055);
  phone.add(screen);
  const card = mesh(geo("prop-card", () => new THREE.BoxGeometry(0.086, 0.054, 0.004)), "#1d4f91");
  card.position.set(0, -0.03, 0.03);
  for (const p of [note, phone, card]) p.visible = false;
  return { note, phone, card };
}

export function buildRig(lookIndex: number): Rig {
  const look = LOOKS[((lookIndex % LOOKS.length) + LOOKS.length) % LOOKS.length];
  const root = new THREE.Group();
  root.name = "customer";
  const body = new THREE.Group();
  root.add(body);

  const legL = buildLeg(look, 1);
  const legR = buildLeg(look, -1);
  body.add(legL, legR);

  const torsoLen = look.longTop ? TORSO_LEN + 0.16 : TORSO_LEN;
  const torso = mesh(
    geo(`torso-${look.longTop ? "long" : "std"}`, () => new THREE.CapsuleGeometry(TORSO_R, torsoLen, 4, 10)),
    look.shirt,
  );
  torso.scale.set(1, 1, 0.78);
  torso.position.y = look.longTop ? TORSO_Y - 0.08 : TORSO_Y;
  body.add(torso);

  const neck = mesh(geo("neck", () => new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8)), look.skin);
  neck.position.y = HEAD_Y - HEAD_R - 0.02;
  body.add(neck);

  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  const skull = mesh(geo("head", () => new THREE.SphereGeometry(HEAD_R, 14, 10)), look.skin);
  head.add(skull);
  const eye = geo("eye", () => new THREE.SphereGeometry(0.014, 6, 4));
  for (const x of [-0.038, 0.038]) {
    const e = mesh(eye, "#1a1410");
    e.position.set(x, 0.015, HEAD_R * 0.92);
    head.add(e);
  }
  const headwear = buildHeadwear(look);
  if (headwear) head.add(headwear);
  body.add(head);

  const left = buildArm(look, 1);
  const right = buildArm(look, -1);
  body.add(left.pivot, right.pivot);

  const props = buildHandProps();
  right.hand.add(props.note, props.phone, props.card);

  const carries = {
    basket: buildBasket(),
    "bag-plastic": buildBag("#f4f4f2", true),
    "bag-own": buildBag(look.tote, false),
  };
  for (const c of Object.values(carries)) {
    c.visible = false;
    left.hand.add(c);
  }

  root.scale.setScalar(look.height);
  return {
    root,
    body,
    legL,
    legR,
    armL: left.pivot,
    armR: right.pivot,
    head,
    handL: left.hand,
    handR: right.hand,
    props,
    carries,
    scale: look.height,
  };
}

export function setHandProp(rig: Rig, prop: HandProp): void {
  for (const [key, obj] of Object.entries(rig.props)) obj.visible = key === prop;
}

export function setCarry(rig: Rig, carry: Carry): void {
  for (const [key, obj] of Object.entries(rig.carries)) obj.visible = key === carry;
}
