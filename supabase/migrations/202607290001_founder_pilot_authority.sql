-- Founder-pilot authority becomes explicit only from this migration onward.
-- Historical validation events remain untouched and are not replayed or recalculated.

create table if not exists public.founder_pilot_appointments (
  id uuid primary key,
  identity_ref text not null,
  entity_id public.community_code not null,
  role public.validation_role not null,
  review_mode text not null check (review_mode in ('founder_self_review', 'founder_self_review_provisional')),
  settlement_authority boolean not null,
  subject_scope text not null check (subject_scope = 'self'),
  scopes text[] not null,
  status text not null check (status in ('active', 'inactive')),
  valid_from timestamptz not null default now(),
  registry_version text not null,
  created_at timestamptz not null default now(),
  unique (identity_ref, entity_id, role)
);

alter table public.founder_pilot_appointments enable row level security;
revoke all on public.founder_pilot_appointments from anon, authenticated;

insert into public.founder_pilot_appointments
  (id, identity_ref, entity_id, role, review_mode, settlement_authority, subject_scope, scopes, status, registry_version)
values
  ('8b9234e6-3aa5-4ccc-b9bc-fedd665836cc', 'did:iov:member:10000000-0000-4000-8000-000000000001', 'house_of_bros', 'house_of_bros_validator', 'founder_self_review', true, 'self', array['non_performance_review','node:Physiology','node:Emotion','node:Feeling','node:Thought','node:Habit','performance_impact_review'], 'active', '0.1.0'),
  ('40febfb3-5b00-4740-bdc3-e631b67cdb16', 'did:iov:member:10000000-0000-4000-8000-000000000001', 'iov', 'iov_validator', 'founder_self_review', true, 'self', array['performance_source_review'], 'active', '0.1.0'),
  ('a8c9e734-1700-4657-ac80-43a0bda00ca4', 'did:iov:member:10000000-0000-4000-8000-000000000001', 'gfe', 'gfe_validator', 'founder_self_review_provisional', false, 'self', array['performance_source_review'], 'active', '0.1.0')
on conflict (id) do nothing;

alter table public.validation_events
  add column if not exists appointment_id uuid references public.founder_pilot_appointments(id),
  add column if not exists entity_id public.community_code,
  add column if not exists review_mode text check (review_mode in ('founder_self_review', 'founder_self_review_provisional')),
  add column if not exists registry_version text,
  add column if not exists validated_at timestamptz;

alter table public.canonical_slices
  add column if not exists founder_performance_impact_status text
    check (founder_performance_impact_status is null or founder_performance_impact_status in ('applied', 'no_transition', 'pending'));

alter table public.founder_wellbeing_value_events
  add column if not exists performance_impact_status text
    check (performance_impact_status is null or performance_impact_status in ('applied', 'no_transition'));

alter table public.validation_events drop constraint if exists validation_events_decision_check;
alter table public.validation_events add constraint validation_events_decision_check
  check (decision in ('validated', 'rejected', 'provisional'));

create unique index if not exists validation_events_slice_appointment_unique
  on public.validation_events (canonical_slice_id, appointment_id)
  where appointment_id is not null;
