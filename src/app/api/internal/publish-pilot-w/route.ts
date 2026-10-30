import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import {
  MOSES_CANONICAL_DID,
  MOSES_PUBLIC_PROFILE_SLUG,
  PILOT_W_METHOD_VERSION,
  wordWalletApiBase,
} from "@/lib/identity";
import {
  buildProjectionSignature,
  pilotWProjectionSchema,
  projectionHash,
  projectionLimitations,
} from "@/lib/pilot-w-projection";
import {
  aggregateCommunityValue,
  communityValueLimitations,
  communityValueProjectionSchema,
  communityValueProvenanceHash,
  type ActiveCreditEvent,
  type ActiveWEvent,
} from "@/lib/community-value";
import { calculateFounderRollups, FOUNDER_CALCULATION_VERSION } from "@/lib/founder-wellbeing";
import { founderWellbeingMode } from "@/lib/founder-mode";
import {
  founderPerformanceProjectionValueFromDatabase,
  founderWellbeingLimitations,
  founderWellbeingProjectionSchema,
} from "@/lib/founder-wellbeing-projection";
import { runFounderReplay } from "@/lib/founder-replay-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expectedCron = process.env.PROJECTION_CRON_SECRET;
  const suppliedCron = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const trigger = request.headers.get("x-iov-publication-trigger") === "manual" ? "manual" : "scheduled";
  if (!expectedCron || suppliedCron !== expectedCron) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const projectionSecret = process.env.WORD_WALLET_PROJECTION_SECRET;
  if (!projectionSecret) return NextResponse.json({ ok: false, error: "projection_not_configured" }, { status: 503 });

  const db = adminClient();
  const publishLegacy = founderWellbeingMode() !== "founder_v0_1_live";
  const { data: binding } = await db.from("member_identity_bindings").select("owner_id,did").eq("did", MOSES_CANONICAL_DID).maybeSingle();
  if (!binding) return NextResponse.json({ ok: false, error: "identity_binding_missing" }, { status: 409 });
  const [
    { data: calculations },
    { data: reversals },
    { data: creditCalculations },
    { data: creditReversals },
  ] = await Promise.all([
    db.from("w_transitions").select("id,post_slice_w,applied_change,input_hash,created_at,canonical_slices!inner(community,start_at,end_at),replay_runs!inner(status)")
      .eq("owner_id", binding.owner_id).eq("event_kind", "calculation").eq("replay_runs.status", "completed").order("created_at").limit(2000),
    db.from("w_transitions").select("reversal_of,replay_runs!inner(status)").eq("owner_id", binding.owner_id).eq("event_kind", "reversal").eq("replay_runs.status", "completed").limit(2000),
    db.from("credit_events").select("id,formula_result,input_hash,created_at,canonical_slices!inner(community,start_at,end_at),replay_runs!inner(status)")
      .eq("owner_id", binding.owner_id).eq("event_kind", "calculation").eq("replay_runs.status", "completed").order("created_at").limit(2000),
    db.from("credit_events").select("reversal_of,replay_runs!inner(status)").eq("owner_id", binding.owner_id).eq("event_kind", "reversal").eq("replay_runs.status", "completed").limit(2000),
  ]);
  const reversed = new Set((reversals ?? []).map((row) => row.reversal_of));
  const active = (calculations ?? []).filter((row) => !reversed.has(row.id));
  const reversedCredits = new Set((creditReversals ?? []).map((row) => row.reversal_of));
  const activeCredits = (creditCalculations ?? []).filter((row) => !reversedCredits.has(row.id));
  const latest = active.at(-1);
  if (!latest) return NextResponse.json({ ok: false, error: "no_pilot_w_state" }, { status: 409 });
  const now = new Date();
  const settledAt = (row: typeof active[number]) => {
    const slice = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    return slice?.end_at ?? null;
  };
  const deltaSince = (milliseconds: number) => active
    .filter((row) => {
      const settled = settledAt(row);
      return settled !== null && new Date(settled).getTime() >= now.getTime() - milliseconds;
    })
    .reduce((sum, row) => sum + Number(row.applied_change), 0);
  const projection = pilotWProjectionSchema.parse({
    did: binding.did,
    public_profile_slug: MOSES_PUBLIC_PROFILE_SLUG,
    pilot_w_current: Number(latest.post_slice_w),
    delta_24h: deltaSince(24 * 60 * 60_000),
    delta_7d: deltaSince(7 * 24 * 60 * 60_000),
    input_window: {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(),
      end: now.toISOString(),
    },
    calculator_version: PILOT_W_METHOD_VERSION,
    aggregate_provenance_hash: projectionHash(active.map((row) => row.input_hash)),
    source_application: "iov-value-log",
    updated_at: now.toISOString(),
    experimental: true,
    limitations: projectionLimitations(),
  });
  const body = JSON.stringify(projection);
  const timestamp = now.toISOString();
  const idempotencyKey = `pilot-w:${binding.did}:${timestamp.slice(0, 10)}`;
  const response = publishLegacy ? await fetch(`${wordWalletApiBase()}/v1/internal/pilot-w-projections`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-iov-timestamp": timestamp,
      "x-iov-signature": buildProjectionSignature(projectionSecret, timestamp, body),
      "idempotency-key": idempotencyKey,
    },
    body,
  }) : new Response(JSON.stringify({ ok: true, skipped: "frozen_at_genesis" }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await response.json().catch(() => null);

  const activeCommunityW = active as ActiveWEvent[];
  const activeCommunityCredits = activeCredits as ActiveCreditEvent[];
  const sliceStarts = [...activeCommunityW, ...activeCommunityCredits].map((row) => {
    const slice = Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
    return slice?.start_at;
  }).filter((value): value is string => Boolean(value));
  const communityProjection = communityValueProjectionSchema.parse({
    did: binding.did,
    public_profile_slug: MOSES_PUBLIC_PROFILE_SLUG,
    communities: aggregateCommunityValue(activeCommunityW, activeCommunityCredits, now),
    input_window: {
      last_30_days_start: new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
      end: now.toISOString(),
      lifetime_start: sliceStarts.length ? new Date(Math.min(...sliceStarts.map((value) => new Date(value).getTime()))).toISOString() : null,
    },
    projection_version: "community-value-v1",
    aggregate_provenance_hash: communityValueProvenanceHash(activeCommunityW, activeCommunityCredits),
    source_application: "iov-value-log",
    updated_at: now.toISOString(),
    experimental: true,
    limitations: communityValueLimitations(),
  });
  const communityBody = JSON.stringify(communityProjection);
  const communityIdempotencyKey = `community-value:${binding.did}:${timestamp.slice(0, 10)}`;
  const communityResponse = publishLegacy ? await fetch(`${wordWalletApiBase()}/v1/internal/community-value-projections`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-iov-timestamp": timestamp,
      "x-iov-signature": buildProjectionSignature(projectionSecret, timestamp, communityBody),
      "idempotency-key": communityIdempotencyKey,
    },
    body: communityBody,
  }) : new Response(JSON.stringify({ ok: true, skipped: "frozen_at_genesis" }), { status: 200, headers: { "content-type": "application/json" } });
  const communityResult = await communityResponse.json().catch(() => null);
  let founderResult: unknown = { ok: true, skipped: founderWellbeingMode() !== "founder_v0_1_live" };
  let founderStatus = 200;
  if (founderWellbeingMode() === "founder_v0_1_live") {
    let { data: founderState } = await db.from("current_founder_wellbeing_state")
      .select("id,replay_run_id,verification_id,promotion_id,baseline_epoch_id,physiology,emotion,feeling,thought,habit,performance,w_after,effective_at,mode")
      .eq("owner_id", binding.owner_id).eq("mode", "founder_v0_1_live").maybeSingle();
    if (!founderState) {
      const replay = await runFounderReplay(binding.owner_id, "projection_state_initialization");
      if (replay.status === "completed") {
        const stateResult = await db.from("current_founder_wellbeing_state")
          .select("id,replay_run_id,verification_id,promotion_id,baseline_epoch_id,physiology,emotion,feeling,thought,habit,performance,w_after,effective_at,mode")
          .eq("owner_id", binding.owner_id).eq("mode", "founder_v0_1_live").maybeSingle();
        founderState = stateResult.data;
      }
    }
    if (!founderState) {
      founderResult = { ok: false, error: "founder_state_missing" };
      founderStatus = 409;
    } else {
      const { data: genesisStatus } = await db.from("current_founder_genesis_status")
        .select("baseline_epoch_id,baseline_method,baseline_status,snapshot_key,window_key,window_start,window_end,eligible_day_count,activity_count,recorded_minutes,issuer_id,policy_id,policy_version,ratified_at,pre_genesis_evidence_replayed,qualification_delta_w")
        .eq("owner_id", binding.owner_id).eq("baseline_epoch_id", founderState.baseline_epoch_id).maybeSingle();
      const { data: founderValues } = await db.from("founder_wellbeing_value_events")
        .select("source_community,native_skill_level,route,validated_duration_minutes,community_rate_amount,community_rate_unit,vcom_event_amount,vcom_event_unit,vcperformance_event_amount,vcperformance_event_unit,protocol_finality_status,payability_status,finality_authority_version_id,finalized_at")
        .eq("replay_run_id", founderState.replay_run_id).eq("event_kind", "performance")
        .order("created_at").limit(5000);
      const { data: founderRevisions } = await db.from("founder_wellbeing_state_revisions")
        .select("sequence_number,effective_at,w_after")
        .eq("replay_run_id", founderState.replay_run_id)
        .order("sequence_number", { ascending: true }).limit(5000);
      const movementCalculatedAt = now.toISOString();
      const movement24hStart = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
      const movement7dStart = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
      const scoreAt = (cutoff: string) => (founderRevisions ?? [])
        .filter((revision) => new Date(revision.effective_at).getTime() <= new Date(cutoff).getTime())
        .at(-1)?.w_after;
      const movementDelta = (cutoff: string) => {
        const prior = scoreAt(cutoff);
        return prior === null || prior === undefined ? null : Number(founderState.w_after) - Number(prior);
      };
      const activityMinutesSince = (community: "gfe" | "iov", cutoff: string) => (founderValues ?? [])
        .filter((value) => value.source_community === community && new Date(value.finalized_at).getTime() >= new Date(cutoff).getTime())
        .reduce((total, value) => total + Number(value.validated_duration_minutes ?? 0), 0);
      const delta24h = movementDelta(movement24hStart);
      const delta7d = movementDelta(movement7dStart);
      const founderComponents = {
        Physiology: Number(founderState.physiology), Emotion: Number(founderState.emotion), Feeling: Number(founderState.feeling),
        Thought: Number(founderState.thought), Habit: Number(founderState.habit), Performance: Number(founderState.performance),
      };
      const founderProjection = founderWellbeingProjectionSchema.parse({
        did: binding.did,
        public_profile_slug: MOSES_PUBLIC_PROFILE_SLUG,
        projection_revision: founderState.id,
        replay_run_id: founderState.replay_run_id,
        replay_verification_id: founderState.verification_id,
        replay_promotion_id: founderState.promotion_id,
        baseline_epoch_id: founderState.baseline_epoch_id,
        wellbeing_score: Number(founderState.w_after),
        delta_24h: delta24h,
        delta_7d: delta7d,
        movement_24h_window: { start: movement24hStart, end: movementCalculatedAt },
        movement_7d_window: { start: movement7dStart, end: movementCalculatedAt },
        movement_calculated_at: movementCalculatedAt,
        components: founderComponents,
        rollups: calculateFounderRollups(founderComponents),
        performance_values: (founderValues ?? []).filter((value) =>
          value.community_rate_amount !== null && value.vcom_event_amount !== null
          && value.vcperformance_event_amount !== null && value.protocol_finality_status === "final"
        ).slice(-100).map((value) => founderPerformanceProjectionValueFromDatabase({
          source_community: value.source_community,
          community_rate_amount: value.community_rate_amount,
          community_rate_unit: value.community_rate_unit,
          vcom_event_amount: value.vcom_event_amount,
          vcom_event_unit: value.vcom_event_unit,
          vcperformance_event_amount: value.vcperformance_event_amount,
          vcperformance_event_unit: value.vcperformance_event_unit,
          protocol_finality_status: value.protocol_finality_status,
          payability_status: value.payability_status,
          finality_authority_version_id: value.finality_authority_version_id,
          finalized_at: value.finalized_at,
        })),
        community_recognitions: [
          {
            community_code: "house_of_bros",
            community_name: "HouseOfBros",
            community_type: "wellbeing_and_wellbecoming",
            relationship: "founder",
            recognition_status: "genesis_ratified",
            validation_mode: "founder_self_review",
            external_review_claimed: false,
            movement_24h: delta24h,
            movement_7d: delta7d,
            movement_unit: "W",
            limitations: ["Issuer-specific founder state; not a universal rank or an independently reviewed credential."],
          },
          {
            community_code: "gfe",
            community_name: "Growth Flow Engineering",
            community_type: "skill_based",
            relationship: "founder",
            skill_system_id: "gfe-skill-system",
            native_level: "GFE-3.3.3",
            level_name: "L3",
            recognition_status: "self_ratified",
            validation_mode: "founder_self_review",
            external_review_claimed: false,
            routes: ["Learning", "Earning", "OrgBuilding"],
            activity_24h_minutes: activityMinutesSince("gfe", movement24hStart),
            activity_7d_minutes: activityMinutesSince("gfe", movement7dStart),
            limitations: ["Moses-only founder exception; no external validation is claimed."],
          },
          {
            community_code: "iov",
            community_name: "IoV Research Foundation",
            community_type: "research_and_skill",
            relationship: "founder",
            skill_system_id: "iov-systems-modeling-founder-v0.1",
            native_level: "SM3",
            level_name: "Architect",
            recognition_status: "founder_attested",
            validation_mode: "founder_self_review",
            external_review_claimed: false,
            routes: ["Learning", "Earning", "OrgBuilding"],
            activity_24h_minutes: activityMinutesSince("iov", movement24hStart),
            activity_7d_minutes: activityMinutesSince("iov", movement7dStart),
            limitations: ["Founder-pilot attestation; no independent external review is claimed."],
          },
        ],
        policy_id: "hob-wellbecoming-founder-v0.1",
        policy_version: "0.1.0",
        policy_content_hash: "e1601b1804716f9ab39314340386d6280993c36db7cb85c364d7a2607477f471",
        calculation_version: FOUNDER_CALCULATION_VERSION,
        genesis: genesisStatus ? {
          status: genesisStatus.baseline_status,
          baseline_method: genesisStatus.baseline_method,
          identity_snapshot_reference: genesisStatus.snapshot_key,
          observation_window: {
            reference: genesisStatus.window_key,
            start_date: genesisStatus.window_start,
            end_date: genesisStatus.window_end,
            eligible_day_count: genesisStatus.eligible_day_count,
            activity_count: genesisStatus.activity_count,
            recorded_minutes: Number(genesisStatus.recorded_minutes),
          },
          issuer_id: genesisStatus.issuer_id,
          policy_id: genesisStatus.policy_id,
          policy_version: genesisStatus.policy_version,
          baseline_epoch_id: genesisStatus.baseline_epoch_id,
          ratified_at: new Date(genesisStatus.ratified_at).toISOString(),
          pre_genesis_evidence_replayed: genesisStatus.pre_genesis_evidence_replayed,
          qualification_delta_w: Number(genesisStatus.qualification_delta_w),
        } : null,
        validation_mode: "founder_self_review",
        source_application: "iov-value-log",
        updated_at: new Date(founderState.effective_at).toISOString(),
        limitations: founderWellbeingLimitations,
      });
      const founderBody = JSON.stringify(founderProjection);
      const founderIdempotencyKey = `founder-wellbeing:${binding.did}:${founderState.id}:${timestamp.slice(0, 10)}`;
      const founderResponse = await fetch(`${wordWalletApiBase()}/v1/internal/founder-wellbeing-projections`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-iov-timestamp": timestamp,
          "x-iov-signature": buildProjectionSignature(projectionSecret, timestamp, founderBody),
          "idempotency-key": founderIdempotencyKey,
        },
        body: founderBody,
      });
      founderStatus = founderResponse.status;
      founderResult = await founderResponse.json().catch(() => ({ ok: founderResponse.ok }));
      await db.from("audit_events").insert({
        owner_id: binding.owner_id,
        actor_type: "system",
        event_type: founderResponse.ok ? "founder_wellbeing_projection_published" : "founder_wellbeing_projection_failed",
        entity_type: "wellbeing_identity",
        entity_id: binding.did,
        metadata: { idempotency_key: founderIdempotencyKey, status: founderResponse.status, request_id: randomUUID(), trigger },
      });
    }
  }
  if (publishLegacy) await db.from("audit_events").insert({
    owner_id: binding.owner_id,
    actor_type: "system",
    event_type: response.ok ? "pilot_w_projection_published" : "pilot_w_projection_failed",
    entity_type: "wellbeing_identity",
    entity_id: binding.did,
    metadata: { idempotency_key: idempotencyKey, status: response.status, request_id: randomUUID(), trigger },
  });
  if (publishLegacy) await db.from("audit_events").insert({
    owner_id: binding.owner_id,
    actor_type: "system",
    event_type: communityResponse.ok ? "community_value_projection_published" : "community_value_projection_failed",
    entity_type: "wellbeing_identity",
    entity_id: binding.did,
    metadata: { idempotency_key: communityIdempotencyKey, status: communityResponse.status, request_id: randomUUID(), trigger },
  });
  const founderOk = typeof founderResult === "object" && founderResult !== null && "ok" in founderResult && Boolean((founderResult as { ok?: boolean }).ok);
  const ok = response.ok && communityResponse.ok && founderOk;
  return NextResponse.json({
    ok,
    error: ok ? undefined : "projection_sync_failed",
    pilot_w: result ?? { ok: response.ok },
    community_value: communityResult ?? { ok: communityResponse.ok, status: communityResponse.status },
    founder_wellbeing: founderResult ?? { ok: founderStatus < 400, status: founderStatus },
  }, { status: ok ? 200 : 502 });
}
