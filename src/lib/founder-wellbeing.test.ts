import { describe, expect, it } from "vitest";
import {
  calculateFounderPerformanceValue,
  calculateFounderRollups,
  calculateFounderTransition,
  calculateFounderW,
  founderBandFor,
  founderRatingToComponent,
  performanceTransitionKey,
  validatedDurationMinutes,
  type FounderState,
} from "./founder-wellbeing";

const fixture: FounderState = {
  Physiology: 750,
  Emotion: 800,
  Feeling: 820,
  Thought: 880,
  Habit: 760,
  Performance: 930,
};

const slice = (id: string, startAt: string, endAt: string) => ({ id, startAt, endAt });

describe("HouseOfBros founder WellbeingScore", () => {
  it("calculates the locked six-component fixture and explanatory rollups", () => {
    expect(calculateFounderW(fixture)).toBe(843);
    expect(calculateFounderRollups(fixture)).toEqual({ PhysicalHealth: 750, MentalHealth: 845, FinancialHealth: 887.5 });
  });

  it("converts reviewed 1–10 ratings and rejects missing scale meaning", () => {
    expect(founderRatingToComponent(8.43)).toBe(843);
    expect(() => founderRatingToComponent(0)).toThrow("FOUNDER_RATING_OUT_OF_RANGE");
    expect(() => founderRatingToComponent(10.1)).toThrow("FOUNDER_RATING_OUT_OF_RANGE");
  });

  it("has continuous decimal-safe bands", () => {
    expect(founderBandFor(200).adjustmentFactor).toBe(0.01);
    expect(founderBandFor(200.000001).adjustmentFactor).toBe(0.009);
    expect(founderBandFor(900).adjustmentFactor).toBe(0.003);
    expect(founderBandFor(900.000001).adjustmentFactor).toBe(0.002);
  });

  it("uses W-before for value and only then moves Performance", () => {
    const value = calculateFounderPerformanceValue({
      state: fixture, rate: 500, unit: "USD",
      slices: [slice("gfe", "2026-07-25T09:00:00+05:30", "2026-07-25T10:30:00+05:30")],
    });
    expect(value).toMatchObject({ wBefore: 843, vcomEvent: 750, vcperformanceEvent: 632.25 });
    const transition = calculateFounderTransition({ state: fixture, component: "Performance", direction: "positive", intensity: "medium" });
    expect(transition).toMatchObject({ componentAfter: 930.0062, wAfter: 843.00186 });
  });

  it("calculates the kickboxing slice after the first Performance transition", () => {
    const afterGfe = calculateFounderTransition({ state: fixture, component: "Performance", direction: "positive", intensity: "medium" });
    const kickboxing = calculateFounderTransition({ state: afterGfe.stateAfter, component: "Physiology", direction: "positive", intensity: "medium" });
    expect(kickboxing).toMatchObject({ componentBefore: 750, maximumMove: 0.06, componentAfter: 750.04, wAfter: 843.00986, deltaW: 0.008 });
  });

  it("is invariant to splitting one occurrence", () => {
    const one = [slice("one", "2026-07-25T19:00:00+05:30", "2026-07-25T20:30:00+05:30")];
    const three = [
      slice("a", "2026-07-25T19:00:00+05:30", "2026-07-25T19:30:00+05:30"),
      slice("b", "2026-07-25T19:30:00+05:30", "2026-07-25T20:00:00+05:30"),
      slice("c", "2026-07-25T20:00:00+05:30", "2026-07-25T20:30:00+05:30"),
    ];
    const eighteen = Array.from({ length: 18 }, (_, index) => {
      const start = new Date(Date.parse("2026-07-25T19:00:00+05:30") + index * 5 * 60_000);
      const end = new Date(start.getTime() + 5 * 60_000);
      return slice(String(index), start.toISOString(), end.toISOString());
    });
    expect(validatedDurationMinutes(one)).toBe(90);
    expect(validatedDurationMinutes(three)).toBe(90);
    expect(validatedDurationMinutes(eighteen)).toBe(90);
    const transition = () => calculateFounderTransition({ state: fixture, component: "Physiology", direction: "positive", intensity: "medium" }).deltaComponent;
    expect([transition(), transition(), transition()]).toEqual([0.04, 0.04, 0.04]);
  });

  it("unions overlapping slices and creates a stable Performance transition key", () => {
    expect(validatedDurationMinutes([
      slice("a", "2026-07-25T09:00:00Z", "2026-07-25T10:00:00Z"),
      slice("b", "2026-07-25T09:30:00Z", "2026-07-25T10:30:00Z"),
    ])).toBe(90);
    const input = { subjectId: "subject", sourceCommunity: "gfe", sourceAttestationId: "task-1" };
    expect(performanceTransitionKey(input)).toBe(performanceTransitionKey(input));
  });

  it("uses the exact post-kickboxing W for the IoV Systems Modeling slice", () => {
    const first = calculateFounderTransition({ state: fixture, component: "Performance", direction: "positive", intensity: "medium" });
    const second = calculateFounderTransition({ state: first.stateAfter, component: "Physiology", direction: "positive", intensity: "medium" });
    const value = calculateFounderPerformanceValue({
      state: second.stateAfter, rate: 750, unit: "USD",
      slices: [slice("iov", "2026-07-25T21:30:00+05:30", "2026-07-25T23:00:00+05:30")],
    });
    expect(value.wBefore).toBe(843.00986);
    expect(value.vcomEvent).toBe(1125);
    expect(value.vcperformanceEvent).toBe(948.3860925);
    const third = calculateFounderTransition({ state: second.stateAfter, component: "Performance", direction: "positive", intensity: "medium" });
    expect(third.wAfter).toBe(843.0117200124);
  });

  it("matches the normative IoV and GFE fixed12 examples", () => {
    const state: FounderState = {
      Physiology: 771, Emotion: 771, Feeling: 771, Thought: 771, Habit: 771, Performance: 771,
    };
    const slices = [slice("event", "2026-07-28T12:00:00.000000Z", "2026-07-28T13:30:00.000000Z")];
    const iov = calculateFounderPerformanceValue({ state, rate: "750.000000000000", unit: "USD", slices });
    const gfe = calculateFounderPerformanceValue({ state, rate: "500.000000000000", unit: "USD", slices });
    expect(iov).toMatchObject({
      vcomEventAmount: "1125.000000000000",
      vcperformanceEventAmount: "867.375000000000",
    });
    expect(gfe).toMatchObject({
      vcomEventAmount: "750.000000000000",
      vcperformanceEventAmount: "578.250000000000",
    });
  });
});
