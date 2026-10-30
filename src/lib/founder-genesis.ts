import { calculateFounderW, FOUNDER_COMPONENTS, type FounderComponent, type FounderState } from "./founder-wellbeing";

export const GENESIS_POLICY_ID = "hob-wellbeing-identity-genesis-v0.1" as const;
export const GENESIS_POLICY_VERSION = "0.1.0" as const;
export const GENESIS_BASELINE_METHOD = "identity_observation_genesis_v0.1" as const;
export const BOOTSTRAP_BASELINE_METHOD = "bootstrap_six_component_self_assessment_v0.1" as const;

export const GENESIS_IDENTITY_NODES = [
  "GivenIdentity", "EarnedIdentity", "RentedIdentity", "Skills",
  "MoralCompass", "Story", "IdentityState", "ConsentAndDisclosure",
] as const;

export type GenesisIdentityNode = typeof GENESIS_IDENTITY_NODES[number];
export type ContradictionStatus = "none" | "missing_evidence" | "material_contradiction";

export type GenesisCoverage = { component: FounderComponent; activityCount: number; recordedMinutes: number };
export type GenesisPerformanceCoverage = { route: "Learning" | "Earning" | "OrgBuilding"; activityCount: number; recordedMinutes: number };
export type GenesisEvidenceReference = {
  reference: string;
  evidenceType: "identity_context" | "identity_attestation" | "value_log_aggregate" | "first_person_assessment" | "review_record" | "consent_record";
  quality: "self_attested" | "observed" | "validated" | "issuer_reviewed";
  visibility: "private" | "public_safe";
  contentHash?: string | null;
};

export type GenesisComponentEvidence = {
  component: FounderComponent;
  relevantIdentityNodes: GenesisIdentityNode[];
  evidenceReferences: GenesisEvidenceReference[];
  currentSelfAssessment: number;
  observedEvidence: GenesisCoverage;
  performanceRouteCoverage?: GenesisPerformanceCoverage[];
  suggestedRange: null | { minimum: number; maximum: number; rationale: string };
  contradictionStatus: ContradictionStatus;
  contradictions: string[];
  subjectConfirmedValue: number | null;
};

export type GenesisQualificationInput = {
  baselineEpochId: string;
  baselineState: FounderState;
  baselineEffectiveAt: string;
  identityNodeCoverage: GenesisIdentityNode[];
  eligibleObservedDays: number;
  componentEvidence: GenesisComponentEvidence[];
};

export function assessGenesisQualification(input: GenesisQualificationInput) {
  const nodeCoverage = new Set(input.identityNodeCoverage);
  const componentMap = new Map(input.componentEvidence.map((row) => [row.component, row]));
  const identityComplete = GENESIS_IDENTITY_NODES.every((node) => nodeCoverage.has(node));
  const componentsComplete = FOUNDER_COMPONENTS.every((component) => componentMap.has(component)) && componentMap.size === 6;
  const observationComplete = input.eligibleObservedDays >= 14;
  const missingConfirmation = FOUNDER_COMPONENTS.filter((component) => componentMap.get(component)?.subjectConfirmedValue == null);
  const contradictions = input.componentEvidence.filter((row) => row.contradictionStatus !== "none");
  const proposedChanges = input.componentEvidence.filter((row) => row.subjectConfirmedValue != null && row.subjectConfirmedValue !== input.baselineState[row.component]);
  const eligible = identityComplete && componentsComplete && observationComplete && missingConfirmation.length === 0;
  const ratifyUnchanged = eligible && contradictions.length === 0 && proposedChanges.length === 0;
  const baselineW = calculateFounderW(input.baselineState);

  return {
    eligible,
    identityComplete,
    observationComplete,
    componentsComplete,
    missingConfirmation,
    contradictions: contradictions.map((row) => row.component),
    proposedChanges: proposedChanges.map((row) => row.component),
    decision: ratifyUnchanged ? "ratify_unchanged" as const : eligible ? "reconciliation_required" as const : "not_eligible" as const,
    baselineMethodBefore: BOOTSTRAP_BASELINE_METHOD,
    baselineStatusBefore: "bootstrap" as const,
    baselineMethodAfter: ratifyUnchanged ? GENESIS_BASELINE_METHOD : null,
    baselineStatusAfter: ratifyUnchanged ? "genesis_ratified" as const : null,
    stateAfter: ratifyUnchanged ? { ...input.baselineState } : null,
    wBefore: baselineW,
    wAfter: ratifyUnchanged ? baselineW : null,
    deltaW: 0 as const,
    genesisBoundaryAt: input.baselineEffectiveAt,
    preGenesisEvidenceReplayed: false as const,
  };
}

export function identityEvidenceDirectScoreDelta() {
  return 0 as const;
}

export function isPostGenesisEvent(startAt: string, genesisBoundaryAt: string) {
  return epochMicroseconds(startAt) > epochMicroseconds(genesisBoundaryAt);
}

function epochMicroseconds(value: string) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("INVALID_GENESIS_BOUNDARY");
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  const subMillisecond = Number((fraction.slice(3, 6) + "000").slice(0, 3));
  return milliseconds * 1000 + subMillisecond;
}
