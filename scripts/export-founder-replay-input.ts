import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const linkedRepo = argument("--linked-repo");
const output = argument("--output");
const transitionReplayRunId = argument("--transition-replay-run-id");
if (!linkedRepo || !output) {
  throw new Error(
    "Usage: export-founder-replay-input --linked-repo PATH --output PRIVATE_JSON [--transition-replay-run-id UUID]",
  );
}
if (transitionReplayRunId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transitionReplayRunId)) {
  throw new Error("--transition-replay-run-id must be an exact UUID");
}
const linkedRoot = realpathSync(linkedRepo);
if (!existsSync(resolve(linkedRoot, "supabase/.temp/project-ref"))) throw new Error("The supplied Value Log repository is not linked to Supabase");

const selectedRunCte = transitionReplayRunId
  ? String.raw`selected_run as (
  select run.*
  from public.founder_wellbeing_replay_runs run
  join latest_baseline baseline
    on baseline.owner_id = run.owner_id
   and baseline.id = run.baseline_epoch_id
  where run.id = '${transitionReplayRunId}'::uuid
    and run.mode = 'founder_v0_1_live'
    and run.status = 'completed'
)`
  : String.raw`selected_run as (
  select run.* from public.current_promoted_founder_replay promoted
  join public.founder_wellbeing_replay_runs run on run.id = promoted.replay_run_id
  join latest_baseline baseline on baseline.owner_id = run.owner_id
  where promoted.mode = 'founder_v0_1_live'
  limit 1
)`;
const sourceLabel = transitionReplayRunId
  ? "linked-production-read-only-explicit-transition-run"
  : "linked-production-read-only-promoted-run";

const query = String.raw`
with latest_baseline as (
  select * from public.founder_wellbeing_baseline_epochs order by effective_at desc limit 1
), ${selectedRunCte}, active as (
  select slice.*, detail.activity_occurrence_id, detail.source_attestation_id, detail.native_skill_level,
    detail.founder_task_id, detail.founder_performance_impact, detail.founder_performance_impact_status,
    detail.founder_vcom_rate, detail.founder_vcom_unit, detail.founder_validation_mode,
    detail.impact_direction as founder_impact_direction, detail.impact_intensity as founder_impact_intensity,
    validation.decision as latest_decision, validation.self_observation_integrity,
    rate.policy_id as rate_policy_id, rate.authority_version_id,
    rate.community_rate_amount, rate.community_rate_unit, rate.native_level as policy_native_level,
    rate.policy_content_hash, rate.authority_content_hash,
    rate.protocol_finality_status, rate.payability_status, rate.finalized_at, rate.rate_null_reason
  from public.founder_replay_eligible_slices slice
  join latest_baseline baseline on baseline.owner_id = slice.owner_id
  join public.canonical_slices detail on detail.id = slice.id
  left join lateral (
    select decision, self_observation_integrity from public.validation_events
    where canonical_slice_id = slice.id order by created_at desc limit 1
  ) validation on true
  left join lateral public.resolve_founder_flat_community_rate(
    baseline.subject_id, slice.community, slice.sao_lane, slice.start_at, transaction_timestamp()
  ) rate on slice.slice_type = 'performance'
  where slice.status = 'calculated'
), payload as (
select jsonb_build_object(
  'cutoffAt', transaction_timestamp(),
  'source', '${sourceLabel}',
  'baseline', jsonb_build_object(
    'id', baseline.id, 'subjectId', baseline.subject_id, 'effectiveAt', baseline.effective_at,
    'state', jsonb_build_object('Physiology', baseline.physiology, 'Emotion', baseline.emotion,
      'Feeling', baseline.feeling, 'Thought', baseline.thought, 'Habit', baseline.habit, 'Performance', baseline.performance)
  ),
  'slices', coalesce((select jsonb_agg(jsonb_build_object(
    'id', slice.id, 'activityOccurrenceId', coalesce(slice.activity_occurrence_id, slice.id::text),
    'sourceAttestationId', slice.source_attestation_id, 'startAt', slice.start_at, 'endAt', slice.end_at,
    'component', slice.wellbeing_node, 'sliceType', slice.slice_type, 'sourceCommunity', slice.community,
    'route', slice.sao_lane, 'nativeSkillLevel', coalesce(slice.policy_native_level, slice.native_skill_level, case when slice.community = 'gfe' then slice.skill_level::text else null end),
    'taskId', slice.founder_task_id, 'evidenceRef', null,
    'direction', case when slice.founder_impact_direction = 'neutral' then null else slice.founder_impact_direction end,
    'intensity', slice.founder_impact_intensity, 'performanceImpact', slice.founder_performance_impact,
    'performanceImpactStatus', slice.founder_performance_impact_status,
    'rate', slice.community_rate_amount, 'vcomUnit', case when slice.community_rate_unit = 'USD_per_hour' then 'USD' else null end,
    'ratePolicyId', slice.rate_policy_id, 'authorityVersionId', slice.authority_version_id,
    'policyContentHash', slice.policy_content_hash, 'authorityContentHash', slice.authority_content_hash,
    'protocolFinalityStatus', slice.protocol_finality_status, 'payabilityStatus', slice.payability_status,
    'finalizedAt', slice.finalized_at, 'rateNullReason', slice.rate_null_reason,
    'validationMode', case when slice.founder_validation_mode = 'independent_review' then 'independent_review' else 'founder_self_review' end,
    'founderConfirmed', (slice.latest_decision = 'validated' or (slice.slice_type = 'performance' and slice.protocol_finality_status = 'final'))
      and (slice.slice_type = 'performance' or slice.self_observation_integrity = true)
  ) order by slice.start_at, slice.end_at, slice.id) from active slice), '[]'::jsonb),
  'previousReplay', jsonb_build_object(
    'id', run.id, 'completedAt', run.completed_at,
    'endingW', (select revision.w_after from public.founder_wellbeing_state_revisions revision where revision.replay_run_id = run.id order by sequence_number desc limit 1),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object(
      'sequenceNumber', revision.sequence_number, 'effectiveAt', revision.effective_at,
      'activityOccurrenceId', revision.activity_occurrence_id, 'sourceAttestationId', revision.source_attestation_id,
      'revisionKind', revision.revision_kind, 'component', revision.component,
      'componentBefore', revision.component_before, 'componentAfter', revision.component_after,
      'state', jsonb_build_object('Physiology', revision.physiology, 'Emotion', revision.emotion,
        'Feeling', revision.feeling, 'Thought', revision.thought, 'Habit', revision.habit, 'Performance', revision.performance),
      'wBefore', revision.w_before, 'wAfter', revision.w_after, 'deltaW', revision.delta_w,
      'transition', revision.transition, 'validationMode', revision.validation_mode
    ) order by revision.sequence_number) from public.founder_wellbeing_state_revisions revision where revision.replay_run_id = run.id), '[]'::jsonb),
    'values', coalesce((select jsonb_agg(jsonb_build_object(
      'canonicalSliceId', value.canonical_slice_id, 'activityOccurrenceId', value.activity_occurrence_id,
      'sourceAttestationId', value.source_attestation_id, 'performanceTransitionKey', value.performance_transition_key,
      'eventKind', value.event_kind, 'sourceCommunity', value.source_community, 'taskId', value.task_id,
      'evidenceRef', null, 'route', value.route, 'nativeSkillLevel', value.native_skill_level,
      'validatedDurationMinutes', value.validated_duration_minutes, 'rate', value.rate,
      'vcomAmount', value.vcom_amount, 'vcomUnit', value.vcom_unit, 'vcomScope', value.vcom_scope,
      'vcomSemantics', value.vcom_semantics, 'settlementStatus', value.settlement_status,
      'vcperformance', value.vcperformance, 'vcnonperformance', value.vcnonperformance,
      'wBefore', value.w_before, 'wAfter', value.w_after, 'deltaW', value.delta_w,
      'performanceImpact', value.performance_impact, 'performanceImpactStatus', value.performance_impact_status,
      'validationMode', value.validation_mode
    ) order by value.created_at, value.id) from public.founder_wellbeing_value_events value where value.replay_run_id = run.id), '[]'::jsonb)
  ),
  'invariantSnapshot', jsonb_build_object(
    'ownerId', baseline.owner_id, 'subjectId', baseline.subject_id,
    'baselineEpochId', baseline.id, 'baselineEffectiveAt', baseline.effective_at,
    'baselineW', baseline.wellbeing_score, 'policyId', baseline.policy_id,
    'policyVersion', baseline.policy_version, 'policyContentHash', baseline.policy_content_hash,
    'calculationVersion', baseline.calculation_version,
    'genesis', (select to_jsonb(qualification) - 'owner_id' - 'subject_id' from public.founder_genesis_baseline_qualifications qualification where qualification.baseline_epoch_id = baseline.id limit 1),
    'latestReplayId', run.id, 'latestReplayEventCount', run.event_count,
    'validationEventCount', (select count(*) from public.validation_events validation where validation.owner_id = baseline.owner_id)
  )
) as document
from latest_baseline baseline cross join selected_run run
)
select document from payload;`;

const result = spawnSync("npx", ["--no-install", "supabase", "db", "query", "--linked", "--output-format", "json", query], {
  cwd: linkedRoot,
  encoding: "utf8",
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  maxBuffer: 32 * 1024 * 1024,
});
if (result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`.trim() || "Read-only production snapshot failed");
const envelope = JSON.parse(result.stdout) as { rows?: Array<{ document?: unknown }> };
const document = envelope.rows?.[0]?.document;
if (!document) {
  throw new Error(
    transitionReplayRunId
      ? "The exact transition replay is not a completed live run on the latest baseline"
      : "Production has no explicitly promoted founder replay input",
  );
}
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`Private fixed-cutoff replay input written to ${resolve(output)}\n`);
