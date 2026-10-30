-- Private, versioned retrospective scripts. A reel is a storytelling projection,
-- never a canonical activity, plan, campaign outcome, or calculation input.

create table public.cinematic_day_reels (
  id uuid primary key default gen_random_uuid(),
  reel_key uuid not null,
  version integer not null check (version > 0),
  owner_id uuid not null references public.members(id),
  reel_date date not null,
  title text not null check (char_length(title) between 1 and 160),
  duration_seconds integer not null check (duration_seconds between 20 and 90),
  script_markdown text not null check (char_length(script_markdown) between 1 and 12000),
  supersedes_reel_id uuid unique references public.cinematic_day_reels(id),
  idempotency_key text not null,
  payload_hash text not null,
  approval_text text not null check (char_length(approval_text) between 1 and 500),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (reel_key, version),
  unique (owner_id, idempotency_key)
);

create index cinematic_day_reel_owner_date_idx on public.cinematic_day_reels (owner_id, reel_date, created_at desc);

create view public.current_cinematic_day_reels with (security_invoker = true) as
select reel.* from public.cinematic_day_reels reel
where not exists (
  select 1 from public.cinematic_day_reels successor
  where successor.supersedes_reel_id = reel.id
);

alter table public.cinematic_day_reels enable row level security;
create policy own_cinematic_day_reels on public.cinematic_day_reels for select using (owner_id = auth.uid());
revoke insert, update, delete on public.cinematic_day_reels from authenticated;
create trigger cinematic_day_reels_append_only before update or delete on public.cinematic_day_reels for each row execute function public.prevent_event_mutation();

create or replace function public.save_cinematic_day_reel(p_owner_id uuid, p_payload jsonb, p_payload_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare existing public.cinematic_day_reels; previous public.cinematic_day_reels; saved_id uuid; reel_day date;
begin
  reel_day := (p_payload->>'reel_date')::date;
  if reel_day >= (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'day_not_complete' using errcode = 'P0001';
  end if;
  select * into existing from public.cinematic_day_reels where owner_id = p_owner_id and idempotency_key = p_payload->>'idempotency_key';
  if found then
    if existing.payload_hash <> p_payload_hash then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return existing.id;
  end if;
  select * into previous from public.cinematic_day_reels reel
  where reel.owner_id = p_owner_id and reel.reel_date = reel_day
    and not exists (select 1 from public.cinematic_day_reels successor where successor.supersedes_reel_id = reel.id)
  for update;
  if coalesce(p_payload->>'expected_reel_id', '') is distinct from coalesce(previous.id::text, '') then
    raise exception 'reel_version_conflict' using errcode = 'P0001';
  end if;
  insert into public.cinematic_day_reels(reel_key, version, owner_id, reel_date, title, duration_seconds, script_markdown, supersedes_reel_id, idempotency_key, payload_hash, approval_text)
  values (coalesce(previous.reel_key, gen_random_uuid()), coalesce(previous.version + 1, 1), p_owner_id, reel_day, p_payload->>'title', (p_payload->>'duration_seconds')::integer, p_payload->>'script_markdown', previous.id, p_payload->>'idempotency_key', p_payload_hash, p_payload->'approval'->>'confirmation_text')
  returning id into saved_id;
  insert into public.audit_events(owner_id, actor_type, event_type, entity_type, entity_id, metadata)
  values (p_owner_id, 'machine', 'cinematic_day_reel_saved', 'cinematic_day_reel', saved_id::text, jsonb_build_object('reel_date', reel_day, 'version', coalesce(previous.version + 1, 1)));
  return saved_id;
end; $$;

revoke all on function public.save_cinematic_day_reel(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_cinematic_day_reel(uuid, jsonb, text) to service_role;
