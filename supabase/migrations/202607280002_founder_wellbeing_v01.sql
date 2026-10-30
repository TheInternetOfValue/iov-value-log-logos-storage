-- Additive founder WellbeingScore v0.1 ledger. Legacy Pilot W tables and rows
-- remain unchanged and continue to replay under wim-legacy-v1.

alter table public.draft_slices
  add column if not exists activity_occurrence_id text,
  add column if not exists source_attestation_id text,
  add column if not exists founder_task_id text,
  add column if not exists native_skill_level text,
  add column if not exists founder_performance_impact text
    check (founder_performance_impact is null or founder_performance_impact in ('low', 'medium', 'high')),
  add column if not exists founder_vcom_rate numeric(18,6)
    check (founder_vcom_rate is null or founder_vcom_rate >= 0),
  add column if not exists founder_vcom_unit text,
  add column if not exists founder_validation_mode text;

alter table public.canonical_slices
  add column if not exists activity_occurrence_id text,
  add column if not exists source_attestation_id text,
  add column if not exists founder_task_id text,
  add column if not exists native_skill_level text,
  add column if not exists founder_performance_impact text
    check (founder_performance_impact is null or founder_performance_impact in ('low', 'medium', 'high')),
  add column if not exists founder_vcom_rate numeric(18,6)
    check (founder_vcom_rate is null or founder_vcom_rate >= 0),
  add column if not exists founder_vcom_unit text,
  add column if not exists founder_validation_mode text;

alter table public.draft_slices drop constraint if exists draft_route_contract;
alter table public.draft_slices add constraint draft_route_contract check (
  (slice_type = 'performance' and wellbeing_node = 'Performance' and community in ('iov', 'gfe') and sao_lane is not null and (skill_level is not null or native_skill_level is not null))
  or
  (slice_type = 'non_performance' and wellbeing_node <> 'Performance' and community = 'house_of_bros' and impact_direction is not null and impact_intensity is not null and confidence is not null)
);

create index if not exists canonical_slices_founder_occurrence_idx
on public.canonical_slices(owner_id, activity_occurrence_id, start_at);

create table public.founder_wellbeing_baseline_epochs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  epoch_kind text not null check (epoch_kind in ('bootstrap', 'calibration')),
  method text not null,
  validation_mode text not null check (validation_mode = 'founder_self_review'),
  physiology numeric(16,12) not null check (physiology between 100 and 1000),
  emotion numeric(16,12) not null check (emotion between 100 and 1000),
  feeling numeric(16,12) not null check (feeling between 100 and 1000),
  thought numeric(16,12) not null check (thought between 100 and 1000),
  habit numeric(16,12) not null check (habit between 100 and 1000),
  performance numeric(16,12) not null check (performance between 100 and 1000),
  wellbeing_score numeric(16,12) not null check (wellbeing_score between 100 and 1000),
  rollups jsonb not null,
  policy_id text not null,
  policy_version text not null,
  policy_content_hash text not null check (policy_content_hash ~ '^[a-f0-9]{64}$'),
  calculation_version text not null,
  effective_at timestamptz not null,
  supersedes_epoch_id uuid references public.founder_wellbeing_baseline_epochs(id),
  created_at timestamptz not null default now(),
  unique (owner_id, effective_at)
);

create table public.founder_wellbeing_replay_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  baseline_epoch_id uuid not null references public.founder_wellbeing_baseline_epochs(id),
  mode text not null check (mode in ('founder_v0_1_preview', 'founder_v0_1_live')),
  reason text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_message text,
  event_count integer not null default 0
);

create table public.founder_wellbeing_state_revisions (
  id uuid primary key default gen_random_uuid(),
  replay_run_id uuid not null references public.founder_wellbeing_replay_runs(id),
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  baseline_epoch_id uuid not null references public.founder_wellbeing_baseline_epochs(id),
  sequence_number integer not null check (sequence_number >= 0),
  effective_at timestamptz not null,
  activity_occurrence_id text,
  source_attestation_id text,
  revision_kind text not null check (revision_kind in ('baseline', 'component_transition')),
  component text check (component is null or component in ('Physiology', 'Emotion', 'Feeling', 'Thought', 'Habit', 'Performance')),
  component_before numeric(16,12),
  component_after numeric(16,12),
  physiology numeric(16,12) not null check (physiology between 100 and 1000),
  emotion numeric(16,12) not null check (emotion between 100 and 1000),
  feeling numeric(16,12) not null check (feeling between 100 and 1000),
  thought numeric(16,12) not null check (thought between 100 and 1000),
  habit numeric(16,12) not null check (habit between 100 and 1000),
  performance numeric(16,12) not null check (performance between 100 and 1000),
  w_before numeric(16,12) not null check (w_before between 100 and 1000),
  w_after numeric(16,12) not null check (w_after between 100 and 1000),
  delta_w numeric(16,12) not null,
  transition jsonb,
  policy_id text not null,
  policy_version text not null,
  policy_content_hash text not null check (policy_content_hash ~ '^[a-f0-9]{64}$'),
  calculation_version text not null,
  validation_mode text not null,
  created_at timestamptz not null default now(),
  unique (replay_run_id, sequence_number),
  unique (replay_run_id, activity_occurrence_id)
);

create table public.founder_wellbeing_value_events (
  id uuid primary key default gen_random_uuid(),
  replay_run_id uuid not null references public.founder_wellbeing_replay_runs(id),
  owner_id uuid not null references public.members(id),
  canonical_slice_id uuid references public.canonical_slices(id),
  activity_occurrence_id text not null,
  source_attestation_id text,
  performance_transition_key text,
  event_kind text not null check (event_kind in ('performance', 'nonperformance')),
  source_community text not null,
  task_id text,
  evidence_ref text,
  route text,
  native_skill_level text,
  validated_duration_minutes numeric(18,6) not null check (validated_duration_minutes >= 0),
  rate numeric(18,6),
  vcom_amount numeric(24,12),
  vcom_unit text,
  vcom_scope text check (vcom_scope is null or vcom_scope = 'event'),
  vcom_semantics text not null,
  settlement_status text not null check (settlement_status in ('settled', 'provisional')),
  vcperformance numeric(24,12),
  vcnonperformance numeric(16,12),
  w_before numeric(16,12) not null,
  w_after numeric(16,12) not null,
  delta_w numeric(16,12) not null,
  performance_impact text check (performance_impact is null or performance_impact in ('low', 'medium', 'high')),
  policy_id text not null,
  policy_version text not null,
  policy_content_hash text not null check (policy_content_hash ~ '^[a-f0-9]{64}$'),
  validation_mode text not null,
  calculation_version text not null,
  created_at timestamptz not null default now(),
  unique (replay_run_id, activity_occurrence_id),
  unique (replay_run_id, performance_transition_key)
);

create index founder_wellbeing_baselines_owner_idx
on public.founder_wellbeing_baseline_epochs(owner_id, effective_at desc);
create index founder_wellbeing_revisions_owner_idx
on public.founder_wellbeing_state_revisions(owner_id, effective_at, sequence_number);
create index founder_wellbeing_values_owner_idx
on public.founder_wellbeing_value_events(owner_id, created_at);

create view public.current_founder_wellbeing_state as
select distinct on (revision.owner_id, run.mode)
  revision.*, run.mode, run.completed_at
from public.founder_wellbeing_state_revisions revision
join public.founder_wellbeing_replay_runs run on run.id = revision.replay_run_id
where run.status = 'completed'
order by revision.owner_id, run.mode, run.completed_at desc, revision.sequence_number desc;

alter table public.founder_wellbeing_baseline_epochs enable row level security;
alter table public.founder_wellbeing_replay_runs enable row level security;
alter table public.founder_wellbeing_state_revisions enable row level security;
alter table public.founder_wellbeing_value_events enable row level security;

create policy own_founder_baselines on public.founder_wellbeing_baseline_epochs
for select using (owner_id = auth.uid());
create policy own_founder_replays on public.founder_wellbeing_replay_runs
for select using (owner_id = auth.uid());
create policy own_founder_revisions on public.founder_wellbeing_state_revisions
for select using (owner_id = auth.uid());
create policy own_founder_values on public.founder_wellbeing_value_events
for select using (owner_id = auth.uid());

grant select on public.founder_wellbeing_baseline_epochs, public.founder_wellbeing_replay_runs,
  public.founder_wellbeing_state_revisions, public.founder_wellbeing_value_events,
  public.current_founder_wellbeing_state to authenticated;
grant all on public.founder_wellbeing_baseline_epochs, public.founder_wellbeing_replay_runs,
  public.founder_wellbeing_state_revisions, public.founder_wellbeing_value_events to service_role;

create trigger founder_baselines_append_only before update or delete on public.founder_wellbeing_baseline_epochs
for each row execute function public.prevent_event_mutation();
create trigger founder_revisions_append_only before update or delete on public.founder_wellbeing_state_revisions
for each row execute function public.prevent_event_mutation();
create trigger founder_value_events_append_only before update or delete on public.founder_wellbeing_value_events
for each row execute function public.prevent_event_mutation();
