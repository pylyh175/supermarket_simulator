import { describe, expect, it } from "vitest";
import { limitYaw, softLimit, wrapAngle } from "../src/player/lookLimits";

const deg = (d: number): number => (d * Math.PI) / 180;
const limits = { centerYaw: deg(170), yawHalfRange: deg(100), pitchMin: deg(-75), pitchMax: deg(35) };

describe("softLimit", () => {
  it("moves freely away from the edges", () => {
    expect(softLimit(0, 0.1, -1, 1)).toBeCloseTo(0.1);
  });
  it("slows inside the soft zone and never passes the limit", () => {
    const near = deg(35) - deg(5);
    const step = softLimit(near, deg(4), deg(-75), deg(35)) - near;
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(deg(4));
    expect(softLimit(near, deg(90), deg(-75), deg(35))).toBe(deg(35));
  });
  it("does not slow movement back away from an edge", () => {
    expect(softLimit(deg(34), -deg(4), deg(-75), deg(35))).toBeCloseTo(deg(30));
  });
});

describe("limitYaw", () => {
  it("holds yaw within the range across the ±π wrap", () => {
    // Centre 170°: +100° would be 270°, which wraps past π.
    const yaw = limitYaw(limits.centerYaw, deg(200), limits);
    expect(wrapAngle(yaw - limits.centerYaw)).toBeCloseTo(deg(100));
    const back = limitYaw(limits.centerYaw, -deg(200), limits);
    expect(wrapAngle(back - limits.centerYaw)).toBeCloseTo(deg(-100));
  });
});
