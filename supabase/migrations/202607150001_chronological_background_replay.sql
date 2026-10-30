alter table public.replay_runs
  add column if not exists from_timestamp timestamptz,
  add column if not exists failure_message text,
  add column if not exists affected_count integer not null default 0,
  add column if not exists heartbeat_at timestamptz;

-- Previous synchronous requests could leave more than one replay labelled as
-- running after a browser timeout. The new background worker is not deployed
-- while this migration is applied, so close those abandoned runs without
-- deleting their audit history before enforcing one active run per owner.
update public.replay_runs
set status = 'failed',
    completed_at = coalesce(completed_at, now()),
    failure_message = coalesce(
      failure_message,
      'Closed as an abandoned pre-background replay during the chronological replay migration.'
    )
where status = 'running';

create unique index if not exists one_running_replay_per_owner
  on public.replay_runs (owner_id) where status = 'running';

create index if not exists canonical_review_chronology_idx
  on public.canonical_slices (owner_id, status, start_at);
create index if not exists draft_review_chronology_idx
  on public.draft_slices (owner_id, status, start_at);
create index if not exists validation_slice_lookup_idx
  on public.validation_events (owner_id, canonical_slice_id, created_at desc);
create index if not exists replay_owner_status_idx
  on public.replay_runs (owner_id, status, started_at desc);
create index if not exists w_transition_replay_lookup_idx
  on public.w_transitions (owner_id, canonical_slice_id, event_kind, created_at);
create index if not exists credit_event_replay_lookup_idx
  on public.credit_events (owner_id, canonical_slice_id, event_kind, created_at);

-- A running replay is prepared append-only, but it must not become part of the
-- current projection until the run completes. This keeps projection reads
-- stable even if a worker fails between batches.
create or replace view public.daily_w_state with (security_invoker = true) as
select w.owner_id,
       (c.start_at at time zone c.timezone)::date as local_date,
       (array_agg(w.pre_slice_w order by c.start_at asc))[1] as start_w,
       (array_agg(w.post_slice_w order by c.start_at desc))[1] as end_w,
       sum(w.applied_change) as applied_movement,
       sum(w.requested_change) as requested_movement,
       count(*) filter (where w.cap_limited) as cap_limited_count
from public.w_transitions w
join public.canonical_slices c on c.id = w.canonical_slice_id
join public.replay_runs run on run.id = w.replay_run_id and run.status = 'completed'
where w.event_kind = 'calculation'
  and not exists (
    select 1
    from public.w_transitions r
    join public.replay_runs reversal_run on reversal_run.id = r.replay_run_id and reversal_run.status = 'completed'
    where r.reversal_of = w.id
  )
group by w.owner_id, local_date;

create or replace view public.daily_credit_summary with (security_invoker = true) as
select c.owner_id,
       (slice.start_at at time zone slice.timezone)::date as local_date,
       sum(c.formula_result) as total_credits,
       count(*) as credit_event_count
from public.credit_events c
join public.canonical_slices slice on slice.id = c.canonical_slice_id
join public.replay_runs run on run.id = c.replay_run_id and run.status = 'completed'
where c.event_kind = 'calculation'
  and not exists (
    select 1
    from public.credit_events r
    join public.replay_runs reversal_run on reversal_run.id = r.replay_run_id and reversal_run.status = 'completed'
    where r.reversal_of = c.id
  )
group by c.owner_id, local_date;
