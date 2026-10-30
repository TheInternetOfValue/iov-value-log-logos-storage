-- Private weekly evidence snapshots and explicitly approved reflections.
-- They are projections over canonical life, never calculation or protocol inputs.

create table public.weekly_review_packets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(id),
  week_start date not null,
  week_end date not null,
  version integer not null check (version > 0),
  timezone text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  evidence jsonb not null,
  campaign_context jsonb,
  source_hash text not null,
  generator_version text not null,
  prepared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint weekly_review_packet_window check (week_end = week_start + 5),
  unique (owner_id, week_start, version),
  unique (owner_id, week_start, source_hash)
);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  review_key uuid not null,
  version integer not null check (version > 0),
  owner_id uuid not null references public.members(id),
  packet_id uuid not null references public.weekly_review_packets(id),
  week_start date not null,
  week_end date not null,
  review_markdown text not null check (char_length(review_markdown) between 1 and 16000),
  monday_friday_plan jsonb not null,
  owner_reflection text not null check (char_length(owner_reflection) between 1 and 4000),
  supersedes_review_id uuid unique references public.weekly_reviews(id),
  idempotency_key text not null,
  payload_hash text not null,
  approval_text text not null check (char_length(approval_text) between 1 and 500),
  approval_channel text not null default 'private_custom_gpt' check (approval_channel = 'private_custom_gpt'),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint weekly_review_window check (week_end = week_start + 5),
  unique (review_key, version),
  unique (owner_id, idempotency_key)
);

create index weekly_review_packets_owner_week_idx on public.weekly_review_packets (owner_id, week_start desc, version desc);
create index weekly_reviews_owner_week_idx on public.weekly_reviews (owner_id, week_start desc, version desc);

create view public.current_weekly_reviews with (security_invoker = true) as
select review.* from public.weekly_reviews review
where not exists (
  select 1 from public.weekly_reviews successor
  where successor.supersedes_review_id = review.id
);

alter table public.weekly_review_packets enable row level security;
alter table public.weekly_reviews enable row level security;
create policy own_weekly_review_packets on public.weekly_review_packets for select using (owner_id = auth.uid());
create policy own_weekly_reviews on public.weekly_reviews for select using (owner_id = auth.uid());
revoke insert, update, delete on public.weekly_review_packets, public.weekly_reviews from authenticated;

create trigger weekly_review_packets_append_only before update or delete on public.weekly_review_packets
for each row execute function public.prevent_event_mutation();
create trigger weekly_reviews_append_only before update or delete on public.weekly_reviews
for each row execute function public.prevent_event_mutation();

create or replace function public.save_weekly_review(p_owner_id uuid, p_payload jsonb, p_payload_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  packet public.weekly_review_packets;
  latest_packet public.weekly_review_packets;
  existing public.weekly_reviews;
  previous public.weekly_reviews;
  saved_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || coalesce(p_payload->>'packet_id', ''), 0));
  select * into existing from public.weekly_reviews
  where owner_id = p_owner_id and idempotency_key = p_payload->>'idempotency_key';
  if found then
    if existing.payload_hash <> p_payload_hash then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return existing.id;
  end if;

  select * into packet from public.weekly_review_packets
  where id = (p_payload->>'packet_id')::uuid and owner_id = p_owner_id;
  if not found then raise exception 'packet_not_found' using errcode = 'P0001'; end if;

  select * into latest_packet from public.weekly_review_packets
  where owner_id = p_owner_id and week_start = packet.week_start
  order by version desc limit 1;
  if latest_packet.id <> packet.id then raise exception 'packet_superseded' using errcode = 'P0001'; end if;

  select * into previous from public.weekly_reviews review
  where review.owner_id = p_owner_id and review.week_start = packet.week_start
    and not exists (
      select 1 from public.weekly_reviews successor
      where successor.supersedes_review_id = review.id
    )
  for update;

  insert into public.weekly_reviews(
    review_key, version, owner_id, packet_id, week_start, week_end,
    review_markdown, monday_friday_plan, owner_reflection,
    supersedes_review_id, idempotency_key, payload_hash, approval_text
  ) values (
    coalesce(previous.review_key, gen_random_uuid()), coalesce(previous.version + 1, 1),
    p_owner_id, packet.id, packet.week_start, packet.week_end,
    p_payload->>'review_markdown', p_payload->'monday_friday_plan', p_payload->>'owner_reflection',
    previous.id, p_payload->>'idempotency_key', p_payload_hash, p_payload->'approval'->>'confirmation_text'
  ) returning id into saved_id;

  insert into public.audit_events(owner_id, actor_type, event_type, entity_type, entity_id, metadata)
  values (p_owner_id, 'observer', 'weekly_review_saved', 'weekly_review', saved_id::text,
    jsonb_build_object('week_start', packet.week_start, 'week_end', packet.week_end, 'packet_id', packet.id));
  return saved_id;
end; $$;

revoke all on function public.save_weekly_review(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_weekly_review(uuid, jsonb, text) to service_role;
