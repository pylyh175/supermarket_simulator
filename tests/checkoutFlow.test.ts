// tests/checkoutFlow.test.ts
//
// Headless smoke test for the 3D belt runtime. Three's scene graph runs in
// Node; no WebGL, no DOM. The counter is built to the shipped glTF's measured
// size (0.973 × 0.475 × 0.95 m) so the derived short-belt geometry is the one
// exercised.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { CheckoutFlow } from "../src/three/checkoutFlow";
import type { AssetBundle } from "../src/three/assets";
import type { Customer } from "../src/customers/generate";

function makeBundle(): AssetBundle {
  const counter = new THREE.Group();
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(0.9726, 0.95, 0.475),
    new THREE.MeshBasicMaterial(),
  );
  slab.position.y = 0.475;
  counter.add(slab);

  const products = new Map<string, THREE.Group>();
  for (const id of ["p1", "p2"]) {
    const pack = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.16, 0.08),
      new THREE.MeshBasicMaterial(),
    );
    box.position.y = 0.08;
    pack.add(box);
    products.set(id, pack);
  }

  return {
    products,
    shelves: [],
    counter,
    signage: [],
    customers: [],
  } as unknown as AssetBundle;
}

function makeCustomer(): Customer {
  return {
    name: "Test",
    basket: [
      { id: "p1", name: "Item 1", priceSen: 250 },
      { id: "p2", name: "Item 2", priceSen: 400 },
    ],
    basketTotalSen: 650,
    tenderNoteSen: 1000,
  };
}

describe("CheckoutFlow runtime", () => {
  it("places, scans and bags a two-item basket on the short glTF belt", () => {
    const scene = new THREE.Scene();
    const flow = new CheckoutFlow(scene, makeBundle());

    let placed = 0;
    let scanned = 0;
    flow.onItemPlaced = () => {
      placed += 1;
    };

    flow.begin(makeCustomer());
    expect(flow.isActive()).toBe(true);

    for (let frame = 0; frame < 60 * 20; frame += 1) {
      flow.update(1 / 60);
      // Mirrors RegisterController's gate: E only works on a waiting pack.
      if (flow.canScan()) {
        flow.onItemScanned();
        scanned += 1;
      }
    }

    expect(placed).toBe(2);
    expect(scanned).toBe(2);
    expect(flow.canScan()).toBe(false);
    expect(flow.baggedCount()).toBe(2);
  });

  it("abandon clears the belt and stops the flow", () => {
    const scene = new THREE.Scene();
    const flow = new CheckoutFlow(scene, makeBundle());
    flow.begin(makeCustomer());
    for (let frame = 0; frame < 30; frame += 1) flow.update(1 / 60);

    flow.abandon();

    expect(flow.isActive()).toBe(false);
    expect(flow.canScan()).toBe(false);
    expect(flow.baggedCount()).toBe(0);
  });
});
