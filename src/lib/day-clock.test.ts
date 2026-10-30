import { describe, expect, it } from "vitest";
import { calculationIsActiveForDay, clockArcPath, clockPoint, minuteToClockDegrees } from "./day-clock";

describe("24-hour day clock geometry", () => {
  it("places midnight, 6am, noon, and 6pm around one clockwise face", () => {
    expect(minuteToClockDegrees(0)).toBe(-90);
    expect(minuteToClockDegrees(360)).toBe(0);
    expect(minuteToClockDegrees(720)).toBe(90);
    expect(minuteToClockDegrees(1080)).toBe(180);
  });

  it("keeps clock points on the requested radius", () => {
    expect(clockPoint(0, 100)).toEqual({ x: 320, y: 220 });
    expect(clockPoint(360, 100).x).toBe(420);
    expect(clockPoint(720, 100).y).toBe(420);
  });

  it("creates no arc for an empty interval", () => {
    expect(clockArcPath(120, 120, 200)).toBe("");
    expect(clockArcPath(200, 120, 200)).toBe("");
  });

  it("lights calculation only for validated work in a relevant running replay", () => {
    const dayEnd = "2026-07-22T23:59:59.999+05:30";
    expect(calculationIsActiveForDay({ dayEnd, replay: { status: "running", fromTimestamp: "2026-07-22T08:00:00+05:30" }, sliceStatuses: ["validated"] })).toBe(true);
    expect(calculationIsActiveForDay({ dayEnd, replay: null, sliceStatuses: ["validated"] })).toBe(false);
    expect(calculationIsActiveForDay({ dayEnd, replay: { status: "running", fromTimestamp: "2026-07-22T08:00:00+05:30" }, sliceStatuses: ["calculated"] })).toBe(false);
    expect(calculationIsActiveForDay({ dayEnd, replay: { status: "running", fromTimestamp: "2026-07-23T08:00:00+05:30" }, sliceStatuses: ["validated"] })).toBe(false);
  });
});
