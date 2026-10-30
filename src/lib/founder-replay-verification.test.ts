import { describe, expect, it } from "vitest";
import { buildFounderReplay, type FounderReplaySlice } from "./founder-replay";
import { verifyFounderReplayCandidate } from "./founder-replay-verification";

const baseline = {
  id: "baseline",
  subjectId: "did:iov:member:10000000-0000-4000-8000-000000000001",
  effectiveAt: "2026-07-28T11:11:34.890018Z",
  state: { Physiology: 750, Emotion: 800, Feeling: 820, Thought: 880, Habit: 760, Performance: 690 },
};

const slice: FounderReplaySlice = {
  id: "slice", activityOccurrenceId: "occurrence", sourceAttestationId: "attestation",
  startAt: "2026-07-28T12:00:00.000000Z", endAt: "2026-07-28T13:30:00.000000Z",
  component: "Performance", sliceType: "performance", sourceCommunity: "iov",
  route: "OrgBuilding", nativeSkillLevel: "SM3", direction: null, intensity: null,
  performanceImpact: null, performanceImpactStatus: "no_transition",
  rate: "750.000000000000", vcomUnit: "USD",
  ratePolicyId: "policy", authorityVersionId: "authority",
  policyContentHash: "a".repeat(64), authorityContentHash: "b".repeat(64),
  protocolFinalityStatus: "final", payabilityStatus: "non_payable",
  finalizedAt: "2026-07-31T00:00:00.000000Z",
  validationMode: "founder_self_review", founderConfirmed: true,
};

describe("founder replay verification", () => {
  it("passes a deterministic final non-payable candidate", () => {
    const replay = buildFounderReplay({ baseline, slices: [slice], mode: "founder_v0_1_live" });
    const verification = verifyFounderReplayCandidate({
      cutoffAt: "2026-07-31T00:00:00.000000Z",
      baseline,
      slices: [slice],
      revisions: replay.revisions,
      values: replay.values,
    });
    expect(verification).toMatchObject({
      passed: true,
      nullReasonComplete: true,
      eventCount: 1,
      policyHashes: ["a".repeat(64)],
      authorityHashes: ["b".repeat(64)],
    });
    expect(verification.inputHash).toHaveLength(64);
    expect(verification.outputHash).toHaveLength(64);
  });

  it("rejects final value without finality provenance", () => {
    const replay = buildFounderReplay({ baseline, slices: [{ ...slice, authorityVersionId: null }], mode: "founder_v0_1_live" });
    const verification = verifyFounderReplayCandidate({
      cutoffAt: "2026-07-31T00:00:00.000000Z",
      baseline,
      slices: [slice],
      revisions: replay.revisions,
      values: replay.values,
    });
    expect(verification.passed).toBe(false);
    expect(verification.failureReasons).toContain("finality_payability_invariant_failed");
  });
});
