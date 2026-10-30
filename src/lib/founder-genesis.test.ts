import { describe, expect, it } from "vitest";
import { assessGenesisQualification, GENESIS_IDENTITY_NODES, identityEvidenceDirectScoreDelta, isPostGenesisEvent, type GenesisComponentEvidence } from "./founder-genesis";
import { FOUNDER_COMPONENTS, calculateFounderW, type FounderState } from "./founder-wellbeing";

const state: FounderState = { Physiology: 800, Emotion: 750, Feeling: 700, Thought: 880, Habit: 800, Performance: 700 };
const coverage = { Physiology: [122, 8860], Emotion: [16, 1015], Feeling: [53, 4015], Thought: [25, 2140], Habit: [52, 3295], Performance: [69, 6500] } as const;

function dossiers(): GenesisComponentEvidence[] {
  return FOUNDER_COMPONENTS.map((component) => ({
    component,
    relevantIdentityNodes: ["ConsentAndDisclosure"],
    evidenceReferences: [{ reference: `private:${component}`, evidenceType: "value_log_aggregate", quality: "observed", visibility: "private" }],
    currentSelfAssessment: state[component],
    observedEvidence: { component, activityCount: coverage[component][0], recordedMinutes: coverage[component][1] },
    suggestedRange: null,
    contradictionStatus: "none",
    contradictions: [],
    subjectConfirmedValue: state[component],
  }));
}

function input() {
  return { baselineEpochId: "baseline", baselineState: state, baselineEffectiveAt: "2026-07-28T11:11:34.890018Z", identityNodeCoverage: [...GENESIS_IDENTITY_NODES], eligibleObservedDays: 25, componentEvidence: dossiers() };
}

describe("founder Genesis qualification", () => {
  it("preserves the exact six-component 771.00 state with no artificial movement", () => {
    expect(calculateFounderW(state)).toBe(771);
    const result = assessGenesisQualification(input());
    expect(result).toMatchObject({ decision: "ratify_unchanged", baselineStatusAfter: "genesis_ratified", wBefore: 771, wAfter: 771, deltaW: 0, preGenesisEvidenceReplayed: false });
    expect(result.stateAfter).toEqual(state);
  });

  it("does not create eight score components or direct Identity points", () => {
    expect(GENESIS_IDENTITY_NODES).toHaveLength(8);
    expect(Object.keys(state)).toEqual(FOUNDER_COMPONENTS);
    expect(identityEvidenceDirectScoreDelta()).toBe(0);
  });

  it.each(["GivenIdentity demographics", "RentedIdentity reach", "ConsentAndDisclosure", "EarnedIdentity prestige", "Skills tier", "IdentityState history"])("does not turn %s into score movement", () => {
    expect(identityEvidenceDirectScoreDelta()).toBe(0);
  });

  it("requires reconciliation instead of silently changing a component", () => {
    const changed = dossiers();
    changed[0] = { ...changed[0], contradictionStatus: "material_contradiction", contradictions: ["Evidence requires review."], suggestedRange: { minimum: 700, maximum: 760, rationale: "Synthetic test range." }, subjectConfirmedValue: null };
    const result = assessGenesisQualification({ ...input(), componentEvidence: changed });
    expect(result.decision).toBe("not_eligible");
    expect(result.stateAfter).toBeNull();
    expect(result.contradictions).toEqual(["Physiology"]);
    expect(result.missingConfirmation).toEqual(["Physiology"]);
  });

  it("requires explicit confirmation before a proposed component change", () => {
    const changed = dossiers();
    changed[0] = { ...changed[0], subjectConfirmedValue: 790 };
    const result = assessGenesisQualification({ ...input(), componentEvidence: changed });
    expect(result.decision).toBe("reconciliation_required");
    expect(result.proposedChanges).toEqual(["Physiology"]);
    expect(result.stateAfter).toBeNull();
  });

  it("excludes the boundary and all pre-Genesis observations from movement", () => {
    const boundary = "2026-07-28T11:11:34.890018Z";
    expect(isPostGenesisEvent("2026-07-27T17:30:00Z", boundary)).toBe(false);
    expect(isPostGenesisEvent(boundary, boundary)).toBe(false);
    expect(isPostGenesisEvent("2026-07-28T11:11:34.890019Z", boundary)).toBe(true);
  });
});
