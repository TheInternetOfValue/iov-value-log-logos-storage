-- Bitemporal Flat Community Rate Policies and verified replay promotion.
-- This migration is additive. Historical policies, authorities, replay runs,
-- calculations, nulls, and projections remain intact.

create type public.founder_rate_null_reason as enum (
  'not_applicable_nonperformance',
  'pre_genesis',
  'unsupported_community',
  'missing_route',
  'no_policy_at_valid_time',
  'policy_not_recorded_as_of_system_time',
  'authority_not_final',
  'ambiguous_policy'
);

create type public.founder_vcom_null_reason as enum (
  'not_applicable_nonperformance',
  'community_rate_unresolved',
  'duration_unavailable_or_invalid'
);

create type public.founder_vcperformance_null_reason as enum (
  'not_applicable_nonperformance',
  'vcom_unresolved',
  'wbefore_unavailable'
);

create table public.founder_flat_rate_authority_versions (
  id uuid primary key,
  subject_did text not null,
  community public.community_code not null check (community in ('iov', 'gfe')),
  native_level text not null,
  routes public.sao_lane[] not null check (cardinality(routes) > 0),
  authority_kind text not null check (authority_kind = 'self_ratified'),
  self_ratified_actor_did text not null,
  subject_scope text not null check (subject_scope = 'moses_only'),
  finality_authority boolean not null,
  external_validation_claimed boolean not null default false,
  valid_from timestamptz not null,
  valid_to timestamptz,
  source_ratified_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  supersedes_id uuid references public.founder_flat_rate_authority_versions(id),
  supersedes_appointment_id uuid references public.founder_pilot_appointments(id),
  authority_version text not null,
  canonical_content_hash text not null check (canonical_content_hash ~ '^[a-f0-9]{64}$'),
  check (valid_to is null or valid_to > valid_from),
  check (self_ratified_actor_did = subject_did),
  check (external_validation_claimed = false)
);

create table public.founder_flat_community_rate_policy_versions (
  id uuid primary key,
  subject_did text not null,
  community public.community_code not null check (community in ('iov', 'gfe')),
  native_level text not null,
  routes public.sao_lane[] not null check (cardinality(routes) > 0),
  subject_scope text not null check (subject_scope = 'moses_only'),
  community_rate_amount numeric(30,12) not null check (community_rate_amount >= 0),
  community_rate_unit text not null check (community_rate_unit = 'USD_per_hour'),
  authority_version_id uuid not null references public.founder_flat_rate_authority_versions(id),
  valid_from timestamptz not null,
  valid_to timestamptz,
  source_ratified_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  supersedes_id uuid references public.founder_flat_community_rate_policy_versions(id),
  supersedes_external_ref text,
  policy_version text not null,
  canonical_content_hash text not null check (canonical_content_hash ~ '^[a-f0-9]{64}$'),
  check (valid_to is null or valid_to > valid_from)
);

create index founder_flat_authority_bitemporal_idx
  on public.founder_flat_rate_authority_versions(subject_did, community, valid_from, recorded_at);
create index founder_flat_rate_bitemporal_idx
  on public.founder_flat_community_rate_policy_versions(subject_did, community, valid_from, recorded_at);

create trigger founder_flat_authority_append_only before update or delete
  on public.founder_flat_rate_authority_versions
  for each row execute function public.prevent_event_mutation();
create trigger founder_flat_rate_policy_append_only before update or delete
  on public.founder_flat_community_rate_policy_versions
  for each row execute function public.prevent_event_mutation();

alter table public.founder_flat_rate_authority_versions enable row level security;
alter table public.founder_flat_community_rate_policy_versions enable row level security;
revoke all on public.founder_flat_rate_authority_versions from anon, authenticated;
revoke all on public.founder_flat_community_rate_policy_versions from anon, authenticated;
grant select, insert on public.founder_flat_rate_authority_versions to service_role;
grant select, insert on public.founder_flat_community_rate_policy_versions to service_role;

insert into public.founder_flat_rate_authority_versions (
  id, subject_did, community, native_level, routes, authority_kind,
  self_ratified_actor_did, subject_scope, finality_authority,
  external_validation_claimed, valid_from, source_ratified_at, supersedes_appointment_id,
  authority_version, canonical_content_hash
)
values
  (
    '15ffb2cc-7079-4c64-b17f-ae682f76b121',
    'did:iov:member:10000000-0000-4000-8000-000000000001',
    'iov', 'SM3', array['Learning','Earning','OrgBuilding']::public.sao_lane[],
    'self_ratified', 'did:iov:member:10000000-0000-4000-8000-000000000001',
    'moses_only', true, false, '2026-07-28T11:11:34.890018Z', '2026-07-31T07:04:42.020Z',
    '40febfb3-5b00-4740-bdc3-e631b67cdb16', '1.0.0',
    'b8437ad45a468b4c710e1a90e92ab0b04ef49e6b4fd0c41e84c2b1f79a993e5b'
  ),
  (
    '1ca67f1f-7ea2-48dc-91f7-fd61598419a2',
    'did:iov:member:10000000-0000-4000-8000-000000000001',
    'gfe', 'GFE-3.3.3', array['Learning','Earning','OrgBuilding']::public.sao_lane[],
    'self_ratified', 'did:iov:member:10000000-0000-4000-8000-000000000001',
    'moses_only', true, false, '2026-07-28T11:11:34.890018Z', '2026-07-31T07:04:42.020Z',
    'a8c9e734-1700-4657-ac80-43a0bda00ca4', '1.0.0',
    '6d7a0814920d85937c74e359d954c045395a57e73be5f8a17246ab4a60273532'
  );

insert into public.founder_flat_community_rate_policy_versions (
  id, subject_did, community, native_level, routes, subject_scope,
  community_rate_amount, community_rate_unit, authority_version_id,
  valid_from, source_ratified_at, supersedes_external_ref, policy_version, canonical_content_hash
)
values
  (
    '4b9fa38c-d83b-493a-83d2-61b14e257acc',
    'did:iov:member:10000000-0000-4000-8000-000000000001',
    'iov', 'SM3', array['Learning','Earning','OrgBuilding']::public.sao_lane[],
    'moses_only', 750.000000000000, 'USD_per_hour',
    '15ffb2cc-7079-4c64-b17f-ae682f76b121',
    '2026-07-28T11:11:34.890018Z', '2026-07-31T07:04:42.020Z',
    'iov-sm-protocol-architecture-v0.1:unused-USD-7500-per-hour-fixture',
    '1.0.0',
    '75e9bf1c9c6b99466ec3ff09d03ae40135e1290512d816a6d0ea2af8acb116d8'
  ),
  (
    'c694b57d-c5cd-4d75-be0f-157987dc742c',
    'did:iov:member:10000000-0000-4000-8000-000000000001',
    'gfe', 'GFE-3.3.3', array['Learning','Earning','OrgBuilding']::public.sao_lane[],
    'moses_only', 500.000000000000, 'USD_per_hour',
    '1ca67f1f-7ea2-48dc-91f7-fd61598419a2',
    '2026-07-28T11:11:34.890018Z', '2026-07-31T07:04:42.020Z',
    'GFE-SkillSystem:founder-self-review-provisional-only-rule',
    '1.0.0',
    '3d93b60bd02380e2b4284da024bfc538e2b153a10cb50919c8f139fa0ec52e12'
  );

create or replace function public.founder_occurrence_is_post_genesis(
  p_owner_id uuid,
  p_occurrence_start_at timestamptz
) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    p_occurrence_start_at > (
      select effective_at
      from public.founder_wellbeing_baseline_epochs
      where owner_id = p_owner_id
      order by effective_at desc
      limit 1
    ),
    false
  );
$$;

create or replace view public.founder_replay_eligible_slices
with (security_invoker = true) as
select slice.*
from public.current_time_slices slice
where public.founder_occurrence_is_post_genesis(slice.owner_id, slice.start_at);

create or replace function public.resolve_founder_flat_community_rate(
  p_subject_did text,
  p_community public.community_code,
  p_route public.sao_lane,
  p_occurrence_start_at timestamptz,
  p_system_time timestamptz
) returns table (
  policy_id uuid,
  authority_version_id uuid,
  community_rate_amount text,
  community_rate_unit text,
  native_level text,
  policy_content_hash text,
  authority_content_hash text,
  protocol_finality_status text,
  payability_status text,
  finalized_at timestamptz,
  rate_null_reason public.founder_rate_null_reason
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_genesis constant timestamptz := '2026-07-28T11:11:34.890018Z';
  v_count integer;
begin
  if p_occurrence_start_at <= v_genesis then
    return query select null::uuid, null::uuid, null::text, null::text, null::text,
      null::text, null::text, null::text, 'non_payable'::text, null::timestamptz,
      'pre_genesis'::public.founder_rate_null_reason;
    return;
  end if;
  if p_community not in ('iov', 'gfe') then
    return query select null::uuid, null::uuid, null::text, null::text, null::text,
      null::text, null::text, null::text, 'non_payable'::text, null::timestamptz,
      'unsupported_community'::public.founder_rate_null_reason;
    return;
  end if;
  if p_route is null then
    return query select null::uuid, null::uuid, null::text, null::text, null::text,
      null::text, null::text, null::text, 'non_payable'::text, null::timestamptz,
      'missing_route'::public.founder_rate_null_reason;
    return;
  end if;
  if exists (
    select 1 from public.founder_flat_community_rate_policy_versions p
    where p.subject_did = p_subject_did and p.community = p_community
      and p_occurrence_start_at >= p.valid_from
      and (p.valid_to is null or p_occurrence_start_at < p.valid_to)
      and p.recorded_at > p_system_time
  ) and not exists (
    select 1 from public.founder_flat_community_rate_policy_versions p
    where p.subject_did = p_subject_did and p.community = p_community
      and p_occurrence_start_at >= p.valid_from
      and (p.valid_to is null or p_occurrence_start_at < p.valid_to)
      and p.recorded_at <= p_system_time
  ) then
    return query select null::uuid, null::uuid, null::text, null::text, null::text,
      null::text, null::text, null::text, 'non_payable'::text, null::timestamptz,
      'policy_not_recorded_as_of_system_time'::public.founder_rate_null_reason;
    return;
  end if;

  select count(*) into v_count
  from public.founder_flat_community_rate_policy_versions p
  join public.founder_flat_rate_authority_versions a on a.id = p.authority_version_id
  where p.subject_did = p_subject_did and p.community = p_community
    and p_route = any(p.routes)
    and p_occurrence_start_at >= p.valid_from
    and (p.valid_to is null or p_occurrence_start_at < p.valid_to)
    and p.recorded_at <= p_system_time and a.recorded_at <= p_system_time
    and a.finality_authority = true
    and not exists (
      select 1 from public.founder_flat_community_rate_policy_versions successor
      where successor.supersedes_id = p.id and successor.recorded_at <= p_system_time
    )
    and not exists (
      select 1 from public.founder_flat_rate_authority_versions successor
      where successor.supersedes_id = a.id and successor.recorded_at <= p_system_time
    );

  if v_count = 0 then
    if exists (
      select 1 from public.founder_flat_community_rate_policy_versions p
      join public.founder_flat_rate_authority_versions a on a.id = p.authority_version_id
      where p.subject_did = p_subject_did and p.community = p_community
        and p_route = any(p.routes)
        and p_occurrence_start_at >= p.valid_from
        and (p.valid_to is null or p_occurrence_start_at < p.valid_to)
        and p.recorded_at <= p_system_time and a.recorded_at <= p_system_time
        and a.finality_authority = false
        and not exists (
          select 1 from public.founder_flat_rate_authority_versions successor
          where successor.supersedes_id = a.id and successor.recorded_at <= p_system_time
        )
    ) then
      return query select null::uuid, null::uuid, null::text, null::text, null::text,
        null::text, null::text, 'provisional'::text, 'non_payable'::text, null::timestamptz,
        'authority_not_final'::public.founder_rate_null_reason;
    else
      return query select null::uuid, null::uuid, null::text, null::text, null::text,
        null::text, null::text, null::text, 'non_payable'::text, null::timestamptz,
        'no_policy_at_valid_time'::public.founder_rate_null_reason;
    end if;
    return;
  end if;
  if v_count > 1 then
    return query select null::uuid, null::uuid, null::text, null::text, null::text,
      null::text, null::text, null::text, 'non_payable'::text, null::timestamptz,
      'ambiguous_policy'::public.founder_rate_null_reason;
    return;
  end if;

  return query
  select p.id, a.id, p.community_rate_amount::text, p.community_rate_unit,
    p.native_level, p.canonical_content_hash, a.canonical_content_hash,
    case when a.finality_authority then 'final' else 'provisional' end,
    'non_payable'::text, greatest(p.source_ratified_at, a.source_ratified_at),
    null::public.founder_rate_null_reason
  from public.founder_flat_community_rate_policy_versions p
  join public.founder_flat_rate_authority_versions a on a.id = p.authority_version_id
  where p.subject_did = p_subject_did and p.community = p_community
    and p_route = any(p.routes)
    and p_occurrence_start_at >= p.valid_from
    and (p.valid_to is null or p_occurrence_start_at < p.valid_to)
    and p.recorded_at <= p_system_time and a.recorded_at <= p_system_time
    and a.finality_authority = true
    and not exists (
      select 1 from public.founder_flat_community_rate_policy_versions successor
      where successor.supersedes_id = p.id and successor.recorded_at <= p_system_time
    )
    and not exists (
      select 1 from public.founder_flat_rate_authority_versions successor
      where successor.supersedes_id = a.id and successor.recorded_at <= p_system_time
    );
end;
$$;

create or replace function public.founder_round_half_even(
  p_value numeric,
  p_scale integer default 12
) returns numeric
language plpgsql immutable strict set search_path = public
as $$
declare
  v_factor numeric := power(10::numeric, p_scale);
  v_shifted numeric := p_value * v_factor;
  v_truncated numeric := trunc(v_shifted);
  v_fraction numeric := abs(v_shifted - v_truncated);
  v_direction integer := case when v_shifted < 0 then -1 else 1 end;
begin
  if v_fraction < 0.5 then
    return v_truncated / v_factor;
  elsif v_fraction > 0.5 then
    return (v_truncated + v_direction) / v_factor;
  elsif mod(abs(v_truncated), 2) = 0 then
    return v_truncated / v_factor;
  else
    return (v_truncated + v_direction) / v_factor;
  end if;
end;
$$;

create or replace function public.calculate_founder_performance_fixed12(
  p_community_rate numeric,
  p_validated_duration_microseconds bigint,
  p_wbefore numeric
) returns table (
  validated_duration_hours text,
  vcom_event_amount text,
  vcperformance_event_amount text
)
language sql immutable strict set search_path = public
as $$
  with exact as (
    select
      public.founder_round_half_even(p_validated_duration_microseconds::numeric / 3600000000::numeric, 12) as hours,
      public.founder_round_half_even(p_wbefore / 1000::numeric, 12) as normalized_w
  ), valued as (
    select hours, normalized_w,
      public.founder_round_half_even(p_community_rate * hours, 12) as vcom
    from exact
  )
  select
    to_char(hours, 'FM999999999999999999990.000000000000'),
    to_char(vcom, 'FM999999999999999999990.000000000000'),
    to_char(public.founder_round_half_even(normalized_w * vcom, 12), 'FM999999999999999999990.000000000000')
  from valued;
$$;

revoke all on function public.founder_occurrence_is_post_genesis(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_founder_flat_community_rate(text, public.community_code, public.sao_lane, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.founder_round_half_even(numeric, integer) from public, anon, authenticated;
revoke all on function public.calculate_founder_performance_fixed12(numeric, bigint, numeric) from public, anon, authenticated;
grant execute on function public.founder_occurrence_is_post_genesis(uuid, timestamptz) to service_role;
grant execute on function public.resolve_founder_flat_community_rate(text, public.community_code, public.sao_lane, timestamptz, timestamptz) to service_role;
grant execute on function public.founder_round_half_even(numeric, integer) to service_role;
grant execute on function public.calculate_founder_performance_fixed12(numeric, bigint, numeric) to service_role;
grant select on public.founder_replay_eligible_slices to service_role;

alter table public.founder_wellbeing_replay_runs
  add column if not exists input_cutoff_at timestamptz,
  add column if not exists system_time_as_of timestamptz not null default clock_timestamp();

alter table public.founder_wellbeing_value_events
  add column if not exists validated_duration_microseconds bigint,
  add column if not exists validated_duration_hours numeric(30,12),
  add column if not exists community_rate_policy_id uuid references public.founder_flat_community_rate_policy_versions(id),
  add column if not exists finality_authority_version_id uuid references public.founder_flat_rate_authority_versions(id),
  add column if not exists community_rate_amount numeric(30,12),
  add column if not exists community_rate_unit text,
  add column if not exists community_rate_null_reason public.founder_rate_null_reason,
  add column if not exists vcom_event_amount numeric(30,12),
  add column if not exists vcom_event_unit text,
  add column if not exists vcom_event_null_reason public.founder_vcom_null_reason,
  add column if not exists vcperformance_event_amount numeric(30,12),
  add column if not exists vcperformance_event_unit text,
  add column if not exists vcperformance_event_null_reason public.founder_vcperformance_null_reason,
  add column if not exists protocol_finality_status text
    check (protocol_finality_status is null or protocol_finality_status in ('provisional', 'final')),
  add column if not exists payability_status text not null default 'non_payable'
    check (payability_status = 'non_payable'),
  add column if not exists finalized_at timestamptz,
  add constraint founder_fixed12_duration_required check (
    calculation_version <> 'founder-wellbeing-v0.1.1-fixed12'
    or (
      validated_duration_microseconds is not null
      and validated_duration_microseconds > 0
      and validated_duration_hours is not null
      and validated_duration_hours > 0
    )
  ) not valid,
  add constraint founder_rate_value_or_reason check (
    (community_rate_amount is not null and community_rate_unit = 'USD_per_hour' and community_rate_null_reason is null)
    or (community_rate_amount is null and community_rate_unit is null and community_rate_null_reason is not null)
  ) not valid,
  add constraint founder_vcom_value_or_reason check (
    (vcom_event_amount is not null and vcom_event_unit is not null and vcom_event_null_reason is null)
    or (vcom_event_amount is null and vcom_event_unit is null and vcom_event_null_reason is not null)
  ) not valid,
  add constraint founder_vcperformance_value_or_reason check (
    (vcperformance_event_amount is not null and vcperformance_event_unit is not null and vcperformance_event_null_reason is null)
    or (vcperformance_event_amount is null and vcperformance_event_unit is null and vcperformance_event_null_reason is not null)
  ) not valid,
  add constraint founder_finality_is_non_payable check (
    protocol_finality_status <> 'final'
    or (payability_status = 'non_payable' and finalized_at is not null and finality_authority_version_id is not null)
  ) not valid;

create table public.founder_wellbeing_replay_verifications (
  id uuid primary key default gen_random_uuid(),
  replay_run_id uuid not null unique references public.founder_wellbeing_replay_runs(id),
  owner_id uuid not null references public.members(id),
  verified_at timestamptz not null default clock_timestamp(),
  verifier_identity text not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  output_hash text not null check (output_hash ~ '^[a-f0-9]{64}$'),
  input_cutoff_at timestamptz not null,
  baseline_epoch_id uuid not null references public.founder_wellbeing_baseline_epochs(id),
  policy_hashes text[] not null,
  authority_hashes text[] not null,
  calculation_version text not null,
  invariant_results jsonb not null,
  null_reason_complete boolean not null,
  event_count integer not null check (event_count >= 0),
  revision_count integer not null check (revision_count >= 1),
  passed boolean not null,
  failure_reasons text[] not null default '{}'
);

create table public.founder_wellbeing_replay_promotions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  mode text not null check (mode in ('founder_v0_1_preview', 'founder_v0_1_live')),
  replay_run_id uuid not null references public.founder_wellbeing_replay_runs(id),
  verification_id uuid not null references public.founder_wellbeing_replay_verifications(id),
  promoted_at timestamptz not null default clock_timestamp(),
  promoted_by text not null,
  reason text not null,
  supersedes_promotion_id uuid references public.founder_wellbeing_replay_promotions(id),
  unique (replay_run_id)
);

create or replace function public.enforce_founder_replay_promotion()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1
    from public.founder_wellbeing_replay_verifications verification
    join public.founder_wellbeing_replay_runs run on run.id = verification.replay_run_id
    where verification.id = new.verification_id
      and verification.replay_run_id = new.replay_run_id
      and verification.owner_id = new.owner_id
      and verification.passed = true
      and verification.null_reason_complete = true
      and run.status = 'completed'
      and run.owner_id = new.owner_id
      and run.mode = new.mode
  ) then
    raise exception 'FOUNDER_REPLAY_PROMOTION_REQUIRES_PASSING_VERIFICATION';
  end if;
  if exists (
    select 1 from public.founder_wellbeing_replay_promotions current
    where current.owner_id = new.owner_id and current.mode = new.mode
      and not exists (
        select 1 from public.founder_wellbeing_replay_promotions successor
        where successor.supersedes_promotion_id = current.id
      )
      and new.supersedes_promotion_id is distinct from current.id
  ) then
    raise exception 'FOUNDER_REPLAY_PROMOTION_MUST_SUPERSEDE_CURRENT';
  end if;
  return new;
end;
$$;

create trigger founder_replay_promotion_guard before insert
  on public.founder_wellbeing_replay_promotions
  for each row execute function public.enforce_founder_replay_promotion();
create trigger founder_replay_verification_append_only before update or delete
  on public.founder_wellbeing_replay_verifications
  for each row execute function public.prevent_event_mutation();
create trigger founder_replay_promotion_append_only before update or delete
  on public.founder_wellbeing_replay_promotions
  for each row execute function public.prevent_event_mutation();

create or replace function public.promote_verified_founder_replay(
  p_verification_id uuid,
  p_promoted_by text,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_verification public.founder_wellbeing_replay_verifications%rowtype;
  v_run public.founder_wellbeing_replay_runs%rowtype;
  v_current_id uuid;
  v_promotion_id uuid;
begin
  if nullif(trim(p_promoted_by), '') is null or nullif(trim(p_reason), '') is null then
    raise exception 'FOUNDER_REPLAY_PROMOTION_PROVENANCE_REQUIRED';
  end if;
  select * into strict v_verification
    from public.founder_wellbeing_replay_verifications
    where id = p_verification_id;
  select * into strict v_run
    from public.founder_wellbeing_replay_runs
    where id = v_verification.replay_run_id;
  perform pg_advisory_xact_lock(hashtextextended(v_run.owner_id::text || ':' || v_run.mode, 0));
  select id into v_current_id
    from public.founder_wellbeing_replay_promotions promotion
    where promotion.owner_id = v_run.owner_id and promotion.mode = v_run.mode
      and not exists (
        select 1 from public.founder_wellbeing_replay_promotions successor
        where successor.supersedes_promotion_id = promotion.id
      )
    order by promotion.promoted_at desc
    limit 1;
  insert into public.founder_wellbeing_replay_promotions (
    owner_id, mode, replay_run_id, verification_id, promoted_by, reason,
    supersedes_promotion_id
  ) values (
    v_run.owner_id, v_run.mode, v_run.id, v_verification.id,
    p_promoted_by, p_reason, v_current_id
  ) returning id into v_promotion_id;
  return v_promotion_id;
end;
$$;

alter table public.founder_wellbeing_replay_verifications enable row level security;
alter table public.founder_wellbeing_replay_promotions enable row level security;
create policy own_founder_replay_verifications on public.founder_wellbeing_replay_verifications
  for select using (owner_id = auth.uid());
create policy own_founder_replay_promotions on public.founder_wellbeing_replay_promotions
  for select using (owner_id = auth.uid());
grant select on public.founder_wellbeing_replay_verifications, public.founder_wellbeing_replay_promotions to authenticated;
grant select, insert on public.founder_wellbeing_replay_verifications to service_role;
grant select on public.founder_wellbeing_replay_promotions to service_role;
revoke all on function public.promote_verified_founder_replay(uuid, text, text) from public, anon, authenticated;
grant execute on function public.promote_verified_founder_replay(uuid, text, text) to service_role;

create or replace view public.current_promoted_founder_replay
with (security_invoker = true) as
select distinct on (promotion.owner_id, promotion.mode)
  promotion.owner_id,
  promotion.mode,
  promotion.replay_run_id,
  promotion.verification_id,
  promotion.id as promotion_id,
  promotion.promoted_at,
  promotion.promoted_by,
  promotion.reason,
  run.baseline_epoch_id,
  baseline.effective_at as baseline_effective_at,
  baseline.wellbeing_score as baseline_wellbeing_score
from public.founder_wellbeing_replay_promotions promotion
join public.founder_wellbeing_replay_runs run on run.id = promotion.replay_run_id
join public.founder_wellbeing_baseline_epochs baseline on baseline.id = run.baseline_epoch_id
where not exists (
  select 1 from public.founder_wellbeing_replay_promotions successor
  where successor.supersedes_promotion_id = promotion.id
)
order by promotion.owner_id, promotion.mode, promotion.promoted_at desc;

create or replace view public.current_founder_wellbeing_state
with (security_invoker = true) as
select distinct on (revision.owner_id, promoted.mode)
  revision.id,
  revision.replay_run_id,
  revision.owner_id,
  revision.subject_id,
  revision.baseline_epoch_id,
  revision.sequence_number,
  revision.effective_at,
  revision.activity_occurrence_id,
  revision.source_attestation_id,
  revision.revision_kind,
  revision.component,
  revision.component_before,
  revision.component_after,
  revision.physiology,
  revision.emotion,
  revision.feeling,
  revision.thought,
  revision.habit,
  revision.performance,
  revision.w_before,
  revision.w_after,
  revision.delta_w,
  revision.transition,
  revision.policy_id,
  revision.policy_version,
  revision.policy_content_hash,
  revision.calculation_version,
  revision.validation_mode,
  revision.created_at,
  promoted.mode,
  run.completed_at,
  revision.genesis_qualification_id,
  promoted.verification_id,
  promoted.promotion_id,
  promoted.promoted_at
from public.current_promoted_founder_replay promoted
join public.founder_wellbeing_replay_runs run on run.id = promoted.replay_run_id
join public.founder_wellbeing_state_revisions revision on revision.replay_run_id = promoted.replay_run_id
order by revision.owner_id, promoted.mode, revision.sequence_number desc;

create view public.current_promoted_founder_value_events
with (security_invoker = true) as
select value.*, promoted.mode, promoted.promotion_id, promoted.promoted_at
from public.current_promoted_founder_replay promoted
join public.founder_wellbeing_value_events value on value.replay_run_id = promoted.replay_run_id;

grant select on public.current_promoted_founder_replay,
  public.current_promoted_founder_value_events,
  public.current_founder_wellbeing_state to authenticated, service_role;

-- Legacy aliases remain read-only and are not canonical protocol fields.
create view public.founder_wellbeing_value_events_compat
with (security_invoker = true) as
select value.*,
  coalesce(value.community_rate_amount, value.rate) as legacy_rate,
  coalesce(value.vcom_event_amount, value.vcom_amount) as legacy_vcom_amount,
  coalesce(value.vcom_event_unit, value.vcom_unit) as legacy_vcom_unit,
  coalesce(value.vcperformance_event_amount, value.vcperformance) as legacy_vcperformance,
  case value.protocol_finality_status when 'final' then 'settled' else 'provisional' end as legacy_settlement_status
from public.founder_wellbeing_value_events value;

grant select on public.founder_wellbeing_value_events_compat to authenticated, service_role;
