begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.intake_sessions drop constraint intake_sessions_source_check;
alter table public.intake_sessions add constraint intake_sessions_source_check check (source in ('custom_gpt','native_voice'));

create table public.native_log_drafts (
  owner_id uuid not null references public.members(id) on delete restrict,
  id uuid not null,
  revision integer not null check (revision > 0),
  status text not null default 'draft' check (status in ('draft','submitted','removed')),
  content_ciphertext text, content_iv text, content_auth_tag text, content_key_version integer,
  content_digest text not null,
  lease_token uuid, lease_until timestamptz,
  intake_session_id uuid references public.intake_sessions(id) on delete restrict,
  receipt jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  submitted_at timestamptz, removed_at timestamptz,
  primary key(owner_id,id),
  check ((status='removed' and content_ciphertext is null and content_iv is null and content_auth_tag is null and content_key_version is null)
    or (status<>'removed' and content_ciphertext is not null and content_iv is not null and content_auth_tag is not null and content_key_version is not null)),
  check (receipt is null or jsonb_typeof(receipt)='object')
);
create index native_log_drafts_by_owner_date on public.native_log_drafts(owner_id,updated_at desc,id);
alter table public.native_log_drafts enable row level security;
create policy owner_reads_native_log_drafts on public.native_log_drafts for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.native_log_drafts from public,anon,authenticated;
grant select on public.native_log_drafts to authenticated;
grant select,insert,update on public.native_log_drafts to service_role;

create function public.save_native_log_draft(p_owner uuid,p_id uuid,p_revision integer,p_content jsonb,p_lease uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare current_row public.native_log_drafts; next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('native-log:'||p_owner::text||':'||p_id::text,0));
  select * into current_row from public.native_log_drafts where owner_id=p_owner and id=p_id for update;
  if found then
    if current_row.status<>'draft' then raise exception 'NATIVE_DRAFT_CLOSED'; end if;
    if current_row.revision=p_revision+1 and current_row.content_digest=p_content->>'digest' then return current_row.revision; end if;
    if current_row.revision<>p_revision then raise exception 'REVISION_CONFLICT'; end if;
    if p_lease is not null and current_row.lease_token is distinct from p_lease then raise exception 'REVISION_CONFLICT'; end if;
    if p_lease is null and current_row.lease_until>now() then raise exception 'PROCESSING_BUSY'; end if;
  elsif p_revision<>0 or p_lease is not null then raise exception 'REVISION_CONFLICT';
  elsif (select count(*) from public.native_log_drafts where owner_id=p_owner and status='draft')>=100 then raise exception 'DRAFT_LIMIT';
  end if;
  if not public.consume_ingestion_rate_limit('native-save:'||p_owner::text||':'||to_char(now(),'YYYYMMDDHH24'),240) then raise exception 'RATE_LIMITED'; end if;
  if not (p_content ?& array['ciphertext','iv','authTag','keyVersion','digest']) or length(p_content->>'ciphertext') not between 1 and 900000 or length(p_content->>'iv')<>16 or length(p_content->>'authTag')<>24
    or (p_content->>'keyVersion')::integer<1 or p_content->>'digest' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
  next_revision:=p_revision+1;
  insert into public.native_log_drafts(owner_id,id,revision,content_ciphertext,content_iv,content_auth_tag,content_key_version,content_digest)
    values(p_owner,p_id,next_revision,p_content->>'ciphertext',p_content->>'iv',p_content->>'authTag',(p_content->>'keyVersion')::integer,p_content->>'digest')
    on conflict(owner_id,id) do update set revision=next_revision,content_ciphertext=excluded.content_ciphertext,content_iv=excluded.content_iv,
      content_auth_tag=excluded.content_auth_tag,content_key_version=excluded.content_key_version,content_digest=excluded.content_digest,
      lease_token=null,lease_until=null,updated_at=now();
  return next_revision;
end $$;

create function public.reserve_native_log_processing(p_owner uuid,p_id uuid,p_revision integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid(); current_row public.native_log_drafts;
begin
  select * into current_row from public.native_log_drafts where owner_id=p_owner and id=p_id for update;
  if not found or current_row.status<>'draft' then raise exception 'NATIVE_DRAFT_CLOSED'; end if;
  if current_row.revision<>p_revision then raise exception 'REVISION_CONFLICT'; end if;
  if current_row.lease_until>now() then raise exception 'PROCESSING_BUSY'; end if;
  update public.native_log_drafts set lease_token=token,lease_until=now()+interval '75 seconds' where owner_id=p_owner and id=p_id;
  return token;
end $$;
create function public.release_native_log_processing(p_owner uuid,p_id uuid,p_token uuid)
returns void language sql security definer set search_path='' as $$
  update public.native_log_drafts set lease_token=null,lease_until=null where owner_id=p_owner and id=p_id and lease_token=p_token;
$$;

-- Native and existing writers share a short owner lock only at the new boundary.
-- Legacy-to-legacy overlap behaviour is unchanged; neither source may overlap a native record.
create function public.guard_native_timeline_boundary() returns trigger language plpgsql security definer set search_path='' as $$
declare native boolean;
begin
  if new.status in ('superseded','reversed') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('native-timeline:'||new.owner_id::text,0));
  native:=exists(select 1 from public.draft_slices d where d.id=new.draft_slice_id and d.machine_source='native_voice');
  if exists(select 1 from public.canonical_slices c left join public.draft_slices d on d.id=c.draft_slice_id
    where c.owner_id=new.owner_id and c.id<>new.id and c.id is distinct from new.supersedes_slice_id
      and c.status not in ('superseded','reversed') and (native or d.machine_source='native_voice')
      and c.start_at<new.end_at and new.start_at<c.end_at) then raise exception 'NATIVE_TIMELINE_OVERLAP'; end if;
  return new;
end $$;
create trigger guard_native_timeline_boundary before insert or update of start_at,end_at,status on public.canonical_slices
  for each row execute function public.guard_native_timeline_boundary();

create function public.confirm_native_log(p_owner uuid,p_id uuid,p_revision integer,p_digest text,p_mode text,p_entries jsonb,p_narrative jsonb,p_confirmation text,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.native_log_drafts; entry jsonb; intake uuid; draft uuid; canonical uuid; result_receipt jsonb;
begin
  select * into current_row from public.native_log_drafts where owner_id=p_owner and id=p_id for update;
  if not found or current_row.status='removed' then raise exception 'NATIVE_DRAFT_CLOSED'; end if;
  if current_row.status='submitted' then return current_row.receipt; end if;
  if current_row.revision<>p_revision or current_row.content_digest<>p_digest then raise exception 'REVISION_CONFLICT'; end if;
  if current_row.lease_until>now() then raise exception 'PROCESSING_BUSY'; end if;
  if p_entries is null or p_confirmation is null or p_receipt is null or jsonb_typeof(p_receipt)<>'object' or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 30 or length(p_confirmation) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
  if p_mode='personal' then
    if not exists(select 1 from public.member_log_access where owner_id=p_owner and onboarded_at is not null) then raise exception 'UNAUTHORIZED'; end if;
    for entry in select value from jsonb_array_elements(p_entries) loop
      perform public.save_value_log_member_entry(p_owner,(entry->>'id')::uuid,0,(entry->>'date')::date,(entry->>'node')::public.wellbeing_node,entry->'content',false);
    end loop;
  elsif p_mode='pilot' then
    if exists(select 1 from public.member_log_access where owner_id=p_owner)
      or not exists(select 1 from public.member_identity_bindings where owner_id=p_owner and did='did:iov:member:10000000-0000-4000-8000-000000000001') then raise exception 'UNAUTHORIZED'; end if;
    insert into public.intake_sessions(owner_id,source,parser_version,idempotency_key,timezone,narrative_ciphertext,narrative_iv,narrative_auth_tag,narrative_key_version,narrative_digest)
      values(p_owner,'native_voice','native-sarvam-v1','native:'||p_owner::text||':'||p_id::text,p_receipt->>'timezone',p_narrative->>'ciphertext',p_narrative->>'iv',p_narrative->>'authTag',(p_narrative->>'keyVersion')::integer,p_narrative->>'digest') returning id into intake;
    for entry in select value from jsonb_array_elements(p_entries) loop
      insert into public.draft_slices(id,intake_session_id,owner_id,machine_source,start_at,end_at,timezone,activity,proof,wellbeing_node,slice_type,community,sao_lane,native_skill_level,impact_direction,impact_intensity,confidence,activity_occurrence_id,status)
        values((entry->>'draft_id')::uuid,intake,p_owner,'native_voice',(entry->>'start_at')::timestamptz,(entry->>'end_at')::timestamptz,entry->>'timezone',entry->>'activity',entry->>'proof',(entry->>'wellbeing_node')::public.wellbeing_node,(entry->>'slice_type')::public.slice_type,(entry->>'community')::public.community_code,(entry->>'sao_lane')::public.sao_lane,entry->>'native_skill_level',(entry->>'impact_direction')::public.impact_direction,(entry->>'impact_intensity')::public.impact_intensity,(entry->>'confidence')::public.observation_confidence,(entry->>'activity_occurrence_id')::uuid,'observer_approved') returning id into draft;
      insert into public.canonical_slices(id,protocol_link_id,revision_number,draft_slice_id,owner_id,start_at,end_at,timezone,activity,proof,wellbeing_node,slice_type,community,sao_lane,native_skill_level,impact_direction,impact_intensity,confidence,activity_occurrence_id,status)
        values((entry->>'id')::uuid,(entry->>'protocol_link_id')::uuid,1,draft,p_owner,(entry->>'start_at')::timestamptz,(entry->>'end_at')::timestamptz,entry->>'timezone',entry->>'activity',entry->>'proof',(entry->>'wellbeing_node')::public.wellbeing_node,(entry->>'slice_type')::public.slice_type,(entry->>'community')::public.community_code,(entry->>'sao_lane')::public.sao_lane,entry->>'native_skill_level',(entry->>'impact_direction')::public.impact_direction,(entry->>'impact_intensity')::public.impact_intensity,(entry->>'confidence')::public.observation_confidence,(entry->>'activity_occurrence_id')::uuid,'validation_pending') returning id into canonical;
      insert into public.observer_events(draft_slice_id,canonical_slice_id,owner_id,actor_id,decision,rationale) values(draft,canonical,p_owner,p_owner,'approved','Confirmed in Value Log: '||p_confirmation);
    end loop;
  else raise exception 'UNAUTHORIZED'; end if;
  result_receipt:=p_receipt||jsonb_build_object('intakeId',intake);
  update public.native_log_drafts set status='submitted',submitted_at=now(),updated_at=now(),revision=revision+1,lease_token=null,lease_until=null,receipt=result_receipt,intake_session_id=intake where owner_id=p_owner and id=p_id;
  insert into public.audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
    values(p_owner,p_owner,'observer','native_log_confirmed','native_log_draft',p_id::text,jsonb_build_object('revision',p_revision,'count',jsonb_array_length(p_entries),'mode',p_mode,'confirmation_channel','native_value_log'));
  return result_receipt;
end $$;

create function public.remove_native_log_draft(p_owner uuid,p_id uuid,p_revision integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_row public.native_log_drafts;
begin
  select * into current_row from public.native_log_drafts where owner_id=p_owner and id=p_id for update;
  if not found then raise exception 'UNAUTHORIZED'; end if;
  if current_row.status='removed' then return true; end if;
  if current_row.revision<>p_revision then raise exception 'REVISION_CONFLICT'; end if;
  update public.native_log_drafts set status='removed',content_ciphertext=null,content_iv=null,content_auth_tag=null,content_key_version=null,
    lease_token=null,lease_until=null,removed_at=now(),updated_at=now(),revision=revision+1 where owner_id=p_owner and id=p_id;
  insert into public.audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
    values(p_owner,p_owner,'observer','native_log_draft_removed','native_log_draft',p_id::text,'{}');
  return true;
end $$;

-- Erasing an intake's source narrative also erases its native draft copy.
create function public.clear_native_source_copy() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.native_log_drafts set status='removed',content_ciphertext=null,content_iv=null,content_auth_tag=null,content_key_version=null,
    lease_token=null,lease_until=null,removed_at=now(),updated_at=now(),revision=revision+1
    where owner_id=new.owner_id and intake_session_id=new.id and status<>'removed';
  return new;
end $$;
create trigger clear_native_source_copy after update of narrative_deleted_at on public.intake_sessions
  for each row when (new.narrative_deleted_at is not null) execute function public.clear_native_source_copy();

revoke all on function public.save_native_log_draft(uuid,uuid,integer,jsonb,uuid),public.reserve_native_log_processing(uuid,uuid,integer),public.release_native_log_processing(uuid,uuid,uuid),public.confirm_native_log(uuid,uuid,integer,text,text,jsonb,jsonb,text,jsonb),public.remove_native_log_draft(uuid,uuid,integer),public.guard_native_timeline_boundary(),public.clear_native_source_copy() from public,anon,authenticated;
grant execute on function public.save_native_log_draft(uuid,uuid,integer,jsonb,uuid),public.reserve_native_log_processing(uuid,uuid,integer),public.release_native_log_processing(uuid,uuid,uuid),public.confirm_native_log(uuid,uuid,integer,text,text,jsonb,jsonb,text,jsonb),public.remove_native_log_draft(uuid,uuid,integer) to service_role;
commit;
