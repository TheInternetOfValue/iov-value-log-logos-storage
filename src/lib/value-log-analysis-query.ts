import { CANONICAL_MEMBER_DID, analysisWindows } from "./value-log-analysis";

export function buildValueLogAnalysisQuery(asOf: string) {
  const windows = analysisWindows(asOf);
  const start = `${windows.query_start}T00:00:00+05:30`;
  const end = `${windows.query_end_exclusive}T00:00:00+05:30`;
  return `begin transaction read only;
with active_slices as (
  select distinct on (protocol_link_id)
    id, protocol_link_id, start_at, end_at, timezone, status, activity,
    wellbeing_node, community, sao_lane, skill_level
  from public.canonical_slices
  where status not in ('reversed', 'superseded')
  order by protocol_link_id, revision_number desc
), selected_slices as (
  select * from active_slices
  where start_at < '${end}'::timestamptz and end_at >= '${start}'::timestamptz
), selected_w as (
  select w.id, w.canonical_slice_id, w.pre_slice_w, w.post_slice_w,
    w.applied_change, w.cap_limited, s.start_at, s.end_at, s.timezone,
    s.activity, s.wellbeing_node, s.community
  from public.w_transitions w
  join selected_slices s on s.id = w.canonical_slice_id
  join public.replay_runs rr on rr.id = w.replay_run_id and rr.status = 'completed'
  where w.event_kind = 'calculation'
    and not exists (select 1 from public.w_transitions reversal where reversal.reversal_of = w.id)
), selected_credits as (
  select c.id, c.canonical_slice_id, c.formula_result, s.start_at, s.end_at,
    s.timezone, s.activity, s.wellbeing_node, s.community, s.sao_lane, s.skill_level
  from public.credit_events c
  join selected_slices s on s.id = c.canonical_slice_id
  join public.replay_runs rr on rr.id = c.replay_run_id and rr.status = 'completed'
  where c.event_kind = 'calculation'
    and not exists (select 1 from public.credit_events reversal where reversal.reversal_of = c.id)
)
select json_build_object(
  'schema_version', 'value-log-analysis-input-v1',
  'verification', json_build_object(
    'canonical_did_count', (select count(*) from public.member_identity_bindings where did = '${CANONICAL_MEMBER_DID}'),
    'member_count', (select count(*) from public.members)
  ),
  'slices', coalesce((select json_agg(row_to_json(s) order by s.start_at) from selected_slices s), '[]'::json),
  'w_events', coalesce((select json_agg(row_to_json(w) order by w.end_at) from selected_w w), '[]'::json),
  'credit_events', coalesce((select json_agg(row_to_json(c) order by c.start_at) from selected_credits c), '[]'::json)
) as value_log_analysis;
commit;`;
}
