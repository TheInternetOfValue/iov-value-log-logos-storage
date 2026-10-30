-- Private operating projections: approved intentions and campaign outcomes.
-- These records never alter canonical Value Log activity, validation, or calculation tables.

create type public.plan_status as enum ('planned', 'changed', 'cancelled');
create type public.plan_responsible_party as enum ('founder', 'ai_codex', 'shared');
create type public.campaign_event_kind as enum ('recorded', 'refund', 'correction');

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key uuid not null,
  version integer not null check (version > 0),
  owner_id uuid not null references public.members(id),
  plan_date date not null,
  daily_focus text check (daily_focus is null or char_length(daily_focus) <= 240),
  status public.plan_status not null default 'planned',
  supersedes_plan_id uuid unique references public.daily_plans(id),
  idempotency_key text not null,
  payload_hash text not null,
  approval_text text not null check (char_length(approval_text) between 1 and 500),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (plan_key, version),
  unique (owner_id, idempotency_key)
);

create table public.daily_plan_blocks (
  id uuid primary key default gen_random_uuid(),
  daily_plan_id uuid not null references public.daily_plans(id),
  owner_id uuid not null references public.members(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Asia/Kolkata',
  responsible_party public.plan_responsible_party not null default 'founder',
  founder_activity text not null check (char_length(founder_activity) between 1 and 500),
  ai_codex_activity text check (ai_codex_activity is null or char_length(ai_codex_activity) <= 500),
  intended_outcome text check (intended_outcome is null or char_length(intended_outcome) <= 500),
  context text check (context is null or char_length(context) <= 160),
  status public.plan_status not null default 'planned',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint positive_daily_plan_block check (end_at > start_at)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  slug text not null,
  name text not null,
  north_star_label text not null default 'Validated demand',
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_at timestamptz not null default now(),
  constraint campaign_dates_valid check (ends_on >= starts_on),
  unique (owner_id, slug)
);

create table public.campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  owner_id uuid not null references public.members(id),
  key text not null check (key in ('revenue_collected', 'confirmed_book_orders', 'founders_edition_purchases', 'confirmed_registrations', 'workshop_purchases_deposits', 'partnership_commitments')),
  label text not null,
  unit text not null check (unit in ('inr', 'count')),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campaign_id, key)
);

create table public.campaign_metric_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_metric_id uuid not null references public.campaign_metrics(id),
  owner_id uuid not null references public.members(id),
  target_value numeric(18,2) not null check (target_value >= 0),
  version integer not null check (version > 0),
  effective_at timestamptz not null default now(),
  supersedes_target_id uuid unique references public.campaign_metric_targets(id),
  created_at timestamptz not null default now(),
  unique (campaign_metric_id, version)
);

create table public.campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  owner_id uuid not null references public.members(id),
  occurred_at timestamptz not null,
  summary text not null check (char_length(summary) between 1 and 500),
  evidence_reference text check (evidence_reference is null or char_length(evidence_reference) <= 1000),
  canonical_slice_id uuid references public.canonical_slices(id) on delete restrict,
  event_kind public.campaign_event_kind not null default 'recorded',
  reverses_event_id uuid unique references public.campaign_events(id),
  idempotency_key text not null,
  payload_hash text not null,
  approval_text text not null check (char_length(approval_text) between 1 and 500),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create table public.campaign_event_metric_movements (
  id uuid primary key default gen_random_uuid(),
  campaign_event_id uuid not null references public.campaign_events(id),
  campaign_metric_id uuid not null references public.campaign_metrics(id),
  owner_id uuid not null references public.members(id),
  delta numeric(18,2) not null check (delta <> 0),
  created_at timestamptz not null default now(),
  unique (campaign_event_id, campaign_metric_id)
);

create index daily_plan_owner_date_idx on public.daily_plans (owner_id, plan_date, created_at desc);
create index daily_plan_block_plan_idx on public.daily_plan_blocks (daily_plan_id, start_at);
create index campaign_owner_active_idx on public.campaigns (owner_id, status, starts_on, ends_on);
create index campaign_event_campaign_time_idx on public.campaign_events (campaign_id, occurred_at desc);
create index campaign_movement_metric_idx on public.campaign_event_metric_movements (campaign_metric_id);

create view public.current_daily_plans with (security_invoker = true) as
select plan.* from public.daily_plans plan
where not exists (select 1 from public.daily_plans successor where successor.supersedes_plan_id = plan.id);

alter table public.daily_plans enable row level security;
alter table public.daily_plan_blocks enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_metrics enable row level security;
alter table public.campaign_metric_targets enable row level security;
alter table public.campaign_events enable row level security;
alter table public.campaign_event_metric_movements enable row level security;

create policy own_daily_plans on public.daily_plans for select using (owner_id = auth.uid());
create policy own_daily_plan_blocks on public.daily_plan_blocks for select using (owner_id = auth.uid());
create policy own_campaigns on public.campaigns for select using (owner_id = auth.uid());
create policy own_campaign_metrics on public.campaign_metrics for select using (owner_id = auth.uid());
create policy own_campaign_targets on public.campaign_metric_targets for select using (owner_id = auth.uid());
create policy own_campaign_events on public.campaign_events for select using (owner_id = auth.uid());
create policy own_campaign_movements on public.campaign_event_metric_movements for select using (owner_id = auth.uid());

revoke insert, update, delete on public.daily_plans, public.daily_plan_blocks, public.campaigns, public.campaign_metrics, public.campaign_metric_targets, public.campaign_events, public.campaign_event_metric_movements from authenticated;

create trigger campaign_events_append_only before update or delete on public.campaign_events for each row execute function public.prevent_event_mutation();
create trigger campaign_event_movements_append_only before update or delete on public.campaign_event_metric_movements for each row execute function public.prevent_event_mutation();
create trigger campaign_targets_append_only before update or delete on public.campaign_metric_targets for each row execute function public.prevent_event_mutation();

create or replace function public.save_daily_plan(p_owner_id uuid, p_payload jsonb, p_payload_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare existing public.daily_plans; previous public.daily_plans; saved_id uuid; block jsonb; index_value integer := 0;
begin
  select * into existing from public.daily_plans where owner_id = p_owner_id and idempotency_key = p_payload->>'idempotency_key';
  if found then
    if existing.payload_hash <> p_payload_hash then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return existing.id;
  end if;
  select * into previous from public.daily_plans plan where plan.owner_id = p_owner_id and plan.plan_date = (p_payload->>'plan_date')::date and not exists (select 1 from public.daily_plans successor where successor.supersedes_plan_id = plan.id) for update;
  if coalesce(p_payload->>'expected_plan_id', '') is distinct from coalesce(previous.id::text, '') then raise exception 'plan_version_conflict' using errcode = 'P0001'; end if;
  insert into public.daily_plans(plan_key, version, owner_id, plan_date, daily_focus, status, supersedes_plan_id, idempotency_key, payload_hash, approval_text)
  values (coalesce(previous.plan_key, gen_random_uuid()), coalesce(previous.version + 1, 1), p_owner_id, (p_payload->>'plan_date')::date, nullif(p_payload->>'daily_focus',''), coalesce((p_payload->>'status')::public.plan_status, 'planned'), previous.id, p_payload->>'idempotency_key', p_payload_hash, p_payload->'approval'->>'confirmation_text') returning id into saved_id;
  for block in select value from jsonb_array_elements(p_payload->'blocks') loop
    insert into public.daily_plan_blocks(daily_plan_id, owner_id, start_at, end_at, timezone, responsible_party, founder_activity, ai_codex_activity, intended_outcome, context, status, display_order)
    values (saved_id, p_owner_id, (block->>'start_at')::timestamptz, (block->>'end_at')::timestamptz, block->>'timezone', coalesce((block->>'responsible_party')::public.plan_responsible_party, 'founder'), block->>'founder_activity', nullif(block->>'ai_codex_activity',''), nullif(block->>'intended_outcome',''), nullif(block->>'context',''), coalesce((block->>'status')::public.plan_status, 'planned'), index_value);
    index_value := index_value + 1;
  end loop;
  insert into public.audit_events(owner_id, actor_type, event_type, entity_type, entity_id, metadata) values (p_owner_id, 'machine', 'daily_plan_approved', 'daily_plan', saved_id::text, jsonb_build_object('plan_date', p_payload->>'plan_date', 'version', coalesce(previous.version + 1, 1)));
  return saved_id;
end; $$;

create or replace function public.record_campaign_event(p_owner_id uuid, p_payload jsonb, p_payload_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare existing public.campaign_events; campaign_row public.campaigns; metric jsonb; saved_id uuid; metric_id uuid;
begin
  select * into existing from public.campaign_events where owner_id = p_owner_id and idempotency_key = p_payload->>'idempotency_key';
  if found then
    if existing.payload_hash <> p_payload_hash then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return existing.id;
  end if;
  select * into campaign_row from public.campaigns where id = (p_payload->>'campaign_id')::uuid and owner_id = p_owner_id;
  if not found then raise exception 'campaign_not_found' using errcode = 'P0001'; end if;
  if (p_payload->>'canonical_slice_id') is not null and not exists (select 1 from public.canonical_slices where id = (p_payload->>'canonical_slice_id')::uuid and owner_id = p_owner_id) then raise exception 'canonical_slice_not_found' using errcode = 'P0001'; end if;
  if (p_payload->>'reverses_event_id') is not null and not exists (select 1 from public.campaign_events where id = (p_payload->>'reverses_event_id')::uuid and campaign_id = campaign_row.id and owner_id = p_owner_id) then raise exception 'reversed_campaign_event_not_found' using errcode = 'P0001'; end if;
  insert into public.campaign_events(campaign_id, owner_id, occurred_at, summary, evidence_reference, canonical_slice_id, event_kind, reverses_event_id, idempotency_key, payload_hash, approval_text)
  values (campaign_row.id, p_owner_id, (p_payload->>'occurred_at')::timestamptz, p_payload->>'summary', nullif(p_payload->>'evidence_reference',''), nullif(p_payload->>'canonical_slice_id','')::uuid, coalesce((p_payload->>'event_kind')::public.campaign_event_kind, 'recorded'), nullif(p_payload->>'reverses_event_id','')::uuid, p_payload->>'idempotency_key', p_payload_hash, p_payload->'approval'->>'confirmation_text') returning id into saved_id;
  for metric in select value from jsonb_array_elements(p_payload->'movements') loop
    select id into metric_id from public.campaign_metrics where id = (metric->>'campaign_metric_id')::uuid and campaign_id = campaign_row.id and owner_id = p_owner_id and is_active;
    if metric_id is null then raise exception 'campaign_metric_not_found' using errcode = 'P0001'; end if;
    insert into public.campaign_event_metric_movements(campaign_event_id, campaign_metric_id, owner_id, delta) values (saved_id, metric_id, p_owner_id, (metric->>'delta')::numeric);
  end loop;
  insert into public.audit_events(owner_id, actor_type, event_type, entity_type, entity_id, metadata) values (p_owner_id, 'machine', 'campaign_event_recorded', 'campaign_event', saved_id::text, jsonb_build_object('campaign_id', campaign_row.id, 'event_kind', coalesce(p_payload->>'event_kind', 'recorded')));
  return saved_id;
end; $$;

revoke all on function public.save_daily_plan(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.record_campaign_event(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_daily_plan(uuid, jsonb, text) to service_role;
grant execute on function public.record_campaign_event(uuid, jsonb, text) to service_role;

-- Controlled release setup only. It creates no target revision unless the
-- supplied target object contains that metric key.
create or replace function public.bootstrap_august_15_campaign(p_owner_id uuid, p_targets jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid; metric record; v_metric_id uuid; current_target numeric;
begin
  insert into public.campaigns(owner_id, slug, name, starts_on, ends_on, status)
  values (p_owner_id, 'august-15-iov-launch-2026', 'August 15 Internet of Value Launch Campaign', '2026-07-20', '2026-08-20', 'active')
  on conflict (owner_id, slug) do update set name = excluded.name
  returning id into v_campaign_id;
  for metric in select * from (values
    ('revenue_collected', 'Revenue collected', 'inr', 1),
    ('confirmed_book_orders', 'Confirmed book orders', 'count', 2),
    ('founders_edition_purchases', 'Founder''s Edition purchases', 'count', 3),
    ('confirmed_registrations', 'Confirmed registrations', 'count', 4),
    ('workshop_purchases_deposits', 'Workshop purchases/deposits', 'count', 5),
    ('partnership_commitments', 'Partnership commitments', 'count', 6)
  ) as defaults(key, label, unit, display_order) loop
    insert into public.campaign_metrics(campaign_id, owner_id, key, label, unit, display_order)
    values (v_campaign_id, p_owner_id, metric.key, metric.label, metric.unit, metric.display_order)
    on conflict (campaign_id, key) do update set label = excluded.label, display_order = excluded.display_order
    returning id into v_metric_id;
    if p_targets ? metric.key then
      select target_value into current_target from public.campaign_metric_targets where campaign_metric_id = v_metric_id order by version desc limit 1;
      if current_target is distinct from (p_targets->>metric.key)::numeric then
        insert into public.campaign_metric_targets(campaign_metric_id, owner_id, target_value, version)
        select v_metric_id, p_owner_id, (p_targets->>metric.key)::numeric, coalesce(max(version), 0) + 1
        from public.campaign_metric_targets where campaign_metric_id = v_metric_id;
      end if;
    end if;
  end loop;
  return v_campaign_id;
end; $$;
revoke all on function public.bootstrap_august_15_campaign(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.bootstrap_august_15_campaign(uuid, jsonb) to service_role;
