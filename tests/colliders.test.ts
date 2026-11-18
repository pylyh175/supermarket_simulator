// Tests for the pure movement + AABB collision module.
//
// Yaw convention (documented here and in src/player/movement.ts):
//   forward is -Z (Three.js camera default), right is +X.
//   yaw 0 = facing -Z; yaw is a Three.js-style rotation about +Y,
//   counter-clockwise when viewed from above. So:
//     yaw   0    ⇒ forward ( 0, 0, -1)   right ( 1, 0,  0)
//     yaw +π/2   ⇒ forward (-1, 0,  0)   right ( 0, 0, -1)
//     yaw +π     ⇒ forward ( 0, 0,  1)   right (-1, 0,  0)
//     yaw +3π/2  ⇒ forward ( 1, 0,  0)   right ( 0, 0,  1)
// Rotating the local direction by yaw about +Y:
//   worldX = cos(yaw) * localX + sin(yaw) * localZ
//   worldZ = -sin(yaw) * localX + cos(yaw) * localZ

import { describe, it, expect } from "vitest";
import { moveVector, eyeHeightM } from "../src/player/movement";
import { circleAabbResolve, clampToBounds, makeWallBoxes } from "../src/player/colliders";

const SPEED = 2.5;
const diag = SPEED / Math.SQRT2;

describe("moveVector direction math (yaw 0 = facing -Z, right = +X)", () => {
  it("yaw 0: forward is -Z, back is +Z, right is +X, left is -X", () => {
    expect(moveVector({ forward: true, back: false, left: false, right: false }, 0, SPEED)).toEqual([0, 0, -SPEED]);
    expect(moveVector({ forward: false, back: true, left: false, right: false }, 0, SPEED)).toEqual([0, 0, SPEED]);
    expect(moveVector({ forward: false, back: false, left: false, right: true }, 0, SPEED)).toEqual([SPEED, 0, 0]);
    expect(moveVector({ forward: false, back: false, left: true, right: false }, 0, SPEED)).toEqual([-SPEED, 0, 0]);
  });

  it("yaw π/2: forward is -X, right is -Z", () => {
    const yaw = Math.PI / 2;
    const [fx, fy, fz] = moveVector({ forward: true, back: false, left: false, right: false }, yaw, SPEED);
    expect(fx).toBeCloseTo(-SPEED, 10);
    expect(fy).toBe(0);
    expect(fz).toBeCloseTo(0, 10);
    const [rx, ry, rz] = moveVector({ forward: false, back: false, left: false, right: true }, yaw, SPEED);
    expect(rx).toBeCloseTo(0, 10);
    expect(ry).toBe(0);
    expect(rz).toBeCloseTo(-SPEED, 10);
  });

  it("yaw π: forward is +Z, right is -X", () => {
    const yaw = Math.PI;
    const [fx, fy, fz] = moveVector({ forward: true, back: false, left: false, right: false }, yaw, SPEED);
    expect(fx).toBeCloseTo(0, 10);
    expect(fy).toBe(0);
    expect(fz).toBeCloseTo(SPEED, 10);
    const [rx, ry, rz] = moveVector({ forward: false, back: false, left: false, right: true }, yaw, SPEED);
    expect(rx).toBeCloseTo(-SPEED, 10);
    expect(ry).toBe(0);
    expect(rz).toBeCloseTo(0, 10);
  });

  it("yaw 3π/2: forward is +X, right is +Z", () => {
    const yaw = (3 * Math.PI) / 2;
    const [fx, fy, fz] = moveVector({ forward: true, back: false, left: false, right: false }, yaw, SPEED);
    expect(fx).toBeCloseTo(SPEED, 10);
    expect(fy).toBe(0);
    expect(fz).toBeCloseTo(0, 10);
    const [rx, ry, rz] = moveVector({ forward: false, back: false, left: false, right: true }, yaw, SPEED);
    expect(rx).toBeCloseTo(0, 10);
    expect(ry).toBe(0);
    expect(rz).toBeCloseTo(SPEED, 10);
  });

  it("diagonal is normalized to the same speed (not faster), yaw 0", () => {
    const v = moveVector({ forward: true, back: false, left: false, right: true }, 0, SPEED);
    expect(v[0]).toBeCloseTo(diag, 10);
    expect(v[1]).toBe(0);
    expect(v[2]).toBeCloseTo(-diag, 10);
    expect(Math.hypot(v[0], v[2])).toBeCloseTo(SPEED, 10);
  });

  it("diagonal is normalized to the same speed at yaw π/2", () => {
    const v = moveVector({ forward: true, back: false, left: false, right: true }, Math.PI / 2, SPEED);
    expect(Math.hypot(v[0], v[2])).toBeCloseTo(SPEED, 10);
    expect(v[0]).toBeCloseTo(-diag, 10);
    expect(v[2]).toBeCloseTo(-diag, 10);
  });

  it("zero vector when no keys are pressed", () => {
    expect(moveVector({ forward: false, back: false, left: false, right: false }, 0, SPEED)).toEqual([0, 0, 0]);
    expect(moveVector({ forward: false, back: false, left: false, right: false }, Math.PI / 3, SPEED)).toEqual([0, 0, 0]);
  });

  it("opposing keys cancel out to a zero vector", () => {
    expect(moveVector({ forward: true, back: true, left: false, right: false }, 0, SPEED)).toEqual([0, 0, 0]);
    expect(moveVector({ forward: false, back: false, left: true, right: true }, Math.PI / 2, SPEED)).toEqual([0, 0, 0]);
  });
});

describe("eyeHeightM", () => {
  it("is 1.6 metres", () => {
    expect(eyeHeightM()).toBe(1.6);
  });
});

describe("circleAabbResolve", () => {
  const box = { minX: 1, minZ: -1, maxX: 2, maxZ: 1 };

  it("leaves a non-overlapping circle untouched ([0.5, 0] vs radius 0.3)", () => {
    expect(circleAabbResolve([0.5, 0], 0.3, box)).toEqual([0.5, 0]);
  });

  it("pushes out along -X from the left face with penetration accounted", () => {
    // Closest point on box to (0.8, 0) is (1, 0); gap 0.2 < radius 0.3,
    // so penetration is 0.1 and the circle ends at x = 0.7.
    const out = circleAabbResolve([0.8, 0], 0.3, box);
    expect(out[0]).toBeCloseTo(0.7, 10);
    expect(out[1]).toBeCloseTo(0, 10);
  });

  it("pushes out along +X from the right face", () => {
    const out = circleAabbResolve([2.2, 0], 0.3, box);
    expect(out[0]).toBeCloseTo(2.3, 10);
    expect(out[1]).toBeCloseTo(0, 10);
  });

  it("pushes out along -Z from the near face", () => {
    const out = circleAabbResolve([1.5, -1.2], 0.3, box);
    expect(out[0]).toBeCloseTo(1.5, 10);
    expect(out[1]).toBeCloseTo(-1.3, 10);
  });

  it("pushes out along +Z from the far face", () => {
    const out = circleAabbResolve([1.5, 1.2], 0.3, box);
    expect(out[0]).toBeCloseTo(1.5, 10);
    expect(out[1]).toBeCloseTo(1.3, 10);
  });

  it("pushes out along the corner normal when overlapping a corner", () => {
    // Closest point on box to (0.8, -1.2) is the corner (1, -1).
    const out = circleAabbResolve([0.8, -1.2], 0.3, box);
    const dx = 0.8 - 1;
    const dz = -1.2 - -1;
    const dist = Math.hypot(dx, dz);
    const push = 0.3 - dist;
    expect(out[0]).toBeCloseTo(0.8 + (dx / dist) * push, 10);
    expect(out[1]).toBeCloseTo(-1.2 + (dz / dist) * push, 10);
  });

  it("pushes a circle whose centre is inside the box out along the least-penetration axis", () => {
    // Centre (1.2, 0): 0.2 from the minX face, 0.8 from the maxX face, 1 from each Z face,
    // so it is pushed out along -X by 0.2 + radius 0.3 = 0.5 → x = 0.7.
    const out = circleAabbResolve([1.2, 0], 0.3, box);
    expect(out[0]).toBeCloseTo(0.7, 10);
    expect(out[1]).toBeCloseTo(0, 10);
  });

  it("resolved circle no longer overlaps the box", () => {
    const out = circleAabbResolve([0.8, 0], 0.3, box);
    const cx = Math.max(box.minX, Math.min(out[0], box.maxX));
    const cz = Math.max(box.minZ, Math.min(out[1], box.maxZ));
    expect(Math.hypot(out[0] - cx, out[1] - cz)).toBeGreaterThanOrEqual(0.3 - 1e-9);
  });
});

describe("clampToBounds", () => {
  const bounds = { minX: -10, minZ: -7, maxX: 10, maxZ: 7 };

  it("clamps x to the right edge minus radius", () => {
    expect(clampToBounds([12, 0], 0.3, bounds)).toEqual([9.7, 0]);
  });

  it("clamps x to the left edge plus radius", () => {
    expect(clampToBounds([-12, 0], 0.3, bounds)).toEqual([-9.7, 0]);
  });

  it("clamps z to the far edge minus radius", () => {
    expect(clampToBounds([0, 9], 0.3, bounds)).toEqual([0, 6.7]);
  });

  it("clamps z to the near edge plus radius", () => {
    expect(clampToBounds([0, -9], 0.3, bounds)).toEqual([0, -6.7]);
  });

  it("leaves an inside position unchanged", () => {
    expect(clampToBounds([3, -2], 0.3, bounds)).toEqual([3, -2]);
  });

  it("lands exactly on the boundary when sitting at the limit", () => {
    expect(clampToBounds([10, 7], 0.3, bounds)).toEqual([9.7, 6.7]);
  });
});

describe("makeWallBoxes", () => {
  it("returns exactly 4 walls", () => {
    expect(makeWallBoxes(20, 14, 0.4)).toHaveLength(4);
  });

  it("forms a closed shell centred on the origin with a 20×14 interior opening", () => {
    const walls = makeWallBoxes(20, 14, 0.4);
    const north = walls.filter((w) => w.maxZ <= -7 && w.minZ >= -7.4 - 1e-9);
    const south = walls.filter((w) => w.minZ >= 7 && w.maxZ <= 7.4 + 1e-9);
    const west = walls.filter((w) => w.maxX <= -10 && w.minX >= -10.4 - 1e-9);
    const east = walls.filter((w) => w.minX >= 10 && w.maxX <= 10.4 + 1e-9);
    expect(north).toHaveLength(1);
    expect(south).toHaveLength(1);
    expect(west).toHaveLength(1);
    expect(east).toHaveLength(1);

    // Interior opening is exactly width × depth, centred on the origin.
    expect(north[0].maxZ).toBeCloseTo(-7, 10);
    expect(south[0].minZ).toBeCloseTo(7, 10);
    expect(west[0].maxX).toBeCloseTo(-10, 10);
    expect(east[0].minX).toBeCloseTo(10, 10);

    // North/south walls span the full width including corners.
    expect(north[0].minX).toBeCloseTo(-10.4, 10);
    expect(north[0].maxX).toBeCloseTo(10.4, 10);
    expect(south[0].minX).toBeCloseTo(-10.4, 10);
    expect(south[0].maxX).toBeCloseTo(10.4, 10);

    // West/east walls span the depth between the north/south walls.
    expect(west[0].minZ).toBeCloseTo(-7, 10);
    expect(west[0].maxZ).toBeCloseTo(7, 10);
    expect(east[0].minZ).toBeCloseTo(-7, 10);
    expect(east[0].maxZ).toBeCloseTo(7, 10);

    // The shell is symmetric about the origin.
    for (const w of walls) {
      const mirror = walls.find(
        (o) =>
          Math.abs(o.minX - -w.maxX) < 1e-9 &&
          Math.abs(o.maxX - -w.minX) < 1e-9 &&
          Math.abs(o.minZ - -w.maxZ) < 1e-9 &&
          Math.abs(o.maxZ - -w.minZ) < 1e-9,
      );
      expect(mirror, `wall ${JSON.stringify(w)} should have a mirror`).toBeDefined();
    }
  });
});
