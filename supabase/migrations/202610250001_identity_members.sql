-- Additive member admission. Existing bindings, activities and pilot policies stay intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.member_identity_bindings drop constraint member_identity_bindings_did_check;
alter table public.member_identity_bindings add constraint member_identity_bindings_did_check
  check (did ~ '^did:iov:member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- This older view must use the caller's existing owner policies before admitting more members.
alter view public.current_founder_genesis_status set (security_invoker = true);

create table public.member_log_access (
  owner_id uuid primary key references public.members(id) on delete restrict,
  admitted_at timestamptz not null default now(),
  onboarded_at timestamptz,
  write_window_started_at timestamptz not null default now(),
  write_window_count integer not null default 0 check (write_window_count between 0 and 30)
);
alter table public.member_log_access enable row level security;
create policy member_reads_log_access on public.member_log_access for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.member_log_access from public, anon, authenticated;
grant select on public.member_log_access to authenticated;
grant select, insert, update on public.member_log_access to service_role;

-- These are private, unassessed activities, not validated canonical slices.
create table public.member_activity_entries (
  id uuid not null,
  owner_id uuid not null references public.member_log_access(owner_id) on delete restrict,
  revision integer not null check (revision > 0),
  activity_date date,
  wellbeing_node public.wellbeing_node,
  content_ciphertext text,
  content_iv text,
  content_auth_tag text,
  content_key_version integer,
  content_digest text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (owner_id, id),
  check ((removed_at is not null and activity_date is null and wellbeing_node is null and content_ciphertext is null and content_iv is null and content_auth_tag is null and content_key_version is null)
    or (removed_at is null and activity_date is not null and wellbeing_node is not null and content_ciphertext is not null and content_iv is not null and content_auth_tag is not null and content_key_version is not null))
);
create index member_activity_by_date on public.member_activity_entries(owner_id, activity_date, id);
alter table public.member_activity_entries enable row level security;
create policy member_reads_activity on public.member_activity_entries for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.member_activity_entries from public, anon, authenticated;
grant select on public.member_activity_entries to authenticated;
grant select, insert, update on public.member_activity_entries to service_role;

-- New members cannot self-author pilot baselines, rate policies or GPT drafts through PostgREST.
-- Original pilot users have no member_log_access row, so their existing policy remains effective.
create policy pilot_intakes_only on public.intake_sessions as restrictive for all to authenticated
  using (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())))
  with check (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())));
create policy pilot_drafts_only on public.draft_slices as restrictive for all to authenticated
  using (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())))
  with check (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())));
create policy pilot_baselines_only on public.wellbeing_baselines as restrictive for all to authenticated
  using (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())))
  with check (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())));
create policy pilot_rates_only on public.community_rate_versions as restrictive for all to authenticated
  using (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())))
  with check (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())));
create policy pilot_metrics_only on public.pilot_metrics as restrictive for all to authenticated
  using (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())))
  with check (not exists (select 1 from public.member_log_access where owner_id = (select auth.uid())));

-- A technical, non-deliverable Auth locator preserves the DID-only inter-product boundary.
-- Its issuer metadata is server-controlled; user_metadata is deliberately never trusted.
create function public.value_log_identity_candidate(p_did text, p_email text)
returns table(owner_id uuid, email text)
language sql security definer set search_path = '' as $$
  select u.id, u.email::text from auth.users u
  where p_did ~ '^did:iov:member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_email ~ '^identity-[0-9a-f]{64}@members\.valuelog\.invalid$'
    and u.email = p_email and u.raw_app_meta_data->>'identity_issuer' = 'word-wallet-web'
    and u.raw_app_meta_data->>'identity_did' = p_did
$$;

create function public.admit_value_log_member(p_owner_id uuid, p_did text, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing_owner uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_did, 0));
  select b.owner_id into existing_owner from public.member_identity_bindings b where b.did = p_did;
  if existing_owner is not null then return existing_owner; end if;
  if not exists (select 1 from public.value_log_identity_candidate(p_did, p_email) c where c.owner_id = p_owner_id) then
    raise exception 'identity candidate mismatch';
  end if;
  -- Never assign a second DID or turn any existing pilot account into a new member.
  if exists (select 1 from public.members where id = p_owner_id) then raise exception 'member already exists'; end if;
  insert into public.members(id, email, display_name, timezone) values (p_owner_id, p_email, '', 'UTC');
  insert into public.member_identity_bindings(owner_id, did) values (p_owner_id, p_did);
  insert into public.member_log_access(owner_id) values (p_owner_id);
  insert into public.audit_events(owner_id, actor_id, actor_type, event_type, entity_type, entity_id, metadata)
    values (p_owner_id, p_owner_id, 'observer', 'value_log_member_admitted', 'member', p_owner_id::text, '{}'::jsonb);
  return p_owner_id;
end $$;

create function public.setup_value_log_member(p_owner_id uuid, p_name text, p_timezone text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if length(p_name) < 1 or length(p_name) > 80 or not exists(select 1 from pg_timezone_names where name = p_timezone) then raise exception 'invalid profile'; end if;
  perform 1 from public.member_log_access where owner_id = p_owner_id for update;
  if not found then raise exception 'member access required'; end if;
  update public.members set display_name = p_name, timezone = p_timezone where id = p_owner_id;
  update public.member_log_access set onboarded_at = coalesce(onboarded_at, now()) where owner_id = p_owner_id;
  return true;
end $$;

-- Revision checks also make same-operation retries safe. No canonical record is mutated.
create function public.save_value_log_member_entry(p_owner_id uuid, p_id uuid, p_revision integer, p_date date,
  p_node public.wellbeing_node, p_content jsonb, p_remove boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare current_entry public.member_activity_entries; log_access public.member_log_access; next_revision integer;
begin
  select * into log_access from public.member_log_access where owner_id = p_owner_id and onboarded_at is not null for update;
  if not found then raise exception 'member setup required'; end if;
  if p_revision < 0 or p_revision > 2147483645 or jsonb_typeof(p_content) <> 'object'
    or length(p_content->>'digest') <> 64 then raise exception 'invalid entry'; end if;
  select * into current_entry from public.member_activity_entries where owner_id = p_owner_id and id = p_id for update;
  if found then
    if current_entry.revision = p_revision + 1 and current_entry.content_digest = p_content->>'digest'
      and (current_entry.removed_at is not null) = p_remove then return current_entry.revision; end if;
    if current_entry.revision <> p_revision or current_entry.removed_at is not null then raise exception 'revision_conflict'; end if;
  elsif p_revision <> 0 or p_remove then raise exception 'revision_conflict';
  elsif (select count(*) from public.member_activity_entries where owner_id = p_owner_id) >= 10000 then raise exception 'entry_limit';
  end if;
  if log_access.write_window_started_at > now() - interval '1 minute' and log_access.write_window_count >= 30 then raise exception 'write_rate_limited'; end if;
  update public.member_log_access set
    write_window_started_at = case when write_window_started_at <= now() - interval '1 minute' then now() else write_window_started_at end,
    write_window_count = case when write_window_started_at <= now() - interval '1 minute' then 1 else write_window_count + 1 end
    where owner_id = p_owner_id;
  if not p_remove and (length(p_content->>'ciphertext') not between 1 and 42000 or length(p_content->>'iv') <> 16 or length(p_content->>'authTag') <> 24 or (p_content->>'keyVersion')::integer < 1) then raise exception 'invalid encrypted entry'; end if;
  next_revision := p_revision + 1;
  insert into public.member_activity_entries(id, owner_id, revision, activity_date, wellbeing_node, content_ciphertext, content_iv, content_auth_tag, content_key_version, content_digest, removed_at)
    values(p_id, p_owner_id, next_revision, case when not p_remove then p_date end, case when not p_remove then p_node end,
      case when not p_remove then p_content->>'ciphertext' end,
      case when not p_remove then p_content->>'iv' end,
      case when not p_remove then p_content->>'authTag' end,
      case when not p_remove then (p_content->>'keyVersion')::integer end, p_content->>'digest', case when p_remove then now() end)
  on conflict(owner_id, id) do update set revision = excluded.revision, activity_date = excluded.activity_date,
    wellbeing_node = excluded.wellbeing_node, content_ciphertext = excluded.content_ciphertext, content_iv = excluded.content_iv,
    content_auth_tag = excluded.content_auth_tag, content_key_version = excluded.content_key_version, content_digest = excluded.content_digest,
    removed_at = excluded.removed_at, updated_at = now();
  insert into public.audit_events(owner_id, actor_id, actor_type, event_type, entity_type, entity_id, metadata)
    values(p_owner_id, p_owner_id, 'observer', case when p_remove then 'private_activity_removed' else 'private_activity_saved' end,
      'member_activity_entry', p_id::text, jsonb_build_object('revision', next_revision));
  return next_revision;
end $$;

revoke all on function public.value_log_identity_candidate(text,text), public.admit_value_log_member(uuid,text,text), public.setup_value_log_member(uuid,text,text), public.save_value_log_member_entry(uuid,uuid,integer,date,public.wellbeing_node,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.value_log_identity_candidate(text,text), public.admit_value_log_member(uuid,text,text), public.setup_value_log_member(uuid,text,text), public.save_value_log_member_entry(uuid,uuid,integer,date,public.wellbeing_node,jsonb,boolean) to service_role;
commit;
