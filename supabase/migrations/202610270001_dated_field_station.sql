-- Additive candidate only. Rehearse and restore-test before applying remotely.
-- Existing founder and v1 cohort policies, records and receipts are untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.native_log_drafts add column approved_source_retained boolean not null default false;
alter table public.native_log_drafts drop constraint native_log_drafts_check;
alter table public.native_log_drafts add constraint native_log_drafts_content_state check(
 (status='removed' and not approved_source_retained and content_ciphertext is null and content_iv is null and content_auth_tag is null and content_key_version is null)
 or ((status<>'removed' or approved_source_retained) and content_ciphertext is not null and content_iv is not null and content_auth_tag is not null and content_key_version is not null));
insert into public.cohort_policies(id,content) values
 ('field-station-oct26-28-700-v1','{"initial":700,"status":"provisional","assessment":"non_performance_only","boundary":"2026-10-26T00:00:00+05:30","window_start":"2026-10-26T00:00:00+05:30","window_end_exclusive":"2026-10-29T00:00:00+05:30","timezone":"Asia/Kolkata","calculation_version":"field-station-non-performance-v1-fixed12","arithmetic_source":"founder-wellbeing-v0.1.1-fixed12","maximum_members":null,"weights":{"Physiology":0.2,"Emotion":0.1,"Feeling":0.1,"Thought":0.2,"Habit":0.1,"Performance":0.3},"performance_assumed":700,"valuation":"unavailable","assurance":"participant_report_automated_policy_review"}'),
 ('field-station-oct26-28-qa-v1','{"initial":700,"status":"provisional","assessment":"non_performance_only","qa_only":true,"boundary":"2026-10-26T00:00:00+05:30","timezone":"Asia/Kolkata","calculation_version":"field-station-non-performance-v1-fixed12","maximum_members":null,"performance_assumed":700,"valuation":"unavailable"}');

-- QA uses identical assumptions and arithmetic with an explicit non-production label.
update public.cohort_policies set content=(select content || '{"qa_only":true}'::jsonb from public.cohort_policies where id='field-station-oct26-28-700-v1') where id='field-station-oct26-28-qa-v1';
update public.cohort_policies set content=content || '{"terms_version":"dated-700-non-performance-v1"}'::jsonb where id in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1');

alter table public.cohort_invitations
 add column policy_id text not null default 'field-station-assumed-700-v1' references public.cohort_policies(id),
 add column eligible_owner uuid references public.members(id),
 add column eligibility_basis jsonb,
 add column assigned_house text references public.cohort_communities(id);
create unique index cohort_account_policy_eligibility on public.cohort_invitations(eligible_owner,policy_id) where eligible_owner is not null;
create unique index cohort_dated_did_eligibility on public.cohort_invitations(target_did,policy_id) where target_did is not null and policy_id in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1');

-- Only server-verified admission/auth timestamps qualify. Never infer a name or gender.
-- The token_hash below is a non-redeemable uniqueness marker: admission is verified-DID-bound.
-- Use built-in UUID randomness so restricted functions do not depend on pgcrypto schema placement.
create function public.record_dated_field_station_eligibility(p_owner uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_did text; v_admission timestamptz; v_signin timestamptz;
begin
 if cohort_is_admin(p_owner) then return false; end if;
 select b.did,a.admitted_at,coalesce((select min(ev.created_at) from audit_events ev where ev.owner_id=a.owner_id and ev.event_type='wellbeing_identity_sign_in' and ev.created_at>='2026-10-26T00:00:00+05:30' and ev.created_at<'2026-10-29T00:00:00+05:30'),nullif(to_jsonb(u)->>'last_sign_in_at','')::timestamptz)
 into v_did,v_admission,v_signin from member_log_access a
 join member_identity_bindings b on b.owner_id=a.owner_id join auth.users u on u.id=a.owner_id where a.owner_id=p_owner;
 if not found then return false; end if;
 if exists(select 1 from cohort_invitations where eligible_owner=p_owner and policy_id='field-station-oct26-28-700-v1') then return true; end if;
 if not (coalesce(v_admission>='2026-10-26T00:00:00+05:30' and v_admission<'2026-10-29T00:00:00+05:30',false)
   or coalesce(v_signin>='2026-10-26T00:00:00+05:30' and v_signin<'2026-10-29T00:00:00+05:30',false)) then return false; end if;
 insert into cohort_invitations(id,token_hash,target_did,community_ids,expires_at,created_by,policy_id,eligible_owner,eligibility_basis)
 values(gen_random_uuid(),encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),v_did,'{}','2100-01-01',p_owner,'field-station-oct26-28-700-v1',p_owner,
 jsonb_build_object('source','verified_admission_or_auth','admitted_at',v_admission,'last_sign_in_at',v_signin,'recorded_at',now())) on conflict do nothing;
 return true;
end $$;



create function public.enroll_dated_field_station(p_owner uuid,p_policy text,p_consent boolean,p_values boolean,p_house text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare inv cohort_invitations; existing cohort_enrollments; v_did text;
begin
 if p_policy not in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1') or cohort_is_admin(p_owner) then raise exception 'UNAUTHORIZED'; end if;
 perform 1 from members where id=p_owner for update;
 select did into v_did from member_identity_bindings where owner_id=p_owner;
 if not found or not exists(select 1 from member_log_access where owner_id=p_owner and onboarded_at is not null) then raise exception 'UNAUTHORIZED'; end if;
 select * into existing from cohort_enrollments where owner_id=p_owner for update;
 if found then
   if existing.policy_id<>p_policy then raise exception 'POLICY_ALREADY_ACCEPTED'; end if;
   return jsonb_build_object('enrolled',true,'policy',existing.policy_id);
 end if;
 select * into inv from cohort_invitations where eligible_owner=p_owner and policy_id=p_policy and target_did=v_did for update;
 if not found or inv.revoked_at is not null or inv.expires_at<=now() or inv.redeemed_by is not null and inv.redeemed_by<>p_owner then raise exception 'INVITATION_UNAVAILABLE'; end if;
 if p_consent is distinct from true or p_values is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
 -- An unassigned member may deliberately accept Bros or continue privately.
 -- Sis requires an operator-bound DID, including the separately labelled QA account.
 if p_house is distinct from coalesce(inv.assigned_house,'house_of_bros') then raise exception 'HOUSE_ASSIGNMENT_REQUIRED'; end if;
 if not exists(select 1 from cohort_communities where id=p_house and active and kind='wellbecoming') then raise exception 'MEMBERSHIP_REQUIRED'; end if;
 insert into cohort_enrollments(owner_id,did,policy_id,house_id,timezone,boundary_at,consent_at,review_consent)
 values(p_owner,v_did,p_policy,p_house,'Asia/Kolkata','2026-10-26T00:00:00+05:30',now(),true);
 insert into cohort_memberships(owner_id,community_id,invitation_id) values(p_owner,p_house,inv.id);
 insert into cohort_reviewer_delegations(owner_id,actor_id,policy_id) values(p_owner,'system:field-station-reviewer:v1',p_policy);
 update cohort_invitations set redeemed_by=p_owner,redeemed_at=now() where id=inv.id;
 insert into audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
 values(p_owner,p_owner,'observer','dated_cohort_accepted','cohort',p_owner::text,jsonb_build_object('policy',p_policy,'house',p_house,'assumed_initial',700,'terms_version','dated-700-non-performance-v1'));
 return jsonb_build_object('enrolled',true,'policy',p_policy);
end $$;

-- Persist provable historical eligibility once; no enrollment or score is created.
do $$ declare m record; begin
 for m in select owner_id from member_log_access loop perform record_dated_field_station_eligibility(m.owner_id); end loop;
end $$;

-- Structured dates and references only. Words remain in the existing encrypted
-- approved source. No arbitrary-note parsing and no per-person infrastructure.
create table public.native_log_day_index (
 owner_id uuid not null references public.members(id), native_draft_id uuid not null,
 occurrence_id uuid not null, activity_id uuid not null, source_id uuid not null,
 source_kind text not null check(source_kind in ('native','member','cohort','adopted')),
 start_at timestamptz, end_at timestamptz, note_date date,
 outcome text not null check(outcome in ('pending','clarification','unassessed')),
 approved_revision integer not null, created_at timestamptz not null default now(), superseded_at timestamptz, member_entry_ids uuid[] not null default '{}',
 primary key(owner_id,native_draft_id,occurrence_id),
 foreign key(owner_id,native_draft_id) references public.native_log_drafts(owner_id,id),
 check((start_at is null and end_at is null and note_date is not null) or (start_at is not null and end_at is not null and end_at>start_at and note_date is null))
);
create index native_log_day_owner_time on public.native_log_day_index(owner_id,start_at,end_at);
create unique index native_log_day_source on public.native_log_day_index(owner_id,source_id);
alter table public.native_log_day_index enable row level security;
revoke all on public.native_log_day_index from anon,authenticated;
grant select on public.native_log_day_index to authenticated;
grant all on public.native_log_day_index to service_role;
create policy native_log_day_owner_read on public.native_log_day_index for select to authenticated using(owner_id=auth.uid());
create table public.cohort_source_links(owner_id uuid not null references members(id),policy_id text not null references cohort_policies(id),source_id uuid not null,kind text not null check(kind in ('adoption','continuation')),approved_draft_id uuid not null,created_at timestamptz not null default now(),primary key(owner_id,policy_id,source_id,kind),foreign key(owner_id,approved_draft_id) references native_log_drafts(owner_id,id));
alter table public.cohort_source_links enable row level security;
revoke all on public.cohort_source_links from public,anon,authenticated;
grant select on public.cohort_source_links to authenticated;
grant all on public.cohort_source_links to service_role;
create policy cohort_source_links_owner_read on public.cohort_source_links for select to authenticated using(owner_id=auth.uid());

create function public.index_legacy_native_day(p_owner uuid,p_id uuid,p_entries jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare d native_log_drafts; item jsonb; ref jsonb; added integer:=0;
begin
 select * into d from native_log_drafts where owner_id=p_owner and id=p_id for update;
 if not found or d.status<>'submitted' or d.receipt->>'kind'<>'unassessed' or d.receipt->>'dayIndexVersion'='1' then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from member_log_access where owner_id=p_owner) or jsonb_array_length(p_entries) not between 1 and 30 then raise exception 'UNAUTHORIZED'; end if;
 for item in select value from jsonb_array_elements(p_entries) loop
  for ref in select value from jsonb_array_elements(item->'memberEntryIds') loop
   if not (d.receipt->'ids' ? (ref#>>'{}')) or not exists(select 1 from member_activity_entries where owner_id=p_owner and id=(ref#>>'{}')::uuid) then raise exception 'LEGACY_INDEX_REVIEW_REQUIRED'; end if;
  end loop;
  if (item->>'sourceId') is distinct from item->'memberEntryIds'->>0 then raise exception 'INVALID_INPUT'; end if;
  insert into native_log_day_index(owner_id,native_draft_id,occurrence_id,activity_id,source_id,source_kind,start_at,end_at,outcome,approved_revision,member_entry_ids)
  values(p_owner,p_id,(item->>'occurrenceId')::uuid,(item->>'activityId')::uuid,(item->>'sourceId')::uuid,'member',(item->>'start')::timestamptz,(item->>'end')::timestamptz,'unassessed',d.revision-1,array(select value::uuid from jsonb_array_elements_text(item->'memberEntryIds'))) on conflict do nothing;
  if found then added=added+1; end if;
 end loop;
 return added;
end $$;
revoke all on function public.index_legacy_native_day(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.index_legacy_native_day(uuid,uuid,jsonb) to service_role;

-- One durable scheduler cursor, not a table per person/community. A timed-out
-- sweep resumes after the last processed batch instead of starving later IDs.
create table public.cohort_queue_state(singleton boolean primary key default true check(singleton), owner_cursor uuid, lease_token uuid, lease_until timestamptz);
insert into public.cohort_queue_state(singleton) values(true);
alter table public.cohort_queue_state enable row level security;
revoke all on public.cohort_queue_state from public,anon,authenticated;
grant all on public.cohort_queue_state to service_role;
create function public.claim_cohort_queue_cursor(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare state cohort_queue_state;
begin
 select * into state from cohort_queue_state where singleton for update;
 if state.lease_until>now() then return null; end if;
 update cohort_queue_state set lease_token=p_token,lease_until=now()+interval '55 seconds' where singleton;
 return jsonb_build_object('cursor',state.owner_cursor);
end $$;
create function public.advance_cohort_queue_cursor(p_token uuid,p_cursor uuid,p_release boolean) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update cohort_queue_state set owner_cursor=p_cursor,lease_token=case when p_release then null else p_token end,lease_until=case when p_release then null else lease_until end where singleton and lease_token=p_token and lease_until>now();
 return found;
end $$;
revoke all on function public.claim_cohort_queue_cursor(uuid),public.advance_cohort_queue_cursor(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_cohort_queue_cursor(uuid),public.advance_cohort_queue_cursor(uuid,uuid,boolean) to service_role;

create function public.confirm_member_day_log(p_owner uuid,p_id uuid,p_revision integer,p_digest text,p_confirmation text,p_entries jsonb,p_receipt jsonb,p_continues uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d native_log_drafts; item jsonb; prior_index native_log_day_index;
begin
 perform 1 from member_log_access where owner_id=p_owner and onboarded_at is not null for update;
 if not found or exists(select 1 from cohort_enrollments where owner_id=p_owner and (policy_id not in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1') or active and review_consent)) then raise exception 'UNAUTHORIZED'; end if;
 select * into d from native_log_drafts where owner_id=p_owner and id=p_id for update;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 if d.status='submitted' then return d.receipt; end if;
 if d.status<>'draft' or d.revision<>p_revision or d.content_digest<>p_digest or d.lease_until>now() then raise exception 'REVISION_CONFLICT'; end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 30 or length(trim(p_confirmation)) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 if p_continues is not null then
  select * into prior_index from native_log_day_index where owner_id=p_owner and source_id=p_continues and superseded_at is null for update;
  if not found or jsonb_array_length(p_entries)<>1 or (p_entries->0->>'occurrenceId')::uuid<>prior_index.occurrence_id then raise exception 'REVISION_CONFLICT'; end if;
 end if;
 for item in select value from jsonb_array_elements(p_entries) loop
  if (item->>'start' is null)<>(item->>'end' is null) or (item->>'end')::timestamptz<=(item->>'start')::timestamptz or (item->>'end')::timestamptz>now() then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from native_log_day_index where owner_id=p_owner and occurrence_id=(item->>'occurrenceId')::uuid and superseded_at is null) and p_continues is null then raise exception 'REVISION_CONFLICT'; end if;
  update native_log_day_index set superseded_at=now() where owner_id=p_owner and occurrence_id=(item->>'occurrenceId')::uuid and superseded_at is null;
  insert into native_log_day_index(owner_id,native_draft_id,occurrence_id,activity_id,source_id,source_kind,start_at,end_at,note_date,outcome,approved_revision)
  values(p_owner,p_id,(item->>'occurrenceId')::uuid,(item->>'occurrenceId')::uuid,(item->>'id')::uuid,'native',(item->>'start')::timestamptz,(item->>'end')::timestamptz,case when item->>'start' is null then (item->>'date')::date else null end,'unassessed',p_revision);
 end loop;
 update native_log_drafts set status='submitted',submitted_at=now(),receipt=p_receipt,revision=revision+1,lease_token=null,lease_until=null,updated_at=now() where owner_id=p_owner and id=p_id;
 insert into audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
 values(p_owner,p_owner,'observer','member_day_log_confirmed','native_log',p_id::text,jsonb_build_object('count',jsonb_array_length(p_entries),'confirmation_digest',encode(sha256(convert_to(p_confirmation,'UTF8')),'hex')));
 return p_receipt;
end $$;
revoke all on function public.confirm_member_day_log(uuid,uuid,integer,text,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.confirm_member_day_log(uuid,uuid,integer,text,text,jsonb,jsonb,uuid) to service_role;

revoke all on function public.record_dated_field_station_eligibility(uuid),public.enroll_dated_field_station(uuid,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.record_dated_field_station_eligibility(uuid),public.enroll_dated_field_station(uuid,text,boolean,boolean,text) to service_role;

-- Referenced approved evidence is retained once in the existing encrypted source.
-- Removal hides its draft listing; legacy source erasure remains unchanged.
create or replace function public.remove_native_log_draft(p_owner uuid,p_id uuid,p_revision integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_row public.native_log_drafts; keep_source boolean; removed_indexes integer;
begin
 perform 1 from public.cohort_enrollments where owner_id=p_owner for update;
 select * into current_row from public.native_log_drafts where owner_id=p_owner and id=p_id for update;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 if current_row.status='removed' then return true; end if;
 if current_row.revision<>p_revision then raise exception 'REVISION_CONFLICT'; end if;
 keep_source=coalesce(current_row.receipt->>'sourceReferenced'='true',false) and exists(select 1 from public.cohort_records where owner_id=p_owner and native_draft_id=p_id);
 update public.native_log_drafts set status='removed',
 approved_source_retained=keep_source,
 content_ciphertext=case when keep_source then content_ciphertext else null end,
 content_iv=case when keep_source then content_iv else null end,
 content_auth_tag=case when keep_source then content_auth_tag else null end,
 content_key_version=case when keep_source then content_key_version else null end,
 lease_token=null,lease_until=null,removed_at=now(),updated_at=now(),revision=revision+1 where owner_id=p_owner and id=p_id;
 if not keep_source and current_row.receipt->>'dayIndexVersion'='1' then
  update public.native_log_day_index set superseded_at=now() where owner_id=p_owner and native_draft_id=p_id and superseded_at is null;
  get diagnostics removed_indexes=row_count;
  if removed_indexes>0 then update public.cohort_enrollments set revision=revision+1 where owner_id=p_owner and policy_id in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1');end if;
 end if;
 insert into public.audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
 values(p_owner,p_owner,'observer','native_log_draft_removed','native_log_draft',p_id::text,jsonb_build_object('approved_source_retained',keep_source));
 return true;
end $$;

-- Preserve the legacy ten-place rule within its own policy, not across new policies.
create or replace function public.cohort_command(p_actor uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare inv cohort_invitations; enr cohort_enrollments; rec cohort_records; entry jsonb; v_owner uuid; v_id uuid; v_house text; v_inv uuid;
begin
 if not consume_ingestion_rate_limit('cohort-command:'||p_actor||':'||to_char(now(),'YYYYMMDDHH24MI'),60) then raise exception 'RATE_LIMITED'; end if;
 if p_action in ('create_community','invite','revoke_invite','human_review','assign_operator','revoke_membership') and not cohort_is_admin(p_actor) then raise exception 'UNAUTHORIZED'; end if;
 if p_action='assign_operator' then
   if not exists(select 1 from member_identity_bindings where did=p_input->>'did') then raise exception 'INVALID_INPUT'; end if;
   update cohort_agents set operator_did=p_input->>'did',active=false,accepted_at=null,version=version+1 where id='system:field-station-reviewer:v1';
 elsif p_action='accept_operator' then
   if p_input->>'consent' is distinct from 'true' then raise exception 'CONSENT_REQUIRED'; end if;
   update cohort_agents set accepted_at=now(),active=true,version=version+1 where id='system:field-station-reviewer:v1' and operator_did=(select did from member_identity_bindings where owner_id=p_actor);
   if not found then raise exception 'UNAUTHORIZED'; end if;
 elsif p_action='agent_pause' then
   update cohort_agents set active=(p_input->>'active')::boolean,version=version+1 where id='system:field-station-reviewer:v1' and accepted_at is not null and (cohort_is_admin(p_actor) or operator_did=(select did from member_identity_bindings where owner_id=p_actor));
   if not found then raise exception 'UNAUTHORIZED'; end if;
 elsif p_action='request_community' then
   if not exists(select 1 from member_log_access where owner_id=p_actor and onboarded_at is not null) then raise exception 'UNAUTHORIZED'; end if;
   insert into audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata) values(p_actor,p_actor,'observer','cohort_community_requested','cohort',p_actor::text,jsonb_build_object('content',p_input->'content'));
 elsif p_action='accept_memberships' then
   select * into enr from cohort_enrollments where owner_id=p_actor for update;
   if not found or p_input->>'consent' is distinct from 'true' then raise exception 'UNAUTHORIZED'; end if;
   select * into inv from cohort_invitations where token_hash=p_input->>'hash' for update;
   if not found or inv.revoked_at is not null or inv.expires_at<=now() or inv.redeemed_by is not null and inv.redeemed_by<>p_actor then raise exception 'INVITATION_UNAVAILABLE'; end if;
   if inv.target_did is not null and inv.target_did<>enr.did then raise exception 'UNAUTHORIZED'; end if;
   for entry in select value from jsonb_array_elements(p_input->'communities') loop
    if not (entry #>> '{}'=any(inv.community_ids)) or not exists(select 1 from cohort_communities where id=entry #>> '{}' and active and (kind='work' or id=enr.house_id)) then raise exception 'INVALID_INPUT'; end if;
    insert into cohort_memberships(owner_id,community_id,invitation_id) values(p_actor,entry #>> '{}',inv.id) on conflict do nothing;
   end loop;
   if p_input->'communities' ? enr.house_id then
    update cohort_reviewer_delegations set revoked_at=now() where owner_id=p_actor and revoked_at is null;
    insert into cohort_reviewer_delegations(owner_id,actor_id,policy_id) values(p_actor,'system:field-station-reviewer:v1',enr.policy_id);
    update cohort_enrollments set active=true,review_consent=true where owner_id=p_actor;
   end if;
   update cohort_invitations set redeemed_by=p_actor,redeemed_at=now() where id=inv.id;
   update cohort_enrollments set revision=revision+1,permissions_revision=permissions_revision+1 where owner_id=p_actor;
 elsif p_action in ('leave_membership','revoke_membership') then
   v_owner=case when p_action='leave_membership' then p_actor else (p_input->>'owner')::uuid end;
   select * into enr from cohort_enrollments where owner_id=v_owner for update;
   if not found then raise exception 'UNAUTHORIZED'; end if;
   -- Leaving the Wellbecoming community pauses the pilot; history remains intact.
   update cohort_memberships set revoked_at=now() where owner_id=v_owner and community_id=p_input->>'community' and revoked_at is null;
   if not found then raise exception 'INVALID_INPUT'; end if;
   update cohort_enrollments set revision=revision+1,permissions_revision=permissions_revision+1,
    active=case when house_id=p_input->>'community' then false else active end,
    review_consent=case when house_id=p_input->>'community' then false else review_consent end where owner_id=v_owner;
   if enr.house_id=p_input->>'community' then update cohort_reviewer_delegations set revoked_at=now() where owner_id=v_owner and revoked_at is null;end if;
 elsif p_action='create_community' then
   insert into cohort_communities(id,name,kind) values(p_input->>'id',p_input->>'name',p_input->>'kind');
 elsif p_action='invite' then
   if jsonb_array_length(p_input->'communities')>20 then raise exception 'INVALID_INPUT'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_input->'communities') x where not exists(select 1 from cohort_communities c where c.id=x and c.active)) then raise exception 'INVALID_INPUT'; end if;
   insert into cohort_invitations(id,token_hash,target_did,community_ids,expires_at,created_by)
   values((p_input->>'id')::uuid,p_input->>'hash',nullif(p_input->>'did',''),array(select jsonb_array_elements_text(p_input->'communities')),now()+interval '7 days',p_actor);
 elsif p_action='revoke_invite' then
   update cohort_invitations set revoked_at=now() where id=(p_input->>'id')::uuid;
 elsif p_action='enroll' then
   perform 1 from cohort_policies where id='field-station-assumed-700-v1' for update;
   if cohort_is_admin(p_actor) or not exists(select 1 from member_log_access where owner_id=p_actor and onboarded_at is not null) then raise exception 'UNAUTHORIZED'; end if;
   select * into inv from cohort_invitations where token_hash=p_input->>'hash' for update;
   if not found or inv.revoked_at is not null or inv.expires_at<=now() or inv.redeemed_by is not null and inv.redeemed_by<>p_actor then raise exception 'INVITATION_UNAVAILABLE'; end if;
   if inv.target_did is not null and not exists(select 1 from member_identity_bindings where owner_id=p_actor and did=inv.target_did) then raise exception 'UNAUTHORIZED'; end if;
   select * into enr from cohort_enrollments where owner_id=p_actor for update;
   if found then return jsonb_build_object('enrolled',true); end if;
   if (select count(*) from cohort_enrollments where policy_id='field-station-assumed-700-v1')>=10 then raise exception 'COHORT_FULL'; end if;
   if p_input->>'consent' is distinct from 'true' or p_input->>'startingValuesConfirmed' is distinct from 'true' then raise exception 'CONSENT_REQUIRED'; end if;
   v_house=p_input->>'house';
   if not exists(select 1 from cohort_communities where id=v_house and kind='wellbecoming' and active) then raise exception 'INVALID_INPUT'; end if;
   insert into cohort_enrollments(owner_id,did,policy_id,house_id,timezone,boundary_at,consent_at,review_consent)
    select p_actor,did,'field-station-assumed-700-v1',v_house,m.timezone,date_trunc('day',now() at time zone m.timezone) at time zone m.timezone,now(),true
    from member_identity_bindings b join members m on m.id=b.owner_id where b.owner_id=p_actor;
   insert into cohort_memberships(owner_id,community_id,invitation_id) values(p_actor,v_house,inv.id);
   for entry in select value from jsonb_array_elements(p_input->'communities') loop
     if not (entry #>> '{}'=any(inv.community_ids)) or not exists(select 1 from cohort_communities where id=entry #>> '{}' and kind='work' and active) then raise exception 'INVALID_INPUT'; end if;
     insert into cohort_memberships(owner_id,community_id,invitation_id) values(p_actor,entry #>> '{}',inv.id) on conflict do nothing;
   end loop;
   insert into cohort_reviewer_delegations(owner_id,actor_id,policy_id) values(p_actor,'system:field-station-reviewer:v1','field-station-assumed-700-v1');
   if p_input->'salary' is not null and p_input->'salary'<>'null'::jsonb then
     insert into cohort_rate_policies(id,owner_id,effective_at,content) select (p_input->>'rateId')::uuid,p_actor,boundary_at,p_input->'salary' from cohort_enrollments where owner_id=p_actor;
   end if;
   update cohort_invitations set redeemed_by=p_actor,redeemed_at=now() where id=inv.id;
 elsif p_action='consent' then
   select * into enr from cohort_enrollments where owner_id=p_actor for update;
   if not found then raise exception 'UNAUTHORIZED'; end if;
   if (p_input->>'consent')::boolean and not exists(select 1 from cohort_memberships where owner_id=p_actor and community_id=enr.house_id and revoked_at is null) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
   update cohort_enrollments set review_consent=(p_input->>'consent')::boolean,active=(p_input->>'consent')::boolean,revision=revision+1,permissions_revision=permissions_revision+1 where owner_id=p_actor;
   update cohort_reviewer_delegations set revoked_at=now() where owner_id=p_actor and revoked_at is null;
   if (p_input->>'consent')::boolean then insert into cohort_reviewer_delegations(owner_id,actor_id,policy_id) values(p_actor,'system:field-station-reviewer:v1',enr.policy_id); end if;
 elsif p_action='rate' then
   select * into enr from cohort_enrollments where owner_id=p_actor and active for update;
   if not found then raise exception 'UNAUTHORIZED'; end if;
   insert into cohort_rate_policies(id,owner_id,effective_at,content) values((p_input->>'id')::uuid,p_actor,now(),p_input->'content');
   update cohort_enrollments set revision=revision+1 where owner_id=p_actor;
 elsif p_action='appeal' then
   perform 1 from cohort_enrollments where owner_id=p_actor for update;
   if not found then raise exception 'UNAUTHORIZED';end if;
   select * into rec from cohort_records where id=(p_input->>'recordId')::uuid and owner_id=p_actor for update;
   if not found or rec.review_status='superseded' then raise exception 'UNAUTHORIZED'; end if;
   insert into cohort_review_events(id,owner_id,record_id,actor_id,policy_id,outcome,input_digest,content)
    values((p_input->>'id')::uuid,p_actor,rec.id,'member:'||p_actor,rec.policy_id,'appealed',rec.content->>'digest',p_input->'content');
   update cohort_records set review_status='escalated',lease_token=null,lease_until=null where id=rec.id;
   update cohort_enrollments set revision=revision+1 where owner_id=p_actor;
 elsif p_action='human_review' then
   select owner_id into v_owner from cohort_records where id=(p_input->>'recordId')::uuid;
   select * into enr from cohort_enrollments where owner_id=v_owner for update;
   select * into rec from cohort_records where id=(p_input->>'recordId')::uuid and owner_id=v_owner for update;
   if rec.id is null or not enr.active or not enr.review_consent or rec.review_status not in ('escalated','clarification') then raise exception 'UNAUTHORIZED'; end if;
   if (p_input->>'permissionsRevision')::integer is distinct from enr.permissions_revision then raise exception 'REVISION_CONFLICT';end if;
   if p_input->>'digest'<>rec.content->>'digest' then raise exception 'REVISION_CONFLICT'; end if;
   insert into cohort_review_events(id,owner_id,record_id,actor_id,policy_id,outcome,input_digest,content)
    values((p_input->>'id')::uuid,rec.owner_id,rec.id,'member:'||p_actor,rec.policy_id,'reviewed',rec.content->>'digest',p_input->'content');
   update cohort_records set review_status='reviewed',lease_token=null,lease_until=null where id=rec.id;
   update cohort_enrollments set revision=revision+1 where owner_id=rec.owner_id;
 else raise exception 'INVALID_INPUT'; end if;
 insert into audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
 values(p_actor,p_actor,'observer','cohort_'||p_action,'cohort',p_actor::text,'{}');
 return jsonb_build_object('saved',true);
end $$;

-- Confirmation writes the entire approved timeline and its existing native receipt atomically.

-- Approval transaction follows its source/index table definitions.
create function public.designate_dated_account(p_actor uuid,p_did text,p_policy text,p_house text,p_reference text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; invite uuid;
begin
 if not cohort_is_admin(p_actor) or p_policy not in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1') then raise exception 'UNAUTHORIZED'; end if;
 if p_did !~ '^did:iov:member:[0-9a-f-]{36}$' or p_house not in ('house_of_bros','house_of_sis') or p_reference !~ '^[A-Za-z0-9:/._-]{1,160}$' then raise exception 'INVALID_INPUT'; end if;
 select owner_id into target from member_identity_bindings where did=p_did;
 if target is not null and (cohort_is_admin(target) or exists(select 1 from cohort_enrollments where owner_id=target)) then raise exception 'POLICY_ALREADY_ACCEPTED'; end if;
 if p_policy='field-station-oct26-28-700-v1' and target is null then raise exception 'UNAUTHORIZED'; end if;
 insert into cohort_invitations(id,token_hash,target_did,policy_id,eligible_owner,assigned_house,expires_at,created_by,eligibility_basis)
 values(gen_random_uuid(),encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),p_did,p_policy,target,p_house,'2100-01-01',p_actor,jsonb_build_object('source',case when p_policy='field-station-oct26-28-qa-v1' then 'operator_designated_qa' else 'operator_confirmed_historical' end,'reference',p_reference,'recorded_at',now()))
 on conflict(target_did,policy_id) where target_did is not null and policy_id in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1') do update set assigned_house=excluded.assigned_house
 returning id into invite;
 return invite;
end $$;
create function public.bind_qa_member(p_owner uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare did text;
begin
 if cohort_is_admin(p_owner) then return false; end if;
 select b.did into did from member_identity_bindings b join member_log_access a on a.owner_id=b.owner_id where b.owner_id=p_owner;
 if not found then return false; end if;
 update cohort_invitations set eligible_owner=p_owner where target_did=did and policy_id='field-station-oct26-28-qa-v1' and revoked_at is null and expires_at>now() and (eligible_owner is null or eligible_owner=p_owner);
 return found;
end $$;
revoke all on function public.designate_dated_account(uuid,text,text,text,text),public.bind_qa_member(uuid) from public,anon,authenticated;
grant execute on function public.designate_dated_account(uuid,text,text,text,text),public.bind_qa_member(uuid) to service_role;

create function public.complete_minimal_member_setup(p_owner uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare completed timestamptz;
begin
 if cohort_is_admin(p_owner) then return true; end if;
 select onboarded_at into completed from member_log_access where owner_id=p_owner for update;
 if not found then return false; end if;
 perform record_dated_field_station_eligibility(p_owner);
 if completed is not null then return true; end if;
 if not exists(select 1 from member_identity_bindings where owner_id=p_owner) then return false; end if;
 update members set display_name=coalesce(nullif(display_name,''),'Value Log member'),timezone='Asia/Kolkata' where id=p_owner;
 update member_log_access set onboarded_at=now() where owner_id=p_owner;
 insert into audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
 values(p_owner,p_owner,'observer','value_log_minimal_setup','member',p_owner::text,'{"timezone":"Asia/Kolkata"}');
 return true;
end $$;
revoke all on function public.complete_minimal_member_setup(uuid) from public,anon,authenticated;
grant execute on function public.complete_minimal_member_setup(uuid) to service_role;

create function public.confirm_dated_native_log(p_owner uuid,p_id uuid,p_revision integer,p_digest text,p_confirmation text,p_entries jsonb,p_receipt jsonb,p_corrects uuid default null,p_adopts uuid default null,p_continues uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d native_log_drafts; e cohort_enrollments; item jsonb; original cohort_records; outcome text; source native_log_drafts; prior_index native_log_day_index;
begin
 select * into e from cohort_enrollments where owner_id=p_owner for update;
 if not found or e.policy_id not in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1') or not e.active or not e.review_consent then raise exception 'UNAUTHORIZED'; end if;
 if not exists(select 1 from cohort_memberships where owner_id=p_owner and community_id=e.house_id and revoked_at is null) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
 select * into d from native_log_drafts where owner_id=p_owner and id=p_id for update;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 if d.status='submitted' then return d.receipt; end if;
 if d.status<>'draft' or d.revision<>p_revision or d.content_digest<>p_digest or d.lease_until>now() then raise exception 'REVISION_CONFLICT'; end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 30 or length(trim(p_confirmation)) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 if num_nonnulls(p_corrects,p_adopts,p_continues)>1 then raise exception 'INVALID_INPUT'; end if;
 if p_corrects is not null then
  select * into original from cohort_records where owner_id=p_owner and id=p_corrects for update;
  if not found or original.review_status='superseded' or jsonb_array_length(p_entries)<>1 then raise exception 'REVISION_CONFLICT'; end if;
 end if;
 if p_adopts is not null then
  select * into source from native_log_drafts where owner_id=p_owner and id=p_adopts for update;
  if not found or source.status<>'submitted' or source.receipt->>'kind'<>'unassessed' or source.receipt->>'dayIndexVersion'='1' or not (source.receipt->'dates' ? '2026-10-26') then raise exception 'ADOPTION_UNAVAILABLE'; end if;
  if exists(select 1 from cohort_source_links where owner_id=p_owner and policy_id=e.policy_id and source_id=p_adopts and kind='adoption') then raise exception 'ADOPTION_ALREADY_USED'; end if;
  insert into cohort_source_links(owner_id,policy_id,source_id,kind,approved_draft_id) values(p_owner,e.policy_id,p_adopts,'adoption',p_id);
 end if;
 if p_continues is not null then
  select * into prior_index from native_log_day_index where owner_id=p_owner and source_id=p_continues and superseded_at is null for update;
  if not found or exists(select 1 from cohort_records where owner_id=p_owner and id=p_continues) or jsonb_array_length(p_entries)<>1 or (p_entries->0->>'occurrenceId')::uuid<>prior_index.occurrence_id then raise exception 'REVISION_CONFLICT'; end if;
  insert into cohort_source_links(owner_id,policy_id,source_id,kind,approved_draft_id) values(p_owner,e.policy_id,p_continues,'continuation',p_id);
 end if;
 for item in select value from jsonb_array_elements(p_entries) loop
  if (item->>'start' is null)<>(item->>'end' is null) or (item->>'end')::timestamptz<=(item->>'start')::timestamptz or (item->>'end')::timestamptz>now() then raise exception 'INVALID_INPUT'; end if;
  if p_corrects is not null and (item->>'occurrenceId')::uuid<>original.occurrence_id then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from native_log_day_index i where i.owner_id=p_owner and i.superseded_at is null and i.occurrence_id<>(item->>'occurrenceId')::uuid and i.start_at<(item->>'end')::timestamptz and i.end_at>(item->>'start')::timestamptz)
   or exists(select 1 from jsonb_array_elements(p_entries) other where other->>'id'<>item->>'id' and (other->>'start')::timestamptz<(item->>'end')::timestamptz and (other->>'end')::timestamptz>(item->>'start')::timestamptz) then raise exception 'NATIVE_TIMELINE_OVERLAP'; end if;
  outcome=case when item->>'node'='Performance' or (item->>'start')::timestamptz<e.boundary_at then 'unassessed' else item->>'outcome' end;
  if outcome not in ('unassessed','pending','clarification') or outcome is null then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from native_log_day_index where owner_id=p_owner and occurrence_id=(item->>'occurrenceId')::uuid and superseded_at is null) and p_corrects is null and p_continues is null and (p_adopts is null or not exists(select 1 from native_log_day_index where owner_id=p_owner and occurrence_id=(item->>'occurrenceId')::uuid and native_draft_id=p_adopts and superseded_at is null)) then raise exception 'REVISION_CONFLICT'; end if;
  update native_log_day_index set superseded_at=now() where owner_id=p_owner and occurrence_id=(item->>'occurrenceId')::uuid and superseded_at is null;
  if outcome<>'unassessed' and item->>'start' is not null and item->>'node' in ('Physiology','Emotion','Feeling','Thought','Habit') then
   insert into cohort_records(id,owner_id,native_draft_id,occurrence_id,start_at,end_at,content,policy_id,review_status,supersedes,revision)
   values((item->>'id')::uuid,p_owner,p_id,(item->>'occurrenceId')::uuid,(item->>'start')::timestamptz,(item->>'end')::timestamptz,item->'content',e.policy_id,outcome,p_corrects,coalesce(original.revision+1,1));
  end if;
  insert into native_log_day_index(owner_id,native_draft_id,occurrence_id,activity_id,source_id,source_kind,start_at,end_at,note_date,outcome,approved_revision)
  values(p_owner,p_id,(item->>'occurrenceId')::uuid,(item->>'occurrenceId')::uuid,(item->>'id')::uuid,case when outcome='unassessed' or item->>'start' is null or coalesce(item->>'node','') not in ('Physiology','Emotion','Feeling','Thought','Habit') then 'native' else 'cohort' end,(item->>'start')::timestamptz,(item->>'end')::timestamptz,case when item->>'start' is null then (item->>'date')::date else null end,outcome,p_revision);
 end loop;
 if p_corrects is not null then update cohort_records set review_status='superseded',lease_token=null,lease_until=null where id=p_corrects; end if;
 update native_log_drafts set status='submitted',submitted_at=now(),receipt=p_receipt,revision=revision+1,lease_token=null,lease_until=null,updated_at=now() where owner_id=p_owner and id=p_id;
 update cohort_enrollments set revision=revision+1 where owner_id=p_owner;
 insert into audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
 values(p_owner,p_owner,'observer','dated_log_confirmed','native_log',p_id::text,jsonb_build_object('count',jsonb_array_length(p_entries),'confirmation_digest',encode(sha256(convert_to(p_confirmation,'UTF8')),'hex')));
 return p_receipt;
end $$;
revoke all on function public.confirm_dated_native_log(uuid,uuid,integer,text,text,jsonb,jsonb,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_dated_native_log(uuid,uuid,integer,text,text,jsonb,jsonb,uuid,uuid,uuid) to service_role;
-- Authority is checked again at commit, including current House membership.
create or replace function public.claim_cohort_review(p_owner uuid,p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r cohort_records; d cohort_reviewer_delegations;
begin
 perform 1 from cohort_agents where id='system:field-station-reviewer:v1' and active for share;
 if not found then return null; end if;
 perform 1 from cohort_enrollments where owner_id=p_owner and active and review_consent and exists(select 1 from cohort_memberships m join cohort_communities c on c.id=m.community_id where m.owner_id=p_owner and m.community_id=cohort_enrollments.house_id and m.revoked_at is null and c.active) for update;
 if not found then return null; end if;
 select * into d from cohort_reviewer_delegations where owner_id=p_owner and revoked_at is null and actor_id='system:field-station-reviewer:v1' and policy_id=(select policy_id from cohort_enrollments where owner_id=p_owner);
 if not found then return null; end if;
 update cohort_records set lease_token=p_token,lease_until=now()+interval '150 seconds',lease_context_revision=(select permissions_revision from cohort_enrollments where owner_id=p_owner),lease_agent_version=(select version from cohort_agents where id='system:field-station-reviewer:v1')
  where owner_id=p_owner and id=p_id and policy_id=(select policy_id from cohort_enrollments where owner_id=p_owner) and review_status='pending' and coalesce(lease_until,'-infinity')<=now() and coalesce(retry_after,'-infinity')<=now() returning * into r;
 if not found then return null; end if;
 return jsonb_build_object('record',to_jsonb(r),'delegation',to_jsonb(d),'agent',(select to_jsonb(a) from cohort_agents a where a.id='system:field-station-reviewer:v1'));
end $$;
create or replace function public.finish_cohort_review(p_owner uuid,p_id uuid,p_token uuid,p_delegation uuid,p_digest text,p_event uuid,p_outcome text,p_content jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r cohort_records;
begin
 perform 1 from cohort_agents where id='system:field-station-reviewer:v1' and active for share;
 if not found then return false; end if;
 perform 1 from cohort_enrollments where owner_id=p_owner and active and review_consent and exists(select 1 from cohort_memberships m join cohort_communities c on c.id=m.community_id where m.owner_id=p_owner and m.community_id=cohort_enrollments.house_id and m.revoked_at is null and c.active) for update;
 if not found or not exists(select 1 from cohort_reviewer_delegations where id=p_delegation and owner_id=p_owner and revoked_at is null and actor_id='system:field-station-reviewer:v1' and policy_id=(select policy_id from cohort_enrollments where owner_id=p_owner)) then return false; end if;
 select * into r from cohort_records where id=p_id and owner_id=p_owner for update;
 if not found or r.policy_id is distinct from (select policy_id from cohort_enrollments where owner_id=p_owner) or r.review_status<>'pending' or r.lease_token is distinct from p_token or r.lease_until<=now() or r.content->>'digest'<>p_digest or r.lease_context_revision<>(select permissions_revision from cohort_enrollments where owner_id=p_owner) or r.lease_agent_version<>(select version from cohort_agents where id='system:field-station-reviewer:v1') then return false; end if;
 if p_outcome not in ('reviewed','clarification','escalated') then raise exception 'INVALID_INPUT'; end if;
 insert into cohort_review_events(id,owner_id,record_id,actor_id,delegation_id,policy_id,outcome,input_digest,content)
 values(p_event,p_owner,p_id,'system:field-station-reviewer:v1',p_delegation,r.policy_id,p_outcome,p_digest,p_content);
 update cohort_records set review_status=p_outcome,lease_token=null,lease_until=null where id=p_id;
 update cohort_enrollments set revision=revision+1 where owner_id=p_owner;
 return true;
end $$;
commit;
