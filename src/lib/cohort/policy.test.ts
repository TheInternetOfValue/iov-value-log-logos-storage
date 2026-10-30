import { describe, expect, it } from "vitest";
import {
  calculateCohortReplay,
  verifyCohortReplay,
  cohortReviewBlockers,
  initialCohortState,
  salaryRate,
  type CohortActivity,
} from "./policy";
const activity = (patch: Partial<CohortActivity> = {}): CohortActivity => ({
  id: "10000000-0000-4000-8000-000000000001",
  occurrenceId: "10000000-0000-4000-8000-000000000001",
  start: "2026-10-26T08:00:00Z",
  end: "2026-10-26T09:00:00Z",
  activity: "Worked on a project",
  node: "Performance",
  quote: "Worked on a project from eight to nine",
  context: "project",
  proof: "",
  workCommunity: "work",
  lane: "Earning",
  direction: "neutral",
  intensity: null,
  confidence: "observed",
  sleepRest: false,
  ...patch,
});
describe("Field Station provisional mathematics", () => {
  it("starts all six components at 700 without activity", () => {
    expect(Object.values(initialCohortState())).toEqual([
      700, 700, 700, 700, 700, 700,
    ]);
    expect(calculateCohortReplay([]).score).toBe(700);
  });
  it("uses exact declared-currency salary arithmetic and pre-event W", () => {
    const rate = salaryRate({ annualGross: "2080000", currency: "INR" });
    const value = calculateCohortReplay([
      { recordId: "one", reviewId: "review", activity: activity(), rate },
    ]);
    expect(rate.hourly).toBe("1000.000000000000");
    expect(value.events[0]).toMatchObject({
      vcom: "1000.000000000000",
      performanceValue: "700.000000000000",
      currency: "INR",
      delta: 0,
      payability: "non_payable",
    });
  });
  it("does not change wellbeing when salary is missing or different", () => {
    const input = {
      recordId: "one",
      reviewId: "review",
      activity: activity({ direction: "positive", intensity: "low" }),
    };
    const missing = calculateCohortReplay([{ ...input, rate: null }]);
    const supplied = calculateCohortReplay([
      {
        ...input,
        rate: salaryRate({ annualGross: "208000", currency: "USD" }),
      },
    ]);
    expect(missing.state).toEqual(supplied.state);
    expect(missing.events[0].performanceValue).toBeNull();
    expect(missing.score).toBeGreaterThan(700);
  });
  it("holds uncertain effects, unknown membership, future and pre-boundary records", () => {
    expect(
      cohortReviewBlockers(
        activity({ confidence: "uncertain" }),
        [],
        "2026-10-27T00:00:00Z",
        Date.parse("2026-10-26T08:30:00Z"),
      ),
    ).toHaveLength(4);
  });
  it("rejects duplicate occurrences rather than increasing movement twice", () => {
    const row = {
      recordId: "one",
      reviewId: "review",
      activity: activity(),
      rate: null,
    };
    expect(() =>
      calculateCohortReplay([row, { ...row, recordId: "two" }]),
    ).toThrow("DUPLICATE_OCCURRENCE");
  });
  it("refuses a tampered replay, wrong currency or altered unaffected component", () => {
    const rows = [
      {
        recordId: "one",
        reviewId: "review",
        activity: activity({ direction: "positive", intensity: "high" }),
        rate: salaryRate({ annualGross: "208000", currency: "INR" }),
      },
    ];
    const run = calculateCohortReplay(rows);
    expect(verifyCohortReplay(rows, run)).toBe(true);
    const changed = structuredClone(run);
    changed.events[0].currency = "USD";
    expect(verifyCohortReplay(rows, changed)).toBe(false);
    const drift = structuredClone(run);
    drift.events[0].state.Physiology += 1;
    expect(verifyCohortReplay(rows, drift)).toBe(false);
  });
});

it("rejects a changed primary component even when its total and weighted score agree", () => {
  const rows = [
    {
      recordId: "one",
      reviewId: "review",
      activity: activity({ direction: "positive", intensity: "high" }),
      rate: null,
    },
  ];
  const bad = calculateCohortReplay(rows);
  bad.events[0].state.Performance = 900;
  bad.events[0].after = 760;
  bad.events[0].delta = 60;
  bad.state = { ...bad.events[0].state };
  bad.score = 760;
  expect(verifyCohortReplay(rows, bad)).toBe(false);
});
