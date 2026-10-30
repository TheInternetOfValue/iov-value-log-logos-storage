-- Private, experimental cohort ledger. No founder table, policy or historical row is changed.
create table public.cohort_policies (
  id text primary key, content jsonb not null, created_at timestamptz not null default now()
);
insert into public.cohort_policies values ('field-station-assumed-700-v1',
 '{"initial":700,"status":"provisional","maximum_members":10,"salary_divisor":2080,"calculation_version":"field-station-wellbeing-v1-fixed12","arithmetic_source":"founder-wellbeing-v0.1.1-fixed12","weights":{"Physiology":0.2,"Emotion":0.1,"Feeling":0.1,"Thought":0.2,"Habit":0.1,"Performance":0.3},"bounds":[100,1000],"assurance":"participant_report_automated_policy_review","payability":"non_payable","reviewer":"system:field-station-reviewer:v1","operator":"review-operator@example.invalid"}', now());
create table public.cohort_agents (
 id text primary key, operator_label text not null, operator_did text references public.member_identity_bindings(did),
 active boolean not null default false, accepted_at timestamptz, version integer not null default 1,
 check(not active or operator_did is not null and accepted_at is not null)
);
insert into public.cohort_agents(id,operator_label) values('system:field-station-reviewer:v1','review-operator@example.invalid');
create table public.cohort_communities (
  id text primary key check(id ~ '^[a-z][a-z0-9_-]{1,63}$'), name text not null check(length(name) between 1 and 120),
  kind text not null check(kind in ('wellbecoming','work')), active boolean not null default true, created_at timestamptz not null default now()
);
insert into public.cohort_communities(id,name,kind) values
 ('house_of_bros','HouseOfBros','wellbecoming'),('house_of_sis','HouseOfSis','wellbecoming'),
 ('iov','Internet of Value Research Foundation','work'),('gfe','Growth Flow Engineering','work');
create table public.cohort_invitations (
  id uuid primary key, token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'), target_did text,
  community_ids text[] not null default '{}', expires_at timestamptz not null, created_by uuid not null references public.members(id),
  redeemed_by uuid references public.members(id), redeemed_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.cohort_enrollments (
  owner_id uuid primary key references public.members(id), did text not null unique, policy_id text not null references public.cohort_policies(id),
  house_id text not null references public.cohort_communities(id), timezone text not null,
  boundary_at timestamptz not null, consent_at timestamptz not null, review_consent boolean not null,
  revision integer not null default 1, permissions_revision integer not null default 1, calculated_revision integer not null default 0, active boolean not null default true, current_replay_id uuid,
  created_at timestamptz not null default now()
);
create table public.cohort_memberships (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.members(id), community_id text not null references public.cohort_communities(id),
  invitation_id uuid not null references public.cohort_invitations(id), accepted_at timestamptz not null default now(), revoked_at timestamptz,
  unique(owner_id,community_id,invitation_id)
);
create unique index cohort_active_membership on public.cohort_memberships(owner_id,community_id) where revoked_at is null;
create table public.cohort_reviewer_delegations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.cohort_enrollments(owner_id),
  actor_id text not null check(actor_id='system:field-station-reviewer:v1'), policy_id text not null references public.cohort_policies(id),
  granted_at timestamptz not null default now(), revoked_at timestamptz
);
create unique index cohort_active_delegation on public.cohort_reviewer_delegations(owner_id) where revoked_at is null;
create table public.cohort_rate_policies (
  id uuid primary key, owner_id uuid not null references public.cohort_enrollments(owner_id), effective_at timestamptz not null,
  content jsonb not null check(content ? 'ciphertext' and content ? 'iv' and content ? 'authTag' and content ? 'digest'),
  created_at timestamptz not null default now(), unique(owner_id,effective_at)
);
create table public.cohort_records (
  id uuid primary key, owner_id uuid not null references public.cohort_enrollments(owner_id), native_draft_id uuid not null,
  occurrence_id uuid not null, revision integer not null default 1, supersedes uuid references public.cohort_records(id),
  start_at timestamptz not null, end_at timestamptz not null check(end_at>start_at), content jsonb not null,
  policy_id text not null references public.cohort_policies(id), rate_policy_id uuid references public.cohort_rate_policies(id),
  review_status text not null default 'pending' check(review_status in ('pending','clarification','escalated','reviewed','superseded')),
  lease_token uuid, lease_until timestamptz, lease_context_revision integer, lease_agent_version integer, retry_after timestamptz, created_at timestamptz not null default now(),
  check(content ? 'ciphertext' and content ? 'iv' and content ? 'authTag' and content ? 'digest'), unique(owner_id,occurrence_id,revision),
  foreign key(owner_id,native_draft_id) references public.native_log_drafts(owner_id,id)
);
create index cohort_records_owner_time on public.cohort_records(owner_id,start_at,id);
create index cohort_records_queue on public.cohort_records(review_status,retry_after);
create table public.cohort_review_events (
  id uuid primary key, owner_id uuid not null references public.cohort_enrollments(owner_id), record_id uuid not null references public.cohort_records(id),
  actor_id text not null, delegation_id uuid references public.cohort_reviewer_delegations(id), policy_id text not null references public.cohort_policies(id),
  outcome text not null check(outcome in ('clarification','escalated','reviewed','appealed','superseded')), input_digest text not null,
  content jsonb not null check(content ? 'ciphertext' and content ? 'iv' and content ? 'authTag'),
  created_at timestamptz not null default now()
);
create table public.cohort_replay_runs (
  id uuid primary key, owner_id uuid not null references public.cohort_enrollments(owner_id), policy_id text not null references public.cohort_policies(id),
  input_digest text not null, output_digest text not null, verification_passed boolean not null check(verification_passed),
  content jsonb not null check(content ? 'ciphertext' and content ? 'iv' and content ? 'authTag'),
  created_at timestamptz not null default now(), unique(owner_id,input_digest)
);
create index cohort_review_events_owner_record_time on public.cohort_review_events(owner_id,record_id,created_at,id);
alter table public.cohort_enrollments add foreign key(current_replay_id) references public.cohort_replay_runs(id);

create function public.cohort_is_admin(p_actor uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.member_identity_bindings where owner_id=p_actor and did='did:iov:member:10000000-0000-4000-8000-000000000001');
$$;

-- Every mutation is service-only. Owner and administrator are supplied only by verified server sessions.
create function public.cohort_command(p_actor uuid,p_action text,p_input jsonb) returns jsonb
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
   if (select count(*) from cohort_enrollments)>=10 then raise exception 'COHORT_FULL'; end if;
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
create function public.confirm_cohort_log(p_owner uuid,p_id uuid,p_revision integer,p_digest text,p_confirmation text,p_entries jsonb,p_receipt jsonb,p_corrects uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d native_log_drafts; e cohort_enrollments; item jsonb; rid uuid; original cohort_records;
begin
 select * into e from cohort_enrollments where owner_id=p_owner for update;
 if not found or not e.active or not e.review_consent then raise exception 'UNAUTHORIZED'; end if;
 select * into d from native_log_drafts where id=p_id and owner_id=p_owner for update;
 if not found then raise exception 'UNAUTHORIZED'; end if;
 if d.status='submitted' then return d.receipt; end if;
 if d.status<>'draft' or d.revision<>p_revision or d.content_digest<>p_digest or d.lease_until>now() then raise exception 'REVISION_CONFLICT'; end if;
 if length(trim(p_confirmation)) not between 1 and 500 or jsonb_array_length(p_entries) not between 1 and 30 then raise exception 'INVALID_INPUT'; end if;
 if p_corrects is not null then
  select * into original from cohort_records where owner_id=p_owner and id=p_corrects for update;
  if not found or original.review_status='superseded' or jsonb_array_length(p_entries)<>1 then raise exception 'REVISION_CONFLICT'; end if;
 end if;
 for item in select value from jsonb_array_elements(p_entries) loop
   if (item->>'start')::timestamptz<e.boundary_at or (item->>'end')::timestamptz>now() then raise exception 'INVALID_INPUT'; end if;
   if p_corrects is not null and (item->>'occurrenceId')::uuid<>original.occurrence_id then raise exception 'INVALID_INPUT'; end if;
   if exists(select 1 from cohort_records r where r.owner_id=p_owner and (p_corrects is null or r.id<>p_corrects) and r.review_status<>'superseded' and r.start_at<(item->>'end')::timestamptz and r.end_at>(item->>'start')::timestamptz) then raise exception 'NATIVE_TIMELINE_OVERLAP'; end if;
   select id into rid from cohort_rate_policies where owner_id=p_owner and effective_at<=(item->>'start')::timestamptz order by effective_at desc limit 1;
   insert into cohort_records(id,owner_id,native_draft_id,occurrence_id,start_at,end_at,content,policy_id,rate_policy_id,supersedes,revision)
    values((item->>'id')::uuid,p_owner,p_id,(item->>'occurrenceId')::uuid,(item->>'start')::timestamptz,(item->>'end')::timestamptz,item->'content',e.policy_id,rid,p_corrects,coalesce(original.revision+1,1));
 end loop;
 if p_corrects is not null then update cohort_records set review_status='superseded',lease_token=null,lease_until=null where id=p_corrects; end if;
 update native_log_drafts set status='submitted',submitted_at=now(),lease_token=null,lease_until=null,receipt=p_receipt,revision=revision+1,updated_at=now() where id=p_id;
 update cohort_enrollments set revision=revision+1 where owner_id=p_owner;
 insert into audit_events(owner_id,actor_id,actor_type,event_type,entity_type,entity_id,metadata)
 values(p_owner,p_owner,'observer','cohort_log_confirmed','native_log',p_id::text,jsonb_build_object('count',jsonb_array_length(p_entries),'supersedes',p_corrects,'confirmation_digest',encode(sha256(convert_to(p_confirmation,'UTF8')),'hex')));
 return p_receipt;
end $$;

-- A claim is one-use and decisions recheck both consent and the exact encrypted input.
create function public.claim_cohort_review(p_owner uuid,p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r cohort_records; d cohort_reviewer_delegations;
begin
 perform 1 from cohort_agents where id='system:field-station-reviewer:v1' and active for share;
 if not found then return null; end if;
 perform 1 from cohort_enrollments where owner_id=p_owner and active and review_consent for update;
 if not found then return null; end if;
 select * into d from cohort_reviewer_delegations where owner_id=p_owner and revoked_at is null;
 if not found then return null; end if;
 update cohort_records set lease_token=p_token,lease_until=now()+interval '150 seconds',lease_context_revision=(select permissions_revision from cohort_enrollments where owner_id=p_owner),lease_agent_version=(select version from cohort_agents where id='system:field-station-reviewer:v1')
  where owner_id=p_owner and id=p_id and review_status='pending' and coalesce(lease_until,'-infinity')<=now() and coalesce(retry_after,'-infinity')<=now() returning * into r;
 if not found then return null; end if;
 return jsonb_build_object('record',to_jsonb(r),'delegation',to_jsonb(d),'agent',(select to_jsonb(a) from cohort_agents a where a.id='system:field-station-reviewer:v1'));
end $$;
create function public.finish_cohort_review(p_owner uuid,p_id uuid,p_token uuid,p_delegation uuid,p_digest text,p_event uuid,p_outcome text,p_content jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r cohort_records;
begin
 perform 1 from cohort_agents where id='system:field-station-reviewer:v1' and active for share;
 if not found then return false; end if;
 perform 1 from cohort_enrollments where owner_id=p_owner and active and review_consent for update;
 if not found or not exists(select 1 from cohort_reviewer_delegations where id=p_delegation and owner_id=p_owner and revoked_at is null) then return false; end if;
 select * into r from cohort_records where id=p_id and owner_id=p_owner for update;
 if not found or r.review_status<>'pending' or r.lease_token is distinct from p_token or r.lease_until<=now() or r.content->>'digest'<>p_digest or r.lease_context_revision<>(select permissions_revision from cohort_enrollments where owner_id=p_owner) or r.lease_agent_version<>(select version from cohort_agents where id='system:field-station-reviewer:v1') then return false; end if;
 if p_outcome not in ('reviewed','clarification','escalated') then raise exception 'INVALID_INPUT'; end if;
 insert into cohort_review_events(id,owner_id,record_id,actor_id,delegation_id,policy_id,outcome,input_digest,content)
 values(p_event,p_owner,p_id,'system:field-station-reviewer:v1',p_delegation,r.policy_id,p_outcome,p_digest,p_content);
 update cohort_records set review_status=p_outcome,lease_token=null,lease_until=null where id=p_id;
 update cohort_enrollments set revision=revision+1 where owner_id=p_owner;
 return true;
end $$;
create function public.promote_cohort_replay(p_owner uuid,p_revision integer,p_id uuid,p_input text,p_output text,p_content jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare e cohort_enrollments; existing uuid;
begin
 select * into e from cohort_enrollments where owner_id=p_owner for update;
 if not found or not e.active or not e.review_consent or e.revision<>p_revision then return false; end if;
 select id into existing from cohort_replay_runs where owner_id=p_owner and input_digest=p_input;
 if existing is not null and (select output_digest from cohort_replay_runs where id=existing)<>p_output then raise exception 'REPLAY_VERIFICATION_FAILED';end if;
 if existing is null then
  insert into cohort_replay_runs(id,owner_id,policy_id,input_digest,output_digest,verification_passed,content) values(p_id,p_owner,e.policy_id,p_input,p_output,true,p_content);
 end if;
 update cohort_enrollments set current_replay_id=coalesce(existing,p_id),calculated_revision=p_revision where owner_id=p_owner;
 return true;
end $$;

-- Explicitly restrict defaults inherited from Supabase. These ledger tables have no browser mutation grant.
do $$ declare t text; begin
 foreach t in array array['cohort_policies','cohort_agents','cohort_communities','cohort_invitations','cohort_enrollments','cohort_memberships','cohort_reviewer_delegations','cohort_rate_policies','cohort_records','cohort_review_events','cohort_replay_runs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['cohort_enrollments','cohort_memberships','cohort_reviewer_delegations','cohort_rate_policies','cohort_records','cohort_review_events','cohort_replay_runs'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy owner_read on public.%I for select to authenticated using(owner_id=(select auth.uid()))',t);
 end loop;
end $$;
revoke all on function public.cohort_is_admin(uuid),public.cohort_command(uuid,text,jsonb),public.confirm_cohort_log(uuid,uuid,integer,text,text,jsonb,jsonb,uuid),public.claim_cohort_review(uuid,uuid,uuid),public.finish_cohort_review(uuid,uuid,uuid,uuid,text,uuid,text,jsonb),public.promote_cohort_replay(uuid,integer,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.cohort_is_admin(uuid),public.cohort_command(uuid,text,jsonb),public.confirm_cohort_log(uuid,uuid,integer,text,text,jsonb,jsonb,uuid),public.claim_cohort_review(uuid,uuid,uuid),public.finish_cohort_review(uuid,uuid,uuid,uuid,text,uuid,text,jsonb),public.promote_cohort_replay(uuid,integer,uuid,text,text,jsonb) to service_role;
