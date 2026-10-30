import { describe, expect, it } from "vitest";
import {
  DAILY_W_MOVEMENT_CAP, MINIMUM_EFFECTIVE_DURATION_MINUTES,
  calculatePerformanceCredit, calculateWTransition,
} from "@/lib/calculations";

const base = {
  preSliceW: 550,
  direction: "positive" as const,
  intensity: "medium" as const,
  confidence: "observed" as const,
  durationMinutes: 30,
  movementAlreadyAppliedToday: 0,
};

describe("wim-legacy-v1", () => {
  it("uses the 501–600 legacy band", () => {
    const result = calculateWTransition(base);
    expect(result.requestedChange).toBeCloseTo(0.099, 6);
    expect(result.postSliceW).toBeCloseTo(550.099, 6);
  });

  it("applies negative, neutral, intensity and confidence factors", () => {
    expect(calculateWTransition({ ...base, direction: "negative" }).appliedChange).toBeCloseTo(-0.099, 6);
    expect(calculateWTransition({ ...base, direction: "neutral" }).appliedChange).toBe(0);
    expect(calculateWTransition({ ...base, intensity: "high", confidence: "uncertain" }).appliedChange).toBeCloseTo(0.07425, 6);
  });

  it("does not move W below the minimum duration", () => {
    const result = calculateWTransition({ ...base, durationMinutes: MINIMUM_EFFECTIVE_DURATION_MINUTES - 1 });
    expect(result.minimumDurationLimited).toBe(true);
    expect(result.appliedChange).toBe(0);
  });

  it("clamps at score and daily boundaries", () => {
    const atScoreCap = calculateWTransition({ ...base, preSliceW: 1000 });
    expect(atScoreCap.postSliceW).toBe(1000);
    const atDayCap = calculateWTransition({ ...base, movementAlreadyAppliedToday: DAILY_W_MOVEMENT_CAP - 0.01 });
    expect(atDayCap.appliedChange).toBeCloseTo(0.01, 6);
    expect(atDayCap.capLimited).toBe(true);
  });

  it.each([100, 200, 201, 300, 301, 400, 401, 500, 501, 600, 601, 700, 701, 800, 801, 900, 901, 1000])(
    "finds a band at boundary %s", (preSliceW) => {
      expect(() => calculateWTransition({ ...base, preSliceW })).not.toThrow();
    },
  );
});

describe("performance-credit-v1", () => {
  it("calculates duration × normalized W × rate", () => {
    expect(calculatePerformanceCredit({ durationMinutes: 210, preSliceW: 800, creditRatePerHour: 2000 }).result).toBe(5600);
  });

  it("rejects invalid inputs", () => {
    expect(() => calculatePerformanceCredit({ durationMinutes: 0, preSliceW: 800, creditRatePerHour: 1 })).toThrow();
  });
});
