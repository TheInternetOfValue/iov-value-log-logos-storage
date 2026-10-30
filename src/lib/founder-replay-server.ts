import { adminClient } from "@/lib/supabase/admin-core";
import { buildFounderReplay, type FounderReplaySlice } from "@/lib/founder-replay";
import { verifyFounderReplayCandidate } from "@/lib/founder-replay-verification";
import { founderWellbeingMode } from "@/lib/founder-mode";
import {
  FOUNDER_CALCULATION_VERSION,
  FOUNDER_POLICY_CONTENT_HASH,
  FOUNDER_POLICY_ID,
  FOUNDER_POLICY_VERSION,
  founderStateFromDecimals,
  type FounderState,
} from "@/lib/founder-wellbeing";
import { fixed12Format, fixed12FromDecimal } from "@/lib/fixed12";

const decimal12 = (value: number | string | null) =>
  value === null ? null : fixed12Format(fixed12FromDecimal(value));

export async function runFounderReplay(ownerId: string, reason: string) {
  const mode = founderWellbeingMode();
  if (mode === "legacy") return { status: "disabled" as const };
  const db = adminClient();
  const { data: baseline, error: baselineError } = await db.from("founder_wellbeing_baseline_epochs")
    .select("id,subject_id,effective_at,physiology,emotion,feeling,thought,habit,performance")
    .eq("owner_id", ownerId).order("effective_at", { ascending: false }).limit(1).maybeSingle();
  if (baselineError) throw new Error(baselineError.message);
  if (!baseline) return { status: "baseline_required" as const };

  const { data: run, error: runError } = await db.from("founder_wellbeing_replay_runs").insert({
    owner_id: ownerId,
    baseline_epoch_id: baseline.id,
    mode,
    reason,
    input_cutoff_at: new Date().toISOString(),
  }).select("id,system_time_as_of,input_cutoff_at").single();
  if (runError || !run) throw new Error(runError?.message ?? "FOUNDER_REPLAY_NOT_CREATED");

  try {
    const { data: active, error: activeError } = await db.from("founder_replay_eligible_slices")
      .select("id,start_at,end_at,wellbeing_node,slice_type,community,sao_lane,skill_level,status")
      .eq("owner_id", ownerId).lte("start_at", run.input_cutoff_at).eq("status", "calculated")
      .order("start_at").order("end_at").order("id");
    if (activeError) throw new Error(activeError.message);
    const ids = (active ?? []).map((slice) => slice.id);
    const [{ data: details, error: detailError }, { data: validations, error: validationError }] = ids.length
      ? await Promise.all([
        db.from("canonical_slices")
          .select("id,proof,activity_occurrence_id,source_attestation_id,founder_task_id,native_skill_level,founder_performance_impact,founder_performance_impact_status,founder_vcom_rate,founder_vcom_unit,founder_validation_mode,impact_direction,impact_intensity,confidence")
          .in("id", ids),
        db.from("validation_events").select("canonical_slice_id,decision,self_observation_integrity,created_at").in("canonical_slice_id", ids).order("created_at", { ascending: false }),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (detailError) throw new Error(detailError.message);
    if (validationError) throw new Error(validationError.message);
    const detailById = new Map((details ?? []).map((detail) => [detail.id, detail]));
    const latestValidation = new Map<string, { decision: string; self_observation_integrity: boolean | null }>();
    for (const validation of validations ?? []) if (!latestValidation.has(validation.canonical_slice_id)) latestValidation.set(validation.canonical_slice_id, validation);

    const occurrenceRepresentatives = new Map<string, (typeof active)[number]>();
    for (const slice of active ?? []) {
      const detail = detailById.get(slice.id);
      const occurrenceId = detail?.activity_occurrence_id ?? slice.id;
      if (slice.slice_type === "performance" && !occurrenceRepresentatives.has(occurrenceId)) occurrenceRepresentatives.set(occurrenceId, slice);
    }
    const rateResolutions = new Map<string, Record<string, unknown>>();
    await Promise.all([...occurrenceRepresentatives].map(async ([occurrenceId, slice]) => {
      const { data, error } = await db.rpc("resolve_founder_flat_community_rate", {
        p_subject_did: baseline.subject_id,
        p_community: slice.community,
        p_route: slice.sao_lane,
        p_occurrence_start_at: slice.start_at,
        p_system_time: run.system_time_as_of,
      });
      if (error) throw new Error(error.message);
      rateResolutions.set(occurrenceId, ((data as Array<Record<string, unknown>> | null)?.[0] ?? {}));
    }));

    const slices: FounderReplaySlice[] = (active ?? []).map((slice) => {
      const detail = detailById.get(slice.id);
      const validation = latestValidation.get(slice.id);
      const occurrenceId = detail?.activity_occurrence_id ?? slice.id;
      const rate = rateResolutions.get(occurrenceId);
      const policyFinal = rate?.protocol_finality_status === "final";
      const nativeSkillLevel = String(rate?.native_level ?? detail?.native_skill_level ?? (slice.community === "gfe" ? slice.skill_level : ""));
      return {
        id: slice.id,
        activityOccurrenceId: occurrenceId,
        sourceAttestationId: detail?.source_attestation_id,
        taskId: detail?.founder_task_id,
        evidenceRef: detail?.proof,
        startAt: slice.start_at,
        endAt: slice.end_at,
        component: slice.wellbeing_node,
        sliceType: slice.slice_type,
        sourceCommunity: slice.community,
        route: slice.sao_lane,
        nativeSkillLevel,
        direction: detail?.impact_direction === "neutral" ? null : detail?.impact_direction,
        intensity: detail?.impact_intensity,
        performanceImpact: detail?.founder_performance_impact,
        performanceImpactStatus: detail?.founder_performance_impact_status,
        rate: rate?.community_rate_amount ? String(rate.community_rate_amount) : null,
        vcomUnit: rate?.community_rate_unit === "USD_per_hour" ? "USD" : null,
        ratePolicyId: rate?.policy_id ? String(rate.policy_id) : null,
        authorityVersionId: rate?.authority_version_id ? String(rate.authority_version_id) : null,
        policyContentHash: rate?.policy_content_hash ? String(rate.policy_content_hash) : null,
        authorityContentHash: rate?.authority_content_hash ? String(rate.authority_content_hash) : null,
        protocolFinalityStatus: rate?.protocol_finality_status === "final" ? "final"
          : rate?.protocol_finality_status === "provisional" ? "provisional" : null,
        payabilityStatus: "non_payable",
        finalizedAt: rate?.finalized_at ? String(rate.finalized_at) : null,
        rateNullReason: rate?.rate_null_reason as FounderReplaySlice["rateNullReason"],
        validationMode: detail?.founder_validation_mode === "independent_review" ? "independent_review" : "founder_self_review",
        founderConfirmed: (validation?.decision === "validated" || (slice.slice_type === "performance" && policyFinal))
          && (slice.slice_type === "performance" || validation?.self_observation_integrity === true),
      } as FounderReplaySlice;
    });

    const state: FounderState = founderStateFromDecimals({
      Physiology: String(baseline.physiology), Emotion: String(baseline.emotion), Feeling: String(baseline.feeling),
      Thought: String(baseline.thought), Habit: String(baseline.habit), Performance: String(baseline.performance),
    });
    const replay = buildFounderReplay({
      baseline: { id: baseline.id, subjectId: baseline.subject_id, effectiveAt: baseline.effective_at, state },
      slices,
      mode,
    });
    const arithmeticChecks = await Promise.all(replay.values.filter((value) => value.vcomEventAmount !== null).map(async (value) => {
      const { data, error } = await db.rpc("calculate_founder_performance_fixed12", {
        p_community_rate: value.communityRateAmount,
        p_validated_duration_microseconds: value.validatedDurationMicroseconds,
        p_wbefore: decimal12(value.wBefore),
      });
      if (error) throw new Error(error.message);
      const checked = (data as Array<Record<string, unknown>> | null)?.[0];
      return checked?.validated_duration_hours === value.validatedDurationHours
        && checked?.vcom_event_amount === value.vcomEventAmount
        && checked?.vcperformance_event_amount === value.vcperformanceEventAmount;
    }));
    const databaseArithmeticMatches = arithmeticChecks.every(Boolean);
    const revisions = replay.revisions.map((revision) => ({
      replay_run_id: run.id,
      owner_id: ownerId,
      subject_id: baseline.subject_id,
      baseline_epoch_id: baseline.id,
      sequence_number: revision.sequenceNumber,
      effective_at: revision.effectiveAt,
      activity_occurrence_id: revision.activityOccurrenceId,
      source_attestation_id: revision.sourceAttestationId,
      revision_kind: revision.revisionKind,
      component: revision.component,
      component_before: decimal12(revision.componentBefore),
      component_after: decimal12(revision.componentAfter),
      physiology: decimal12(revision.state.Physiology),
      emotion: decimal12(revision.state.Emotion),
      feeling: decimal12(revision.state.Feeling),
      thought: decimal12(revision.state.Thought),
      habit: decimal12(revision.state.Habit),
      performance: decimal12(revision.state.Performance),
      w_before: decimal12(revision.wBefore),
      w_after: decimal12(revision.wAfter),
      delta_w: decimal12(revision.deltaW),
      transition: revision.transition,
      policy_id: FOUNDER_POLICY_ID,
      policy_version: FOUNDER_POLICY_VERSION,
      policy_content_hash: FOUNDER_POLICY_CONTENT_HASH,
      calculation_version: FOUNDER_CALCULATION_VERSION,
      validation_mode: revision.validationMode,
    }));
    const values = replay.values.map((value) => ({
      replay_run_id: run.id,
      owner_id: ownerId,
      canonical_slice_id: value.canonicalSliceId,
      activity_occurrence_id: value.activityOccurrenceId,
      source_attestation_id: value.sourceAttestationId,
      performance_transition_key: value.performanceTransitionKey,
      event_kind: value.eventKind,
      source_community: value.sourceCommunity,
      task_id: value.taskId,
      evidence_ref: value.evidenceRef,
      route: value.route,
      native_skill_level: value.nativeSkillLevel,
      validated_duration_minutes: value.validatedDurationMinutesExact,
      validated_duration_microseconds: value.validatedDurationMicroseconds,
      validated_duration_hours: value.validatedDurationHours,
      rate: value.communityRateAmount,
      community_rate_policy_id: value.communityRatePolicyId,
      finality_authority_version_id: value.finalityAuthorityVersionId,
      community_rate_amount: value.communityRateAmount,
      community_rate_unit: value.communityRateUnit,
      community_rate_null_reason: value.communityRateNullReason,
      vcom_amount: value.vcomEventAmount,
      vcom_unit: value.vcomUnit,
      vcom_event_amount: value.vcomEventAmount,
      vcom_event_unit: value.vcomEventUnit,
      vcom_event_null_reason: value.vcomEventNullReason,
      vcom_scope: value.vcomScope,
      vcom_semantics: value.vcomSemantics,
      settlement_status: value.settlementStatus,
      vcperformance: value.vcperformanceEventAmount,
      vcperformance_event_amount: value.vcperformanceEventAmount,
      vcperformance_event_unit: value.vcperformanceEventUnit,
      vcperformance_event_null_reason: value.vcperformanceEventNullReason,
      protocol_finality_status: value.protocolFinalityStatus,
      payability_status: value.payabilityStatus,
      finalized_at: value.finalizedAt,
      vcnonperformance: decimal12(value.vcnonperformance),
      w_before: decimal12(value.wBefore),
      w_after: decimal12(value.wAfter),
      delta_w: decimal12(value.deltaW),
      performance_impact: value.performanceImpact,
      performance_impact_status: value.performanceImpactStatus,
      policy_id: FOUNDER_POLICY_ID,
      policy_version: FOUNDER_POLICY_VERSION,
      policy_content_hash: FOUNDER_POLICY_CONTENT_HASH,
      validation_mode: value.validationMode,
      calculation_version: FOUNDER_CALCULATION_VERSION,
    }));
    const { error: revisionError } = await db.from("founder_wellbeing_state_revisions").insert(revisions);
    if (revisionError) throw new Error(revisionError.message);
    if (values.length) {
      const { error: valueError } = await db.from("founder_wellbeing_value_events").insert(values);
      if (valueError) throw new Error(valueError.message);
    }
    await db.from("founder_wellbeing_replay_runs").update({ status: "completed", completed_at: new Date().toISOString(), event_count: values.length }).eq("id", run.id);
    const verification = verifyFounderReplayCandidate({
      cutoffAt: run.input_cutoff_at,
      baseline: replay.baseline,
      slices,
      revisions: replay.revisions,
      values: replay.values,
      databaseArithmeticMatches,
    });
    const { data: verificationRow, error: verificationError } = await db.from("founder_wellbeing_replay_verifications").insert({
      replay_run_id: run.id,
      owner_id: ownerId,
      verifier_identity: "system:founder-replay-worker",
      input_hash: verification.inputHash,
      output_hash: verification.outputHash,
      input_cutoff_at: run.input_cutoff_at,
      baseline_epoch_id: baseline.id,
      policy_hashes: verification.policyHashes,
      authority_hashes: verification.authorityHashes,
      calculation_version: FOUNDER_CALCULATION_VERSION,
      invariant_results: verification.invariantResults,
      null_reason_complete: verification.nullReasonComplete,
      event_count: verification.eventCount,
      revision_count: verification.revisionCount,
      passed: verification.passed,
      failure_reasons: verification.failureReasons,
    }).select("id").single();
    if (verificationError || !verificationRow) throw new Error(verificationError?.message ?? "FOUNDER_REPLAY_VERIFICATION_NOT_RECORDED");
    let promotionId: string | null = null;
    if (verification.passed) {
      const { data: promoted, error: promotionError } = await db.rpc("promote_verified_founder_replay", {
        p_verification_id: verificationRow.id,
        p_promoted_by: "system:founder-replay-worker",
        p_reason: reason,
      });
      if (promotionError) throw new Error(promotionError.message);
      promotionId = String(promoted);
    }
    await db.from("audit_events").insert({
      owner_id: ownerId, actor_type: "system", event_type: "founder_wellbeing_replay_completed",
      entity_type: "founder_wellbeing_replay_run", entity_id: run.id,
      metadata: {
        mode, baseline_epoch_id: baseline.id, event_count: values.length, ending_w: replay.endingW,
        verification_id: verificationRow.id, verification_passed: verification.passed,
        promotion_id: promotionId, calculation_version: FOUNDER_CALCULATION_VERSION,
      },
    });
    return {
      status: verification.passed ? "completed" as const : "verification_failed" as const,
      runId: run.id,
      verificationId: verificationRow.id,
      promotionId,
      eventCount: values.length,
      endingW: replay.endingW,
      failureReasons: verification.failureReasons,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Founder replay failed";
    await db.from("founder_wellbeing_replay_runs").update({ status: "failed", completed_at: new Date().toISOString(), failure_message: message }).eq("id", run.id);
    throw error;
  }
}
