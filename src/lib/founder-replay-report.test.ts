import { describe, expect, it } from "vitest";
import { buildFounderReplayDryRunReport, type FounderReplayDryRunInput } from "./founder-replay-report";

const input: FounderReplayDryRunInput = {
  cutoffAt: "2026-07-30T05:42:17.622655Z",
  source: "test-fixture",
  baseline: {
    id: "baseline", subjectId: "subject", effectiveAt: "2026-07-28T00:00:00.000Z",
    state: { Physiology: 750, Emotion: 800, Feeling: 820, Thought: 880, Habit: 760, Performance: 930 },
  },
  slices: [{
    id: "slice", activityOccurrenceId: "occurrence", sourceAttestationId: "attestation",
    startAt: "2026-07-28T01:00:00.000Z", endAt: "2026-07-28T02:00:00.000Z",
    component: "Performance", sliceType: "performance", sourceCommunity: "iov", route: "OrgBuilding",
    nativeSkillLevel: "SM3", direction: "positive", intensity: null, performanceImpact: "medium",
    performanceImpactStatus: "applied", rate: null, vcomUnit: null,
    validationMode: "founder_self_review", founderConfirmed: true,
  }],
  previousReplay: {
    id: "old", completedAt: "2026-07-30T00:00:00.000Z", endingW: 843,
    revisions: [{
      sequenceNumber: 0, effectiveAt: "2026-07-28T00:00:00.000Z", activityOccurrenceId: null,
      sourceAttestationId: null, revisionKind: "baseline", component: null, componentBefore: null,
      componentAfter: null, state: { Physiology: 750, Emotion: 800, Feeling: 820, Thought: 880, Habit: 760, Performance: 930 },
      wBefore: 843, wAfter: 843, deltaW: 0, transition: null, validationMode: "founder_self_review",
    }], values: [],
  },
  invariantSnapshot: { genesis: "unchanged" },
};

describe("founder replay dry-run report", () => {
  it("reports the omitted transition and uses shared precision policy", () => {
    const report = buildFounderReplayDryRunReport(input);
    expect(report.readOnly).toBe(true);
    expect(report.corrected.endingW).toBe(843.00186);
    expect(report.eventDifferences[0]).toMatchObject({
      activityOccurrenceId: "occurrence",
      componentDelta: { old: null, next: "0.006200000000", change: null },
      vcom: { old: null, next: null, change: null },
      vcperformance: { old: null, next: null, change: null },
      valuationStatus: "not_yet_valued",
    });
    expect(report.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
