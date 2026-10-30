create extension if not exists pgcrypto;

create type public.slice_type as enum ('non_performance', 'performance');
create type public.wellbeing_node as enum ('Physiology', 'Emotion', 'Feeling', 'Thought', 'Habit', 'Performance');
create type public.community_code as enum ('house_of_bros', 'iov', 'gfe');
create type public.sao_lane as enum ('Learning', 'Earning', 'OrgBuilding');
create type public.skill_level as enum ('L0', 'L1', 'L2', 'L3', 'L4');
create type public.lifecycle_status as enum (
  'drafted', 'observer_approved', 'observer_rejected', 'validation_pending',
  'validated', 'validation_rejected', 'calculated', 'reversed', 'superseded'
);
create type public.impact_direction as enum ('positive', 'neutral', 'negative');
create type public.impact_intensity as enum ('low', 'medium', 'high');
create type public.observation_confidence as enum ('observed', 'inferred', 'uncertain');
create type public.validation_role as enum ('house_of_bros_validator', 'iov_validator', 'gfe_validator');

create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default 'Moses',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);
create unique index members_email_lower_unique on public.members (lower(email));

create table public.intake_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  source text not null check (source = 'custom_gpt'),
  parser_version text not null,
  idempotency_key text not null unique,
  source_timestamp timestamptz,
  received_at timestamptz not null default now(),
  timezone text not null,
  narrative_ciphertext text,
  narrative_iv text,
  narrative_auth_tag text,
  narrative_key_version integer,
  narrative_digest text not null,
  narrative_deleted_at timestamptz,
  status lifecycle_status not null default 'drafted',
  constraint narrative_content_complete check (
    narrative_deleted_at is not null or
    (narrative_ciphertext is not null and narrative_iv is not null and narrative_auth_tag is not null and narrative_key_version is not null)
  )
);

create table public.draft_slices (
  id uuid primary key default gen_random_uuid(),
  intake_session_id uuid not null references public.intake_sessions(id),
  owner_id uuid not null references public.members(id),
  machine_source text not null default 'custom_gpt',
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  activity text not null,
  proof text,
  wellbeing_node wellbeing_node not null,
  slice_type slice_type not null,
  community community_code not null,
  sao_lane sao_lane,
  skill_level skill_level,
  impact_direction impact_direction,
  impact_intensity impact_intensity,
  confidence observation_confidence,
  status lifecycle_status not null default 'drafted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint positive_draft_duration check (end_at > start_at),
  constraint draft_route_contract check (
    (slice_type = 'performance' and wellbeing_node = 'Performance' and community in ('iov', 'gfe') and sao_lane is not null and skill_level is not null)
    or
    (slice_type = 'non_performance' and wellbeing_node <> 'Performance' and community = 'house_of_bros' and impact_direction is not null and impact_intensity is not null and confidence is not null)
  )
);

create table public.canonical_slices (
  id uuid primary key default gen_random_uuid(),
  protocol_link_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  draft_slice_id uuid unique references public.draft_slices(id),
  owner_id uuid not null references public.members(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  activity text not null,
  proof text,
  wellbeing_node wellbeing_node not null,
  slice_type slice_type not null,
  community community_code not null,
  sao_lane sao_lane,
  skill_level skill_level,
  impact_direction impact_direction,
  impact_intensity impact_intensity,
  confidence observation_confidence,
  status lifecycle_status not null default 'validation_pending',
  supersedes_slice_id uuid references public.canonical_slices(id),
  created_at timestamptz not null default now(),
  unique (protocol_link_id, revision_number),
  constraint positive_canonical_duration check (end_at > start_at)
);

create table public.observer_events (
  id uuid primary key default gen_random_uuid(),
  draft_slice_id uuid not null references public.draft_slices(id),
  canonical_slice_id uuid references public.canonical_slices(id),
  owner_id uuid not null references public.members(id),
  actor_id uuid not null references public.members(id),
  decision text not null check (decision in ('approved', 'rejected')),
  rationale text,
  created_at timestamptz not null default now()
);

create table public.validation_events (
  id uuid primary key default gen_random_uuid(),
  canonical_slice_id uuid not null references public.canonical_slices(id),
  owner_id uuid not null references public.members(id),
  signer_id uuid not null references public.members(id),
  role validation_role not null,
  community community_code not null,
  decision text not null check (decision in ('validated', 'rejected')),
  evidence_adequate boolean,
  classification_adequate boolean,
  self_observation_integrity boolean,
  rationale text not null,
  evidence_reviewed text,
  created_at timestamptz not null default now()
);

create table public.wellbeing_baselines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  value numeric(12,6) not null check (value between 100 and 1000),
  effective_at timestamptz not null,
  rationale text not null,
  created_at timestamptz not null default now()
);

create table public.community_rate_versions (
  id uuid primary key default gen_random_uuid(),
  community community_code not null check (community in ('iov', 'gfe')),
  lane sao_lane not null,
  skill_level skill_level not null,
  credits_per_hour numeric(18,6) not null check (credits_per_hour >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  version text not null,
  created_by uuid not null references public.members(id),
  created_at timestamptz not null default now(),
  unique (community, lane, skill_level, version),
  check (effective_to is null or effective_to > effective_from)
);

create table public.replay_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  reason text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'failed'))
);

create table public.w_transitions (
  id uuid primary key default gen_random_uuid(),
  canonical_slice_id uuid not null references public.canonical_slices(id),
  protocol_link_id uuid not null,
  source_revision integer not null,
  owner_id uuid not null references public.members(id),
  pre_slice_w numeric(12,6) not null,
  requested_post_w numeric(12,6) not null,
  post_slice_w numeric(12,6) not null,
  requested_change numeric(12,6) not null,
  applied_change numeric(12,6) not null,
  parser_version text not null,
  calculator_version text not null,
  formula_inputs jsonb not null,
  formula_result jsonb not null,
  input_hash text not null,
  replay_run_id uuid not null references public.replay_runs(id),
  cap_limited boolean not null default false,
  minimum_duration_limited boolean not null default false,
  event_kind text not null default 'calculation' check (event_kind in ('calculation', 'reversal')),
  reversal_of uuid unique references public.w_transitions(id),
  created_at timestamptz not null default now()
);

create table public.credit_events (
  id uuid primary key default gen_random_uuid(),
  canonical_slice_id uuid not null references public.canonical_slices(id),
  protocol_link_id uuid not null,
  source_revision integer not null,
  owner_id uuid not null references public.members(id),
  pre_slice_w numeric(12,6) not null,
  post_slice_w numeric(12,6) not null,
  parser_version text not null,
  calculator_version text not null,
  rate_version_id uuid not null references public.community_rate_versions(id),
  rate_version text not null,
  formula_inputs jsonb not null,
  formula_result numeric(18,6) not null,
  input_hash text not null,
  replay_run_id uuid not null references public.replay_runs(id),
  event_kind text not null default 'calculation' check (event_kind in ('calculation', 'reversal')),
  reversal_of uuid unique references public.credit_events(id),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid references public.members(id),
  actor_type text not null check (actor_type in ('machine', 'observer', 'validator', 'system')),
  actor_id uuid references public.members(id),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_ip_hash text,
  created_at timestamptz not null default now()
);

create table public.ingestion_rate_limits (
  bucket text primary key,
  request_count integer not null default 0,
  window_started_at timestamptz not null default now()
);

create table public.pilot_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  metric_date date not null,
  submission_seconds integer,
  review_seconds integer,
  parser_fields_total integer,
  parser_fields_correct integer,
  manual_correction_count integer not null default 0,
  rejected_slice_count integer not null default 0,
  overlap_error_count integer not null default 0,
  cap_limited_count integer not null default 0,
  logging_delayed_or_avoided boolean,
  w_believability text check (w_believability in ('believable', 'questionable', 'not_believable')),
  friction_notes text,
  unique (owner_id, metric_date)
);

create index canonical_slice_interval on public.canonical_slices (owner_id, start_at, end_at);
create index canonical_slice_status on public.canonical_slices (owner_id, status);
create index draft_slice_status on public.draft_slices (owner_id, status);
create index audit_owner_created on public.audit_events (owner_id, created_at desc);

create view public.current_time_slices with (security_invoker = true) as
select distinct on (protocol_link_id) *
from public.canonical_slices
where status not in ('reversed', 'superseded')
order by protocol_link_id, revision_number desc;

create view public.pending_intake_review with (security_invoker = true) as
select i.id as intake_session_id, i.received_at, i.parser_version, i.timezone,
       count(d.id) as draft_count
from public.intake_sessions i
join public.draft_slices d on d.intake_session_id = i.id
where d.status = 'drafted'
group by i.id;

create view public.validation_queue with (security_invoker = true) as
select c.*,
  case
    when c.wellbeing_node <> 'Performance' then 'house_of_bros_validator'
    when c.community = 'gfe' then 'gfe_validator'
    else 'iov_validator'
  end as required_role
from public.current_time_slices c
where c.status = 'validation_pending';

create view public.daily_w_state with (security_invoker = true) as
select owner_id, (created_at at time zone 'Asia/Kolkata')::date as local_date,
       (array_agg(pre_slice_w order by created_at asc))[1] as start_w,
       (array_agg(post_slice_w order by created_at desc))[1] as end_w,
       sum(applied_change) as applied_movement,
       sum(requested_change) as requested_movement,
       count(*) filter (where cap_limited) as cap_limited_count
from public.w_transitions w
where w.event_kind = 'calculation'
  and not exists (select 1 from public.w_transitions r where r.reversal_of = w.id)
group by owner_id, local_date;

create view public.daily_credit_summary with (security_invoker = true) as
select owner_id, (created_at at time zone 'Asia/Kolkata')::date as local_date,
       sum(formula_result) as total_credits, count(*) as credit_event_count
from public.credit_events c
where c.event_kind = 'calculation'
  and not exists (select 1 from public.credit_events r where r.reversal_of = c.id)
group by owner_id, local_date;

create view public.audit_timeline with (security_invoker = true) as
select * from public.audit_events order by created_at desc;

alter table public.members enable row level security;
alter table public.intake_sessions enable row level security;
alter table public.draft_slices enable row level security;
alter table public.canonical_slices enable row level security;
alter table public.observer_events enable row level security;
alter table public.validation_events enable row level security;
alter table public.wellbeing_baselines enable row level security;
alter table public.community_rate_versions enable row level security;
alter table public.replay_runs enable row level security;
alter table public.w_transitions enable row level security;
alter table public.credit_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.pilot_metrics enable row level security;

create policy own_membership on public.members for select using (id = auth.uid());
create policy own_intakes on public.intake_sessions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_drafts on public.draft_slices for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_canonical on public.canonical_slices for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_observer_events on public.observer_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and actor_id = auth.uid());
create policy own_validation_events on public.validation_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and signer_id = auth.uid());
create policy own_baselines on public.wellbeing_baselines for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_rates on public.community_rate_versions for all using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy own_replays on public.replay_runs for select using (owner_id = auth.uid());
create policy own_w_transitions on public.w_transitions for select using (owner_id = auth.uid());
create policy own_credit_events on public.credit_events for select using (owner_id = auth.uid());
create policy own_audit on public.audit_events for select using (owner_id = auth.uid());
create policy own_metrics on public.pilot_metrics for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke insert, update, delete on public.w_transitions, public.credit_events, public.replay_runs, public.audit_events from authenticated;
revoke insert, update, delete on public.canonical_slices, public.observer_events, public.validation_events from authenticated;
revoke all on public.ingestion_rate_limits from anon, authenticated;

create or replace function public.consume_ingestion_rate_limit(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.ingestion_rate_limits(bucket, request_count, window_started_at)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
    set request_count = public.ingestion_rate_limits.request_count + 1
  returning request_count into next_count;
  return next_count <= p_limit;
end;
$$;
revoke all on function public.consume_ingestion_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_ingestion_rate_limit(text, integer) to service_role;

create or replace function public.prevent_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append-only table';
end;
$$;

create trigger observer_events_append_only before update or delete on public.observer_events
for each row execute function public.prevent_event_mutation();
create trigger validation_events_append_only before update or delete on public.validation_events
for each row execute function public.prevent_event_mutation();
create trigger audit_events_append_only before update or delete on public.audit_events
for each row execute function public.prevent_event_mutation();
create trigger w_transitions_append_only before update or delete on public.w_transitions
for each row execute function public.prevent_event_mutation();
create trigger credit_events_append_only before update or delete on public.credit_events
for each row execute function public.prevent_event_mutation();
