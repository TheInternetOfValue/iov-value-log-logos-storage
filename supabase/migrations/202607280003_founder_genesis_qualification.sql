-- Additive Wellbeing Identity Genesis evidence and qualification ledger.
-- Existing founder baselines, state revisions, events and Legacy Pilot W remain immutable.

create table public.founder_genesis_identity_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  source_profile_reference text not null,
  source_profile_hash text not null check (source_profile_hash ~ '^[a-f0-9]{64}$'),
  protocol_version text not null,
  effective_at timestamptz not null,
  consent_state_reference text not null,
  consent_state jsonb not null,
  node_coverage jsonb not null check (jsonb_typeof(node_coverage) = 'array' and jsonb_array_length(node_coverage) = 8),
  private_evidence_references jsonb not null check (jsonb_typeof(private_evidence_references) = 'array'),
  public_safe_references jsonb not null check (jsonb_typeof(public_safe_references) = 'array'),
  created_at timestamptz not null default now()
);

create table public.founder_genesis_observation_windows (
  id uuid primary key default gen_random_uuid(),
  window_key text not null unique,
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  baseline_epoch_id uuid not null references public.founder_wellbeing_baseline_epochs(id),
  window_start date not null,
  window_end date not null check (window_end >= window_start),
  calendar_day_count integer not null check (calendar_day_count >= 14),
  eligible_day_count integer not null check (eligible_day_count >= 14 and eligible_day_count <= calendar_day_count),
  activity_count integer not null check (activity_count >= 1),
  recorded_minutes numeric(18,6) not null check (recorded_minutes >= 0),
  unknown_or_unlogged_minutes numeric(18,6) not null check (unknown_or_unlogged_minutes >= 0),
  component_coverage jsonb not null check (jsonb_typeof(component_coverage) = 'array' and jsonb_array_length(component_coverage) = 6),
  performance_route_coverage jsonb not null check (jsonb_typeof(performance_route_coverage) = 'array'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  provenance_reference text not null,
  frozen_at timestamptz not null default now()
);

create table public.founder_genesis_component_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  identity_snapshot_id uuid not null references public.founder_genesis_identity_snapshots(id),
  observation_window_id uuid not null references public.founder_genesis_observation_windows(id),
  component text not null check (component in ('Physiology', 'Emotion', 'Feeling', 'Thought', 'Habit', 'Performance')),
  relevant_identity_nodes jsonb not null check (jsonb_typeof(relevant_identity_nodes) = 'array'),
  evidence_references jsonb not null check (jsonb_typeof(evidence_references) = 'array'),
  current_component_value numeric(16,12) not null check (current_component_value between 100 and 1000),
  observed_activity_count integer not null check (observed_activity_count >= 0),
  observed_minutes numeric(18,6) not null check (observed_minutes >= 0),
  performance_route_coverage jsonb check (performance_route_coverage is null or jsonb_typeof(performance_route_coverage) = 'array'),
  suggested_min numeric(16,12) check (suggested_min is null or suggested_min between 100 and 1000),
  suggested_max numeric(16,12) check (suggested_max is null or suggested_max between 100 and 1000),
  suggested_range_rationale text,
  contradiction_status text not null check (contradiction_status in ('none', 'missing_evidence', 'material_contradiction')),
  contradictions jsonb not null default '[]'::jsonb check (jsonb_typeof(contradictions) = 'array'),
  subject_confirmed_value numeric(16,12) check (subject_confirmed_value is null or subject_confirmed_value between 100 and 1000),
  created_at timestamptz not null default now(),
  unique (observation_window_id, component),
  check ((suggested_min is null and suggested_max is null and suggested_range_rationale is null) or
    (suggested_min is not null and suggested_max is not null and suggested_min <= suggested_max and suggested_range_rationale is not null))
);

create table public.founder_genesis_baseline_reviews (
  id uuid primary key default gen_random_uuid(),
  review_key text not null unique,
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  baseline_epoch_id uuid not null references public.founder_wellbeing_baseline_epochs(id),
  identity_snapshot_id uuid not null references public.founder_genesis_identity_snapshots(id),
  observation_window_id uuid not null references public.founder_genesis_observation_windows(id),
  baseline_method_before text not null check (baseline_method_before = 'bootstrap_six_component_self_assessment_v0.1'),
  baseline_status_before text not null check (baseline_status_before = 'bootstrap'),
  baseline_method_after text not null check (baseline_method_after = 'identity_observation_genesis_v0.1'),
  baseline_status_after text not null check (baseline_status_after in ('genesis_ratified', 'reconciliation_required')),
  reviewer_validation_mode text not null check (reviewer_validation_mode in ('founder_self_review', 'independent_review')),
  decision text not null check (decision in ('ratify_unchanged', 'reconciliation_required', 'not_eligible')),
  component_change_proposed boolean not null,
  qualification_delta_w numeric(16,12) not null check (qualification_delta_w = 0),
  subject_confirmation_reference text,
  provenance jsonb not null check (jsonb_typeof(provenance) = 'array'),
  created_at timestamptz not null default now(),
  effective_at timestamptz not null,
  ratified_at timestamptz,
  unique (baseline_epoch_id)
);

create table public.founder_genesis_baseline_attestations (
  id uuid primary key default gen_random_uuid(),
  attestation_key text not null unique,
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  review_id uuid not null unique references public.founder_genesis_baseline_reviews(id),
  issuer_id text not null,
  policy_id text not null,
  policy_version text not null,
  baseline_epoch_id uuid not null references public.founder_wellbeing_baseline_epochs(id),
  baseline_method text not null check (baseline_method = 'identity_observation_genesis_v0.1'),
  baseline_status text not null check (baseline_status = 'genesis_ratified'),
  component_values jsonb not null check (jsonb_typeof(component_values) = 'object'),
  wellbeing_score numeric(16,12) not null check (wellbeing_score between 100 and 1000),
  validation_mode text not null check (validation_mode in ('founder_self_review', 'independent_review')),
  issued_at timestamptz not null
);

create table public.founder_genesis_baseline_qualifications (
  id uuid primary key default gen_random_uuid(),
  qualification_key text not null unique,
  owner_id uuid not null references public.members(id),
  subject_id text not null,
  baseline_epoch_id uuid not null unique references public.founder_wellbeing_baseline_epochs(id),
  review_id uuid not null unique references public.founder_genesis_baseline_reviews(id),
  attestation_id uuid not null unique references public.founder_genesis_baseline_attestations(id),
  replay_run_id uuid not null unique references public.founder_wellbeing_replay_runs(id),
  qualification_revision_id uuid not null unique references public.founder_wellbeing_state_revisions(id),
  baseline_method text not null check (baseline_method = 'identity_observation_genesis_v0.1'),
  baseline_status text not null check (baseline_status = 'genesis_ratified'),
  genesis_boundary_at timestamptz not null,
  original_created_at timestamptz not null,
  original_effective_at timestamptz not null,
  ratified_at timestamptz not null,
  pre_genesis_evidence_replayed boolean not null default false check (pre_genesis_evidence_replayed = false),
  qualification_delta_w numeric(16,12) not null default 0 check (qualification_delta_w = 0),
  created_at timestamptz not null default now()
);

alter table public.founder_wellbeing_state_revisions
  add column if not exists genesis_qualification_id uuid,
  drop constraint if exists founder_wellbeing_state_revisions_revision_kind_check;

alter table public.founder_wellbeing_state_revisions
  add constraint founder_wellbeing_state_revisions_revision_kind_check
  check (revision_kind in ('baseline', 'component_transition', 'baseline_qualification'));

create unique index founder_wellbeing_revision_genesis_qualification_idx
on public.founder_wellbeing_state_revisions(genesis_qualification_id)
where genesis_qualification_id is not null;

create view public.current_founder_genesis_status as
select distinct on (q.owner_id)
  q.owner_id, q.subject_id, q.baseline_epoch_id, q.baseline_method, q.baseline_status,
  q.genesis_boundary_at, q.original_created_at, q.original_effective_at, q.ratified_at,
  q.pre_genesis_evidence_replayed, q.qualification_delta_w,
  s.snapshot_key, o.window_key, o.window_start, o.window_end, o.eligible_day_count,
  o.activity_count, o.recorded_minutes, o.component_coverage, o.performance_route_coverage,
  a.issuer_id, a.policy_id, a.policy_version, a.attestation_key, q.created_at
from public.founder_genesis_baseline_qualifications q
join public.founder_genesis_baseline_reviews r on r.id = q.review_id
join public.founder_genesis_identity_snapshots s on s.id = r.identity_snapshot_id
join public.founder_genesis_observation_windows o on o.id = r.observation_window_id
join public.founder_genesis_baseline_attestations a on a.id = q.attestation_id
order by q.owner_id, q.ratified_at desc;

alter table public.founder_genesis_identity_snapshots enable row level security;
alter table public.founder_genesis_observation_windows enable row level security;
alter table public.founder_genesis_component_evidence enable row level security;
alter table public.founder_genesis_baseline_reviews enable row level security;
alter table public.founder_genesis_baseline_attestations enable row level security;
alter table public.founder_genesis_baseline_qualifications enable row level security;

create policy own_founder_genesis_snapshots on public.founder_genesis_identity_snapshots for select using (owner_id = auth.uid());
create policy own_founder_genesis_windows on public.founder_genesis_observation_windows for select using (owner_id = auth.uid());
create policy own_founder_genesis_components on public.founder_genesis_component_evidence for select using (owner_id = auth.uid());
create policy own_founder_genesis_reviews on public.founder_genesis_baseline_reviews for select using (owner_id = auth.uid());
create policy own_founder_genesis_attestations on public.founder_genesis_baseline_attestations for select using (owner_id = auth.uid());
create policy own_founder_genesis_qualifications on public.founder_genesis_baseline_qualifications for select using (owner_id = auth.uid());

grant select on public.founder_genesis_identity_snapshots, public.founder_genesis_observation_windows,
  public.founder_genesis_component_evidence, public.founder_genesis_baseline_reviews,
  public.founder_genesis_baseline_attestations, public.founder_genesis_baseline_qualifications,
  public.current_founder_genesis_status to authenticated;
grant all on public.founder_genesis_identity_snapshots, public.founder_genesis_observation_windows,
  public.founder_genesis_component_evidence, public.founder_genesis_baseline_reviews,
  public.founder_genesis_baseline_attestations, public.founder_genesis_baseline_qualifications to service_role;
grant select on public.current_founder_genesis_status to service_role;

create trigger founder_genesis_snapshots_append_only before update or delete on public.founder_genesis_identity_snapshots for each row execute function public.prevent_event_mutation();
create trigger founder_genesis_windows_append_only before update or delete on public.founder_genesis_observation_windows for each row execute function public.prevent_event_mutation();
create trigger founder_genesis_components_append_only before update or delete on public.founder_genesis_component_evidence for each row execute function public.prevent_event_mutation();
create trigger founder_genesis_reviews_append_only before update or delete on public.founder_genesis_baseline_reviews for each row execute function public.prevent_event_mutation();
create trigger founder_genesis_attestations_append_only before update or delete on public.founder_genesis_baseline_attestations for each row execute function public.prevent_event_mutation();
create trigger founder_genesis_qualifications_append_only before update or delete on public.founder_genesis_baseline_qualifications for each row execute function public.prevent_event_mutation();
