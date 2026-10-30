import { calculatePerformanceCredit, calculateWTransition } from "@/lib/calculations";
import { PARSER_SCHEMA_VERSION } from "@/lib/domain";
import { inputHash } from "@/lib/input-hash";
import { replaySliceSelection } from "@/lib/canonical-lifecycle";
import { adminClient } from "@/lib/supabase/admin-core";
import { findTimelineOverlaps, timelineOverlapError } from "@/lib/timeline-integrity";
import { runFounderReplay } from "@/lib/founder-replay-server";
import { founderWellbeingMode } from "@/lib/founder-mode";
import { scoreBranchForOccurrence } from "@/lib/score-cutover";

const PILOT_RATE_VERSION = "pilot-standard-100-500-v1";
const PILOT_RATES = { L0: 100, L1: 200, L2: 300, L3: 400, L4: 500 } as const;

const durationMinutes = (start: string, end: string) =>
  (new Date(end).getTime() - new Date(start).getTime()) / 60_000;

const localDate = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

async function effectiveRateFor(slice: { community: string; sao_lane: string | null; skill_level: string | null; start_at: string }, ownerId: string) {
  if (!slice.sao_lane || !slice.skill_level || !(slice.skill_level in PILOT_RATES)) {
    throw new Error("Performance activity needs a community, lane, and L0–L4 skill level");
  }
  const db = adminClient();
  const findRate = () => db.from("community_rate_versions").select("id,credits_per_hour,version")
    .eq("community", slice.community).eq("lane", slice.sao_lane).eq("skill_level", slice.skill_level)
    .lte("effective_from", slice.start_at).or(`effective_to.is.null,effective_to.gt.${slice.start_at}`)
    .order("effective_from", { ascending: false }).limit(1).maybeSingle();
  const { data: existing } = await findRate();
  if (existing) return existing;
  const creditsPerHour = PILOT_RATES[slice.skill_level as keyof typeof PILOT_RATES];
  const { error } = await db.from("community_rate_versions").upsert({
    community: slice.community, lane: slice.sao_lane, skill_level: slice.skill_level,
    credits_per_hour: creditsPerHour, effective_from: "2000-01-01T00:00:00.000Z",
    effective_to: null, version: PILOT_RATE_VERSION, created_by: ownerId,
  }, { onConflict: "community,lane,skill_level,version", ignoreDuplicates: true });
  if (error) throw new Error(`Could not create the pilot Performance rate: ${error.message}`);
  const { data: created } = await findRate();
  if (!created) throw new Error("No effective Performance rate could be found");
  return created;
}

async function calculateValidatedSlice(canonicalId: string, ownerId: string, replayRunId: string) {
  const db = adminClient();
  const { data: slice } = await db.from("canonical_slices")
    .select("id,status,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community,sao_lane,skill_level,impact_direction,impact_intensity,confidence,protocol_link_id,revision_number,draft_slices(intake_sessions(parser_version))")
    .eq("id", canonicalId).single();
  if (!slice || slice.status !== "validated") return { blocked: false, skipped: true };

  const { data: reversalRows } = await db.from("w_transitions").select("reversal_of")
    .eq("owner_id", ownerId).eq("event_kind", "reversal");
  const reversedWIds = new Set((reversalRows ?? []).map((row) => row.reversal_of).filter(Boolean));
  const { data: recentW } = await db.from("w_transitions").select("id,post_slice_w,created_at")
    .eq("owner_id", ownerId).eq("event_kind", "calculation").order("created_at", { ascending: false }).limit(500);
  const activeW = (recentW ?? []).find((row) => !reversedWIds.has(row.id));
  const { data: priorBaseline } = await db.from("wellbeing_baselines").select("value,effective_at")
    .eq("owner_id", ownerId).lte("effective_at", slice.start_at).order("effective_at", { ascending: false }).limit(1).maybeSingle();
  const { data: pilotBaseline } = priorBaseline ? { data: null } : await db.from("wellbeing_baselines").select("value,effective_at")
    .eq("owner_id", ownerId).order("effective_at", { ascending: true }).limit(1).maybeSingle();
  const baseline = priorBaseline ?? pilotBaseline;
  const preW = Number(activeW?.post_slice_w ?? baseline?.value);
  if (!Number.isFinite(preW)) throw new Error("A reviewed baseline W is required");
  const sourceDraft = Array.isArray(slice.draft_slices) ? slice.draft_slices[0] : slice.draft_slices;
  const sourceIntake = Array.isArray(sourceDraft?.intake_sessions)
    ? sourceDraft.intake_sessions[0]
    : sourceDraft?.intake_sessions;
  const parserVersion = sourceIntake?.parser_version ?? PARSER_SCHEMA_VERSION;

  if (slice.slice_type === "non_performance") {
    const date = localDate(slice.start_at, slice.timezone);
    const { data: transitions } = await db.from("w_transitions").select("id,applied_change,canonical_slices!inner(start_at,timezone)")
      .eq("owner_id", ownerId).eq("event_kind", "calculation").limit(1000);
    const movement = (transitions ?? []).filter((row) => {
      const canonical = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
      return canonical && !reversedWIds.has(row.id) && localDate(canonical.start_at, canonical.timezone) === date;
    }).reduce((total, row) => total + Number(row.applied_change), 0);
    const result = calculateWTransition({
      preSliceW: preW, direction: slice.impact_direction, intensity: slice.impact_intensity,
      confidence: slice.confidence, durationMinutes: durationMinutes(slice.start_at, slice.end_at),
      movementAlreadyAppliedToday: movement,
    });
    const provenance = { protocolLinkId: slice.protocol_link_id, revision: slice.revision_number, parserVersion,
      calculatorVersion: result.calculatorVersion, formulaInputs: result.formulaInputs, baselineEffectiveAt: baseline?.effective_at };
    const { error } = await db.from("w_transitions").insert({
      canonical_slice_id: slice.id, protocol_link_id: slice.protocol_link_id, source_revision: slice.revision_number,
      owner_id: ownerId, pre_slice_w: result.preSliceW, requested_post_w: result.requestedPostW,
      post_slice_w: result.postSliceW, requested_change: result.requestedChange, applied_change: result.appliedChange,
      parser_version: parserVersion, calculator_version: result.calculatorVersion, formula_inputs: result.formulaInputs,
      formula_result: result, input_hash: inputHash(provenance), replay_run_id: replayRunId,
      cap_limited: result.capLimited, minimum_duration_limited: result.minimumDurationLimited,
    });
    if (error) throw new Error(error.message);
  } else {
    const rate = await effectiveRateFor(slice, ownerId);
    const result = calculatePerformanceCredit({ durationMinutes: durationMinutes(slice.start_at, slice.end_at), preSliceW: preW, creditRatePerHour: Number(rate.credits_per_hour) });
    const provenance = { protocolLinkId: slice.protocol_link_id, revision: slice.revision_number, parserVersion,
      calculatorVersion: result.calculatorVersion, rateVersion: rate.version, formulaInputs: result.formulaInputs };
    const { error } = await db.from("credit_events").insert({
      canonical_slice_id: slice.id, protocol_link_id: slice.protocol_link_id, source_revision: slice.revision_number,
      owner_id: ownerId, pre_slice_w: preW, post_slice_w: preW, parser_version: parserVersion,
      calculator_version: result.calculatorVersion, rate_version_id: rate.id, rate_version: rate.version,
      formula_inputs: result.formulaInputs, formula_result: result.result, input_hash: inputHash(provenance), replay_run_id: replayRunId,
    });
    if (error) throw new Error(error.message);
  }
  await db.from("canonical_slices").update({ status: "calculated" }).eq("id", canonicalId).eq("status", "validated");
  await db.from("audit_events").insert({ owner_id: ownerId, actor_type: "system", event_type: "slice_calculated",
    entity_type: "canonical_slice", entity_id: canonicalId, metadata: { replay_run_id: replayRunId } });
  return { blocked: false, skipped: false };
}

export async function runReplayFrom(ownerId: string, fromTimestamp: string, replayRunId: string) {
  const db = adminClient();
  try {
    const { data: run } = await db.from("replay_runs").select("id,owner_id,status,from_timestamp")
      .eq("id", replayRunId).eq("owner_id", ownerId).maybeSingle();
    if (!run || run.status !== "running" || run.from_timestamp !== fromTimestamp) {
      throw new Error("Replay request is no longer active");
    }
    await db.from("replay_runs").update({ heartbeat_at: new Date().toISOString() }).eq("id", replayRunId).eq("status", "running");
    const founderMode = founderWellbeingMode();
    const { data: founderBaseline } = founderMode === "founder_v0_1_live"
      ? await db.from("founder_wellbeing_baseline_epochs").select("effective_at")
        .eq("owner_id", ownerId).order("effective_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    const founderBranchOnly = (startAt: string) => Boolean(
      founderBaseline && scoreBranchForOccurrence(startAt, founderBaseline.effective_at) === "canonical_founder"
    );
    // This happens before any reversal, state update, or calculation write. A
    // failed preflight therefore preserves both human validation and the last
    // completed projection intact.
    const { data: activeTimeline, error: timelineError } = await db.from("canonical_slices")
      .select("id,start_at,end_at,community,status").eq("owner_id", ownerId)
      .order("start_at").limit(5000);
    if (timelineError) throw new Error(timelineError.message);
    const conflict = findTimelineOverlaps(activeTimeline ?? [])[0];
    if (conflict) throw timelineOverlapError(conflict);
    const { data: historicalSlices } = await db.from("canonical_slices").select("id,status,start_at")
      .eq("owner_id", ownerId).gte("start_at", fromTimestamp).neq("status", "reversed").order("start_at");
    const selection = replaySliceSelection(historicalSlices ?? []);
    const startById = new Map((historicalSlices ?? []).map((slice) => [slice.id, slice.start_at]));
    const reversalSliceIds = selection.reversalSliceIds.filter((id) => !founderBranchOnly(startById.get(id) ?? fromTimestamp));
    const activeCalculatedSliceIds = selection.activeCalculatedSliceIds;

    if (reversalSliceIds.length) {
      const [{ data: wEvents }, { data: creditEvents }, { data: existingW }, { data: existingCredits }] = await Promise.all([
        db.from("w_transitions")
          .select("id,canonical_slice_id,protocol_link_id,source_revision,owner_id,pre_slice_w,requested_post_w,post_slice_w,requested_change,applied_change,parser_version,calculator_version,formula_inputs,formula_result,input_hash,cap_limited,minimum_duration_limited")
          .eq("owner_id", ownerId).eq("event_kind", "calculation").in("canonical_slice_id", reversalSliceIds),
        db.from("credit_events")
          .select("id,canonical_slice_id,protocol_link_id,source_revision,owner_id,pre_slice_w,post_slice_w,parser_version,calculator_version,rate_version_id,rate_version,formula_inputs,formula_result,input_hash")
          .eq("owner_id", ownerId).eq("event_kind", "calculation").in("canonical_slice_id", reversalSliceIds),
        db.from("w_transitions").select("reversal_of").eq("owner_id", ownerId).eq("event_kind", "reversal"),
        db.from("credit_events").select("reversal_of").eq("owner_id", ownerId).eq("event_kind", "reversal"),
      ]);
      const reversedW = new Set((existingW ?? []).map((row) => row.reversal_of));
      const reversedCredits = new Set((existingCredits ?? []).map((row) => row.reversal_of));
      const unreversedW = (wEvents ?? []).filter((event) => !reversedW.has(event.id));
      const unreversedCredits = (creditEvents ?? []).filter((event) => !reversedCredits.has(event.id));
      if (unreversedW.length) {
        const rows = unreversedW.map(({ id: originalId, ...event }) => ({ ...event, event_kind: "reversal",
          reversal_of: originalId, replay_run_id: replayRunId,
          formula_result: { reversal_of: originalId, original_result: event.formula_result },
          input_hash: inputHash({ reversal_of: originalId, replay_run_id: replayRunId }) }));
        const { error } = await db.from("w_transitions").insert(rows);
        if (error) throw new Error(error.message);
      }
      if (unreversedCredits.length) {
        const rows = unreversedCredits.map(({ id: originalId, ...event }) => ({ ...event, event_kind: "reversal",
          reversal_of: originalId, replay_run_id: replayRunId, formula_result: 0,
          input_hash: inputHash({ reversal_of: originalId, replay_run_id: replayRunId }) }));
        const { error } = await db.from("credit_events").insert(rows);
        if (error) throw new Error(error.message);
      }
      if (activeCalculatedSliceIds.length) await db.from("canonical_slices").update({ status: "validated" })
        .in("id", activeCalculatedSliceIds).eq("status", "calculated");
    }

    const { data: replayable } = await db.from("current_time_slices").select("id,start_at,end_at,status")
      .eq("owner_id", ownerId).gte("start_at", fromTimestamp).in("status", ["validated", "calculated"])
      .order("start_at").order("end_at").order("id");
    let calculated = 0;
    for (const slice of replayable ?? []) {
      if (slice.status === "calculated") await db.from("canonical_slices").update({ status: "validated" }).eq("id", slice.id);
      if (founderBranchOnly(slice.start_at)) {
        await db.from("canonical_slices").update({ status: "calculated" }).eq("id", slice.id).eq("status", "validated");
        await db.from("audit_events").insert({ owner_id: ownerId, actor_type: "system", event_type: "slice_calculated",
          entity_type: "canonical_slice", entity_id: slice.id,
          metadata: { replay_run_id: replayRunId, calculation_mode: "founder_v0_1_live", legacy_frozen_at: founderBaseline!.effective_at } });
        calculated += 1;
        continue;
      }
      const result = await calculateValidatedSlice(slice.id, ownerId, replayRunId);
      if (!result.blocked && !result.skipped) calculated += 1;
      if (calculated % 20 === 0) await db.from("replay_runs").update({ heartbeat_at: new Date().toISOString(), affected_count: calculated }).eq("id", replayRunId);
    }
    try {
      await runFounderReplay(ownerId, `legacy_replay:${replayRunId}`);
    } catch (founderError) {
      const message = founderError instanceof Error ? founderError.message : "Founder replay failed";
      await db.from("audit_events").insert({ owner_id: ownerId, actor_type: "system", event_type: "founder_wellbeing_replay_failed",
        entity_type: "replay_run", entity_id: replayRunId, metadata: { failure_code: message } });
    }
    await db.from("audit_events").insert({ owner_id: ownerId, actor_type: "system", event_type: "chronological_replay_completed",
      entity_type: "replay_run", entity_id: replayRunId,
      metadata: { from_timestamp: fromTimestamp, reversed_slice_count: reversalSliceIds.length, calculated_count: calculated } });
    await db.from("replay_runs").update({ status: "completed", completed_at: new Date().toISOString(), affected_count: calculated, heartbeat_at: new Date().toISOString(), failure_message: null }).eq("id", replayRunId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown replay failure";
    await db.from("replay_runs").update({ status: "failed", completed_at: new Date().toISOString(), failure_message: message, heartbeat_at: new Date().toISOString() }).eq("id", replayRunId);
    await db.from("audit_events").insert({ owner_id: ownerId, actor_type: "system", event_type: "chronological_replay_failed",
      entity_type: "replay_run", entity_id: replayRunId, metadata: { from_timestamp: fromTimestamp, failure_code: message.startsWith("timeline_overlap:") ? message : "replay_failure" } });
    throw error;
  }
}
