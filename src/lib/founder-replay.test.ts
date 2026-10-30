import { describe, expect, it } from "vitest";
import { buildFounderReplay, type FounderReplaySlice } from "./founder-replay";

const baseline = {
  id: "baseline",
  subjectId: "subject",
  effectiveAt: "2026-07-25T00:00:00.000Z",
  state: { Physiology: 750, Emotion: 800, Feeling: 820, Thought: 880, Habit: 760, Performance: 930 },
};

const performance = (overrides: Partial<FounderReplaySlice> = {}): FounderReplaySlice => ({
  id: "slice-1", activityOccurrenceId: "occurrence-1", sourceAttestationId: "attestation-1",
  startAt: "2026-07-25T03:30:00.000Z", endAt: "2026-07-25T05:00:00.000Z",
  component: "Performance", sliceType: "performance", sourceCommunity: "gfe", route: "Earning",
  nativeSkillLevel: "L3", direction: "positive", intensity: null, performanceImpact: "medium",
  performanceImpactStatus: "applied",
  rate: "500.000000000000", vcomUnit: "USD",
  ratePolicyId: "policy", authorityVersionId: "authority",
  protocolFinalityStatus: "final", payabilityStatus: "non_payable",
  finalizedAt: "2026-07-31T00:00:00.000000Z",
  validationMode: "independent_review", founderConfirmed: true,
  ...overrides,
});

describe("founder replay", () => {
  it("uses chronological W-before and one Performance transition per attestation", () => {
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_live", slices: [performance()] });
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({ wBefore: 843, vcomAmount: 750, vcperformance: 632.25, settlementStatus: "settled" });
    expect(result.revisions).toHaveLength(2);
    expect(result.endingW).toBe(843.00186);
  });

  it("aggregates split time slices into one value and transition", () => {
    const slices = [
      performance({ id: "a", endAt: "2026-07-25T04:00:00.000Z" }),
      performance({ id: "b", startAt: "2026-07-25T04:00:00.000Z", endAt: "2026-07-25T04:30:00.000Z" }),
      performance({ id: "c", startAt: "2026-07-25T04:30:00.000Z" }),
    ];
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_live", slices });
    expect(result.values).toHaveLength(1);
    expect(result.values[0].validatedDurationMinutes).toBe(90);
    expect(result.revisions).toHaveLength(2);
  });

  it("honours final self-ratified GFE authority in live mode", () => {
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_live", slices: [performance({ validationMode: "founder_self_review" })] });
    expect(result.values[0]).toMatchObject({
      settlementStatus: "settled",
      valuationStatus: "valued",
      rate: 500,
      vcomAmount: 750,
      vcperformance: 632.25,
      protocolFinalityStatus: "final",
      payabilityStatus: "non_payable",
    });
    expect(result.values[0].wAfter).toBe(843.00186);
    expect(result.revisions).toHaveLength(2);
  });

  it("uses the same governed authority in preview without changing finality", () => {
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_preview", slices: [performance({ validationMode: "founder_self_review" })] });
    expect(result.values[0].protocolFinalityStatus).toBe("final");
    expect(result.endingW).toBe(843.00186);
  });

  it("does not move unconfirmed observations", () => {
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_live", slices: [performance({ founderConfirmed: false })] });
    expect(result.values).toHaveLength(0);
    expect(result.endingW).toBe(843);
  });

  it("settles source value without forcing a Performance transition", () => {
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_live", slices: [performance({ performanceImpactStatus: "no_transition", performanceImpact: null, direction: null })] });
    expect(result.values[0]).toMatchObject({ settlementStatus: "settled", performanceImpactStatus: "no_transition", deltaW: 0 });
    expect(result.revisions).toHaveLength(1);
    expect(result.endingW).toBe(843);
  });

  it("applies the separately reviewed negative Performance direction", () => {
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_live", slices: [performance({ direction: "negative", performanceImpactStatus: "applied" })] });
    expect(result.values[0].deltaW).toBeLessThan(0);
    expect(result.endingW).toBeLessThan(843);
  });

  it("applies reviewed Performance impact when rate and unit are unavailable", () => {
    const result = buildFounderReplay({
      baseline,
      mode: "founder_v0_1_live",
      slices: [performance({ sourceCommunity: "iov", nativeSkillLevel: "SM3", rate: null, vcomUnit: null, ratePolicyId: null, authorityVersionId: null, protocolFinalityStatus: null, rateNullReason: "no_policy_at_valid_time" })],
    });
    expect(result.values[0]).toMatchObject({
      rate: null,
      vcomAmount: null,
      vcomUnit: null,
      vcperformance: null,
      valuationStatus: "not_yet_valued",
      valuationReason: "rate_or_unit_missing",
      performanceImpactStatus: "applied",
      wBefore: 843,
      wAfter: 843.00186,
      deltaW: 0.00186,
    });
    expect(result.revisions).toHaveLength(2);
  });

  it("does not infer a rate or unit from skill or community level", () => {
    const result = buildFounderReplay({
      baseline,
      mode: "founder_v0_1_live",
      slices: [performance({ sourceCommunity: "iov", nativeSkillLevel: "SM3", rate: null, vcomUnit: null, ratePolicyId: null, authorityVersionId: null, protocolFinalityStatus: null, rateNullReason: "no_policy_at_valid_time", performanceImpactStatus: "no_transition", performanceImpact: null, direction: null })],
    });
    expect(result.values[0]).toMatchObject({ rate: null, vcomAmount: null, vcomUnit: null, vcperformance: null, deltaW: 0 });
  });

  it("preserves no-transition behavior without valuation inputs", () => {
    const result = buildFounderReplay({
      baseline,
      mode: "founder_v0_1_live",
      slices: [performance({ rate: null, vcomUnit: null, ratePolicyId: null, authorityVersionId: null, protocolFinalityStatus: null, rateNullReason: "no_policy_at_valid_time", performanceImpactStatus: "no_transition", performanceImpact: null, direction: null })],
    });
    expect(result.values[0]).toMatchObject({ valuationStatus: "not_yet_valued", deltaW: 0, wBefore: 843, wAfter: 843 });
    expect(result.revisions).toHaveLength(1);
  });

  it("does not create a canonical value or transition while impact review is pending", () => {
    const result = buildFounderReplay({
      baseline,
      mode: "founder_v0_1_live",
      slices: [performance({ performanceImpactStatus: "pending", performanceImpact: null, direction: null })],
    });
    expect(result.values).toHaveLength(0);
    expect(result.revisions).toHaveLength(1);
    expect(result.endingW).toBe(843);
  });

  it("recomputes downstream Performance valuation from corrected chronological W", () => {
    const missingRateApplied = performance({
      id: "first",
      activityOccurrenceId: "first-occurrence",
      sourceAttestationId: "first-attestation",
      sourceCommunity: "iov",
      nativeSkillLevel: "SM3",
      rate: null,
      vcomUnit: null,
      ratePolicyId: null,
      authorityVersionId: null,
      protocolFinalityStatus: null,
      rateNullReason: "no_policy_at_valid_time",
    });
    const laterValued = performance({
      id: "second",
      activityOccurrenceId: "second-occurrence",
      sourceAttestationId: "second-attestation",
      startAt: "2026-07-25T06:00:00.000Z",
      endAt: "2026-07-25T07:00:00.000Z",
      performanceImpactStatus: "no_transition",
      performanceImpact: null,
      direction: null,
    });
    const result = buildFounderReplay({ baseline, mode: "founder_v0_1_live", slices: [laterValued, missingRateApplied] });
    expect(result.values[1].wBefore).toBe(843.00186);
    expect(result.values[1].vcomAmount).toBe(500);
    expect(result.values[1].vcperformance).toBe(421.50093);
  });
});
