-- Keep an approved reel replacement attached to its evidence date across
-- midnight. A missing projection ID is safe to resolve only when both versions
-- have immutable cutoffs and the new cutoff advances.

create or replace function public.save_cinematic_day_reel(p_owner_id uuid, p_payload jsonb, p_payload_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  existing public.cinematic_day_reels;
  previous public.cinematic_day_reels;
  saved_id uuid;
  reel_day date;
  today_ist date;
  cutoff_at timestamptz;
  expected_reel_id text;
begin
  reel_day := (p_payload->>'reel_date')::date;
  today_ist := (now() at time zone 'Asia/Kolkata')::date;
  cutoff_at := nullif(p_payload->>'evidence_cutoff_at', '')::timestamptz;
  expected_reel_id := nullif(p_payload->>'expected_reel_id', '');

  if reel_day > today_ist then
    raise exception 'future_reel_date' using errcode = 'P0001';
  end if;
  if reel_day = today_ist and cutoff_at is null then
    raise exception 'evidence_cutoff_required' using errcode = 'P0001';
  end if;
  if cutoff_at is not null and (cutoff_at at time zone 'Asia/Kolkata')::date <> reel_day then
    raise exception 'evidence_cutoff_date_mismatch' using errcode = 'P0001';
  end if;
  if cutoff_at is not null and cutoff_at > now() then
    raise exception 'evidence_cutoff_in_future' using errcode = 'P0001';
  end if;

  select * into existing
  from public.cinematic_day_reels
  where owner_id = p_owner_id and idempotency_key = p_payload->>'idempotency_key';
  if found then
    if existing.payload_hash <> p_payload_hash then
      raise exception 'idempotency_conflict' using errcode = 'P0001';
    end if;
    return existing.id;
  end if;

  select * into previous
  from public.cinematic_day_reels reel
  where reel.owner_id = p_owner_id and reel.reel_date = reel_day
    and not exists (
      select 1 from public.cinematic_day_reels successor
      where successor.supersedes_reel_id = reel.id
    )
  for update;

  if previous.id is null then
    if expected_reel_id is not null then
      raise exception 'reel_version_conflict' using errcode = 'P0001';
    end if;
  elsif expected_reel_id is not null then
    if expected_reel_id is distinct from previous.id::text then
      raise exception 'reel_version_conflict' using errcode = 'P0001';
    end if;
  elsif cutoff_at is null
    or previous.evidence_cutoff_at is null
    or cutoff_at <= previous.evidence_cutoff_at then
    raise exception 'reel_version_conflict' using errcode = 'P0001';
  end if;

  insert into public.cinematic_day_reels(
    reel_key, version, owner_id, reel_date, evidence_cutoff_at, title,
    duration_seconds, script_markdown, supersedes_reel_id, idempotency_key,
    payload_hash, approval_text
  ) values (
    coalesce(previous.reel_key, gen_random_uuid()), coalesce(previous.version + 1, 1),
    p_owner_id, reel_day, cutoff_at, p_payload->>'title',
    (p_payload->>'duration_seconds')::integer, p_payload->>'script_markdown',
    previous.id, p_payload->>'idempotency_key', p_payload_hash,
    p_payload->'approval'->>'confirmation_text'
  ) returning id into saved_id;

  insert into public.audit_events(owner_id, actor_type, event_type, entity_type, entity_id, metadata)
  values (
    p_owner_id, 'machine', 'cinematic_day_reel_saved', 'cinematic_day_reel',
    saved_id::text,
    jsonb_build_object(
      'reel_date', reel_day,
      'version', coalesce(previous.version + 1, 1),
      'has_evidence_cutoff', cutoff_at is not null,
      'resolved_current_version', previous.id is not null and expected_reel_id is null
    )
  );
  return saved_id;
end; $$;

revoke all on function public.save_cinematic_day_reel(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_cinematic_day_reel(uuid, jsonb, text) to service_role;
