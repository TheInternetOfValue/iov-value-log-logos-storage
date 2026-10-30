import {
  FOUNDER_CALCULATION_VERSION,
  FOUNDER_POLICY_CONTENT_HASH,
  FOUNDER_POLICY_ID,
  FOUNDER_POLICY_VERSION,
  calculateFounderPerformanceValue,
  calculateFounderRollups,
  calculateFounderTransition,
  calculateFounderW,
  performanceTransitionKey,
  validatedDurationMinutes,
  validatedDurationMinutesExact,
  validatedDurationMicroseconds,
  type FounderComponent,
  type FounderDirection,
  type FounderIntensity,
  type FounderState,
} from "./founder-wellbeing";
import { fixed12Divide, fixed12Format, fixed12FromDecimal, timestampToEpochMicroseconds } from "./fixed12";
import type { FounderWellbeingMode } from "./founder-mode";

export type FounderRateNullReason =
  | "not_applicable_nonperformance" | "pre_genesis" | "unsupported_community"
  | "missing_route" | "no_policy_at_valid_time"
  | "policy_not_recorded_as_of_system_time" | "authority_not_final"
  | "ambiguous_policy";

export type FounderReplaySlice = {
  id: string;
  activityOccurrenceId: string;
  sourceAttestationId?: string | null;
  startAt: string;
  endAt: string;
  component: FounderComponent;
  sliceType: "performance" | "non_performance";
  sourceCommunity: "house_of_bros" | "iov" | "gfe";
  route?: "Learning" | "Earning" | "OrgBuilding" | null;
  nativeSkillLevel?: string | null;
  taskId?: string | null;
  evidenceRef?: string | null;
  direction?: FounderDirection | null;
  intensity?: FounderIntensity | null;
  performanceImpact?: FounderIntensity | null;
  performanceImpactStatus?: "applied" | "no_transition" | "pending" | null;
  rate?: string | number | null;
  vcomUnit?: string | null;
  ratePolicyId?: string | null;
  authorityVersionId?: string | null;
  policyContentHash?: string | null;
  authorityContentHash?: string | null;
  protocolFinalityStatus?: "provisional" | "final" | null;
  payabilityStatus?: "non_payable";
  finalizedAt?: string | null;
  rateNullReason?: FounderRateNullReason | null;
  validationMode: "founder_self_review" | "independent_review";
  founderConfirmed: boolean;
};

export type FounderReplayBaseline = {
  id: string;
  subjectId: string;
  effectiveAt: string;
  state: FounderState;
};

export type FounderStateRevision = {
  sequenceNumber: number;
  effectiveAt: string;
  activityOccurrenceId: string | null;
  sourceAttestationId: string | null;
  revisionKind: "baseline" | "component_transition";
  component: FounderComponent | null;
  componentBefore: number | null;
  componentAfter: number | null;
  state: FounderState;
  wBefore: number;
  wAfter: number;
  deltaW: number;
  transition: Record<string, unknown> | null;
  validationMode: string;
};

export type FounderValueEvent = {
  canonicalSliceId: string;
  activityOccurrenceId: string;
  sourceAttestationId: string | null;
  performanceTransitionKey: string | null;
  eventKind: "performance" | "nonperformance";
  sourceCommunity: string;
  taskId: string | null;
  evidenceRef: string | null;
  route: string | null;
  nativeSkillLevel: string | null;
  validatedDurationMinutes: number;
  validatedDurationMinutesExact: string;
  validatedDurationMicroseconds: string;
  validatedDurationHours: string;
  rate: number | null;
  communityRateAmount: string | null;
  communityRateUnit: "USD_per_hour" | null;
  communityRateNullReason: FounderRateNullReason | null;
  communityRatePolicyId: string | null;
  finalityAuthorityVersionId: string | null;
  vcomAmount: number | null;
  vcomEventAmount: string | null;
  vcomEventUnit: "USD" | null;
  vcomEventNullReason: "not_applicable_nonperformance" | "community_rate_unresolved" | "duration_unavailable_or_invalid" | null;
  vcomUnit: string | null;
  vcomScope: "event" | null;
  vcomSemantics: "duration_expanded_event_value";
  settlementStatus: "settled" | "provisional";
  vcperformance: number | null;
  vcperformanceEventAmount: string | null;
  vcperformanceEventUnit: "USD" | null;
  vcperformanceEventNullReason: "not_applicable_nonperformance" | "vcom_unresolved" | "wbefore_unavailable" | null;
  protocolFinalityStatus: "provisional" | "final" | null;
  payabilityStatus: "non_payable";
  finalizedAt: string | null;
  vcnonperformance: number | null;
  wBefore: number;
  wAfter: number;
  deltaW: number;
  performanceImpact: FounderIntensity | null;
  performanceImpactStatus: "applied" | "no_transition" | null;
  valuationStatus: "valued" | "not_yet_valued" | "not_applicable" | "provisional";
  valuationReason: "explicit_event_rate" | "rate_or_unit_missing" | "nonperformance" | "provisional_source_review";
  validationMode: string;
};

function occurrenceGroups(slices: FounderReplaySlice[]) {
  const groups = new Map<string, FounderReplaySlice[]>();
  for (const slice of slices) groups.set(slice.activityOccurrenceId, [...(groups.get(slice.activityOccurrenceId) ?? []), slice]);
  return [...groups.values()].sort((left, right) => {
    const a = left.reduce((earliest, slice) => {
      const value = timestampToEpochMicroseconds(slice.startAt);
      return value < earliest ? value : earliest;
    }, timestampToEpochMicroseconds(left[0].startAt));
    const b = right.reduce((earliest, slice) => {
      const value = timestampToEpochMicroseconds(slice.startAt);
      return value < earliest ? value : earliest;
    }, timestampToEpochMicroseconds(right[0].startAt));
    return a < b ? -1 : a > b ? 1 : left[0].activityOccurrenceId.localeCompare(right[0].activityOccurrenceId);
  });
}

export function buildFounderReplay(input: {
  baseline: FounderReplayBaseline;
  slices: FounderReplaySlice[];
  mode: Exclude<FounderWellbeingMode, "legacy">;
}) {
  let state = { ...input.baseline.state };
  let sequence = 0;
  const initialW = calculateFounderW(state);
  const revisions: FounderStateRevision[] = [{
    sequenceNumber: sequence,
    effectiveAt: input.baseline.effectiveAt,
    activityOccurrenceId: null,
    sourceAttestationId: null,
    revisionKind: "baseline",
    component: null,
    componentBefore: null,
    componentAfter: null,
    state: { ...state },
    wBefore: initialW,
    wAfter: initialW,
    deltaW: 0,
    transition: null,
    validationMode: "founder_self_review",
  }];
  const values: FounderValueEvent[] = [];

  for (const group of occurrenceGroups(input.slices)) {
    const first = group[0];
    if (!first.founderConfirmed) continue;
    const occurrenceEndsAt = group.reduce((latest, slice) =>
      timestampToEpochMicroseconds(slice.endAt) > timestampToEpochMicroseconds(latest) ? slice.endAt : latest,
    group[0].endAt);
    const occurrenceSlices = group.map((slice) => ({ id: slice.id, startAt: slice.startAt, endAt: slice.endAt }));
    const durationMinutesExact = validatedDurationMinutesExact(occurrenceSlices);
    const durationHoursExact = fixed12Divide(durationMinutesExact, fixed12FromDecimal(60));
    const wBefore = calculateFounderW(state);

    if (first.sliceType === "non_performance") {
      if (!first.direction || !first.intensity) continue;
      const transition = calculateFounderTransition({ state, component: first.component, direction: first.direction, intensity: first.intensity });
      state = transition.stateAfter;
      sequence += 1;
      revisions.push({
        sequenceNumber: sequence,
        effectiveAt: occurrenceEndsAt,
        activityOccurrenceId: first.activityOccurrenceId,
        sourceAttestationId: first.sourceAttestationId ?? null,
        revisionKind: "component_transition",
        component: first.component,
        componentBefore: transition.componentBefore,
        componentAfter: transition.componentAfter,
        state: { ...state },
        wBefore: transition.wBefore,
        wAfter: transition.wAfter,
        deltaW: transition.deltaW,
        transition,
        validationMode: first.validationMode,
      });
      values.push({
        canonicalSliceId: first.id,
        activityOccurrenceId: first.activityOccurrenceId,
        sourceAttestationId: first.sourceAttestationId ?? null,
        performanceTransitionKey: null,
        eventKind: "nonperformance",
        sourceCommunity: first.sourceCommunity,
        taskId: first.taskId ?? null,
        evidenceRef: first.evidenceRef ?? null,
        route: null,
        nativeSkillLevel: null,
        validatedDurationMinutes: validatedDurationMinutes(occurrenceSlices),
        validatedDurationMinutesExact: fixed12Format(durationMinutesExact),
        validatedDurationMicroseconds: validatedDurationMicroseconds(occurrenceSlices).toString(),
        validatedDurationHours: fixed12Format(durationHoursExact),
        rate: null,
        communityRateAmount: null,
        communityRateUnit: null,
        communityRateNullReason: "not_applicable_nonperformance",
        communityRatePolicyId: null,
        finalityAuthorityVersionId: null,
        vcomAmount: null,
        vcomEventAmount: null,
        vcomEventUnit: null,
        vcomEventNullReason: "not_applicable_nonperformance",
        vcomUnit: null,
        vcomScope: null,
        vcomSemantics: "duration_expanded_event_value",
        settlementStatus: "settled",
        vcperformance: null,
        vcperformanceEventAmount: null,
        vcperformanceEventUnit: null,
        vcperformanceEventNullReason: "not_applicable_nonperformance",
        protocolFinalityStatus: null,
        payabilityStatus: "non_payable",
        finalizedAt: occurrenceEndsAt,
        vcnonperformance: transition.wAfter,
        wBefore: transition.wBefore,
        wAfter: transition.wAfter,
        deltaW: transition.deltaW,
        performanceImpact: null,
        performanceImpactStatus: null,
        valuationStatus: "not_applicable",
        valuationReason: "nonperformance",
        validationMode: first.validationMode,
      });
      continue;
    }

    if (!first.performanceImpactStatus || first.performanceImpactStatus === "pending") continue;
    const rate = first.rate ?? null;
    const hasValuationInputs = rate !== null && first.protocolFinalityStatus === "final" && Boolean(first.ratePolicyId);
    const value = hasValuationInputs
      ? calculateFounderPerformanceValue({ state, rate, unit: first.vcomUnit!, slices: occurrenceSlices })
      : null;
    const shouldMovePerformance = first.performanceImpactStatus === "applied" && Boolean(first.performanceImpact) && Boolean(first.direction)
      ;
    const sourceAttestationId = first.sourceAttestationId ?? first.activityOccurrenceId;
    const transitionKey = performanceTransitionKey({
      subjectId: input.baseline.subjectId,
      sourceCommunity: first.sourceCommunity,
      sourceAttestationId,
    });
    let wAfter = wBefore;
    let deltaW = 0;
    if (shouldMovePerformance) {
      const transition = calculateFounderTransition({ state, component: "Performance", direction: first.direction!, intensity: first.performanceImpact! });
      state = transition.stateAfter;
      wAfter = transition.wAfter;
      deltaW = transition.deltaW;
      sequence += 1;
      revisions.push({
        sequenceNumber: sequence,
        effectiveAt: occurrenceEndsAt,
        activityOccurrenceId: first.activityOccurrenceId,
        sourceAttestationId,
        revisionKind: "component_transition",
        component: "Performance",
        componentBefore: transition.componentBefore,
        componentAfter: transition.componentAfter,
        state: { ...state },
        wBefore: transition.wBefore,
        wAfter: transition.wAfter,
        deltaW: transition.deltaW,
        transition,
        validationMode: first.validationMode,
      });
    }
    values.push({
      canonicalSliceId: first.id,
      activityOccurrenceId: first.activityOccurrenceId,
      sourceAttestationId,
      performanceTransitionKey: transitionKey,
      eventKind: "performance",
      sourceCommunity: first.sourceCommunity,
      taskId: first.taskId ?? null,
      evidenceRef: first.evidenceRef ?? null,
      route: first.route ?? null,
      nativeSkillLevel: first.nativeSkillLevel ?? null,
      validatedDurationMinutes: value?.validatedDurationMinutes ?? validatedDurationMinutes(occurrenceSlices),
      validatedDurationMinutesExact: value?.validatedDurationMinutesExact ?? fixed12Format(durationMinutesExact),
      validatedDurationMicroseconds: value?.validatedDurationMicroseconds ?? validatedDurationMicroseconds(occurrenceSlices).toString(),
      validatedDurationHours: value?.validatedDurationHours ?? fixed12Format(durationHoursExact),
      rate: value?.rate ?? null,
      communityRateAmount: value?.communityRateAmount ?? null,
      communityRateUnit: value ? "USD_per_hour" : null,
      communityRateNullReason: value ? null : (first.rateNullReason ?? "no_policy_at_valid_time"),
      communityRatePolicyId: value ? (first.ratePolicyId ?? null) : null,
      finalityAuthorityVersionId: value ? (first.authorityVersionId ?? null) : null,
      vcomAmount: value?.vcomEvent ?? null,
      vcomEventAmount: value?.vcomEventAmount ?? null,
      vcomEventUnit: value ? "USD" : null,
      vcomEventNullReason: value ? null : "community_rate_unresolved",
      vcomUnit: value ? "USD" : null,
      vcomScope: value ? "event" : null,
      vcomSemantics: "duration_expanded_event_value",
      settlementStatus: value ? "settled" : "provisional",
      vcperformance: value?.vcperformanceEvent ?? null,
      vcperformanceEventAmount: value?.vcperformanceEventAmount ?? null,
      vcperformanceEventUnit: value ? "USD" : null,
      vcperformanceEventNullReason: value ? null : "vcom_unresolved",
      protocolFinalityStatus: value ? "final" : (first.protocolFinalityStatus ?? null),
      payabilityStatus: "non_payable",
      finalizedAt: value ? (first.finalizedAt ?? null) : null,
      vcnonperformance: null,
      wBefore,
      wAfter,
      deltaW,
      performanceImpact: first.performanceImpact ?? null,
      performanceImpactStatus: first.performanceImpactStatus ?? null,
      valuationStatus: value ? "valued" : first.protocolFinalityStatus === "provisional" ? "provisional" : "not_yet_valued",
      valuationReason: value ? "explicit_event_rate" : first.protocolFinalityStatus === "provisional"
        ? "provisional_source_review" : "rate_or_unit_missing",
      validationMode: first.validationMode,
    });
  }

  return {
    policy: {
      id: FOUNDER_POLICY_ID,
      version: FOUNDER_POLICY_VERSION,
      contentHash: FOUNDER_POLICY_CONTENT_HASH,
      calculationVersion: FOUNDER_CALCULATION_VERSION,
    },
    baseline: input.baseline,
    revisions,
    values,
    endingState: state,
    endingW: calculateFounderW(state),
    rollups: calculateFounderRollups(state),
  };
}
