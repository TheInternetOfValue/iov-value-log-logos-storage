-- Synthetic transaction only. Exercises the new boundary without production credentials.
begin;
create function pg_temp.assert_native(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.native_content(d text default 'a') returns jsonb language sql as $$
 select jsonb_build_object('ciphertext','synthetic encrypted payload','iv',repeat('i',16),'authTag',repeat('t',24),'keyVersion',1,'digest',repeat(d,64)) $$;
insert into auth.users(id,email,raw_app_meta_data) values
 ('22222222-2222-4222-8222-222222222222','identity-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@members.valuelog.invalid','{"identity_issuer":"word-wallet-web","identity_did":"did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}'),
 ('33333333-3333-4333-8333-333333333333','identity-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@members.valuelog.invalid','{"identity_issuer":"word-wallet-web","identity_did":"did:iov:member:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}');
select public.admit_value_log_member('22222222-2222-4222-8222-222222222222','did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','identity-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@members.valuelog.invalid');
select public.admit_value_log_member('33333333-3333-4333-8333-333333333333','did:iov:member:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','identity-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@members.valuelog.invalid');
select public.setup_value_log_member('22222222-2222-4222-8222-222222222222','Person A','Asia/Kolkata');
select public.setup_value_log_member('33333333-3333-4333-8333-333333333333','Person B','Europe/London');

do $$
declare a uuid:='22222222-2222-4222-8222-222222222222'; b uuid:='33333333-3333-4333-8333-333333333333'; d uuid:=gen_random_uuid(); token uuid; r jsonb; e uuid:=gen_random_uuid(); v integer;
begin
 perform pg_temp.assert_native(public.save_native_log_draft(a,d,0,pg_temp.native_content())=1,'first draft save');
 perform pg_temp.assert_native(public.save_native_log_draft(a,d,0,pg_temp.native_content())=1,'lost-save-response retry');
 begin perform public.save_native_log_draft(a,d,0,pg_temp.native_content('b')); raise exception 'FAIL: stale overwrite'; exception when raise_exception then if sqlerrm<>'REVISION_CONFLICT' then raise; end if; end;
 token:=public.reserve_native_log_processing(a,d,1);
 begin perform public.reserve_native_log_processing(a,d,1); raise exception 'FAIL: parallel processing'; exception when raise_exception then if sqlerrm<>'PROCESSING_BUSY' then raise; end if; end;
 begin perform public.save_native_log_draft(a,d,1,pg_temp.native_content('b')); raise exception 'FAIL: save during processing'; exception when raise_exception then if sqlerrm<>'PROCESSING_BUSY' then raise; end if; end;
 perform pg_temp.assert_native(public.save_native_log_draft(a,d,1,pg_temp.native_content('b'),token)=2,'leased provider result saves once');
 begin perform public.save_native_log_draft(a,d,2,pg_temp.native_content('c'),token); raise exception 'FAIL: late provider overwrite'; exception when raise_exception then if sqlerrm<>'REVISION_CONFLICT' then raise; end if; end;
 perform public.save_native_log_draft(b,d,0,pg_temp.native_content('c'));
 perform pg_temp.assert_native((select count(*)=2 from public.native_log_drafts where id=d),'same draft UUID scoped to owner');
 -- No activity before explicit confirmation.
 perform pg_temp.assert_native((select count(*)=0 from public.member_activity_entries),'draft is not an activity');
 r:=public.confirm_native_log(a,d,2,repeat('b',64),'personal',jsonb_build_array(jsonb_build_object('id',e,'date','2026-10-24','node','Thought','content',pg_temp.native_content())),null,'Explicit synthetic approval',jsonb_build_object('kind','unassessed','count',1,'ids',jsonb_build_array(e),'dates',jsonb_build_array('2026-10-24'),'timezone','Asia/Kolkata'));
 perform pg_temp.assert_native(r->>'kind'='unassessed','personal stays unassessed');
 perform pg_temp.assert_native(public.confirm_native_log(a,d,2,repeat('b',64),'personal','[]',null,'retry','{}')=r,'confirm retry returns same receipt');
 perform pg_temp.assert_native((select count(*)=1 from public.member_activity_entries where owner_id=a),'no duplicate confirmed entry');
 perform pg_temp.assert_native(not exists(select 1 from public.canonical_slices where owner_id=a),'no personal canonical');
 perform pg_temp.assert_native(not exists(select 1 from public.wellbeing_baselines where owner_id=a),'no personal baseline');
 perform public.remove_native_log_draft(a,d,3);
 perform pg_temp.assert_native((select status='removed' and content_ciphertext is null from public.native_log_drafts where owner_id=a and id=d),'removal erases encrypted draft');
 perform pg_temp.assert_native((select count(*)=1 from public.member_activity_entries where owner_id=a),'draft removal preserves confirmed activity');
 -- All-or-nothing when the second item fails validation.
 d:=gen_random_uuid();perform public.save_native_log_draft(a,d,0,pg_temp.native_content());
 begin
  perform public.confirm_native_log(a,d,1,repeat('a',64),'personal',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'date','2026-10-24','node','Thought','content',pg_temp.native_content()),jsonb_build_object('id',gen_random_uuid(),'date','2026-10-24','node','INVALID','content',pg_temp.native_content())),null,'Approval','{}');
  raise exception 'FAIL: invalid atomic batch accepted';
 exception when invalid_text_representation then null; end;
 perform pg_temp.assert_native((select count(*)=1 from public.member_activity_entries where owner_id=a),'failed batch rolled back first entry');
 perform pg_temp.assert_native((select status='draft' from public.native_log_drafts where owner_id=a and id=d),'failed confirmation retains draft');
 -- Personal users cannot take the founder path even through the service RPC.
 begin perform public.confirm_native_log(a,d,1,repeat('a',64),'pilot','[{}]',null,'Approval','{}'); raise exception 'FAIL: personal pilot'; exception when raise_exception then if sqlerrm<>'UNAUTHORIZED' then raise; end if; end;
 token:=public.reserve_native_log_processing(a,d,1);perform public.remove_native_log_draft(a,d,1);
 begin perform public.save_native_log_draft(a,d,1,pg_temp.native_content('c'),token); raise exception 'FAIL: removed draft resurrected'; exception when raise_exception then if sqlerrm<>'NATIVE_DRAFT_CLOSED' then raise; end if; end;
end $$;

-- Authenticated browser reads only its own rows and cannot invoke privileged mutations.
set local role authenticated;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select pg_temp.assert_native((select count(*)=1 from public.native_log_drafts),'B sees only B');
select pg_temp.assert_native(not has_table_privilege(current_user,'public.native_log_drafts','INSERT'),'no direct native write');
select pg_temp.assert_native(not has_function_privilege(current_user,'public.confirm_native_log(uuid,uuid,integer,text,text,jsonb,jsonb,text,jsonb)','EXECUTE'),'no browser confirmation RPC');
reset role;

-- Pilot records enter the existing pending review path, labelled with their true source.
do $$
declare pilot uuid:='11111111-1111-4111-8111-111111111111'; d uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); r jsonb; native_draft uuid:=gen_random_uuid(); legacy_intake uuid; legacy_draft uuid; item jsonb;
begin
 perform public.save_native_log_draft(pilot,d,0,pg_temp.native_content());
 item:=jsonb_build_object('id',cid,'draft_id',native_draft,'protocol_link_id',gen_random_uuid(),'start_at','2026-10-24T02:30:00Z','end_at','2026-10-24T03:00:00Z','timezone','Asia/Kolkata','activity','Synthetic walk','wellbeing_node','Physiology','slice_type','non_performance','community','house_of_bros','impact_direction','neutral','impact_intensity','low','confidence','observed','activity_occurrence_id',gen_random_uuid());
 r:=public.confirm_native_log(pilot,d,1,repeat('a',64),'pilot',jsonb_build_array(item),pg_temp.native_content(),'Explicit synthetic approval',jsonb_build_object('kind','validation_pending','count',1,'ids',jsonb_build_array(cid),'dates',jsonb_build_array('2026-10-24'),'timezone','Asia/Kolkata'));
 perform pg_temp.assert_native((select status='validation_pending' from public.canonical_slices where id=cid),'no premature validation or calculation');
 perform pg_temp.assert_native((select machine_source='native_voice' from public.draft_slices where id=native_draft),'native source retained');
 perform pg_temp.assert_native((select source='native_voice' from public.intake_sessions where id=(r->>'intakeId')::uuid),'not Custom GPT impersonation');
 perform pg_temp.assert_native((select count(*)=1 from public.observer_events where canonical_slice_id=cid),'explicit observer event once');
 -- Legacy ingestion cannot overlap a native record; exact adjacency remains allowed.
 insert into public.intake_sessions(owner_id,source,parser_version,idempotency_key,timezone,narrative_ciphertext,narrative_iv,narrative_auth_tag,narrative_key_version,narrative_digest)
 values(pilot,'custom_gpt','synthetic','native-contract-legacy','Asia/Kolkata','synthetic',repeat('i',16),repeat('t',24),1,repeat('a',64)) returning id into legacy_intake;
 insert into public.draft_slices(intake_session_id,owner_id,machine_source,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community,impact_direction,impact_intensity,confidence)
 values(legacy_intake,pilot,'custom_gpt','2026-10-24T02:45:00Z','2026-10-24T03:15:00Z','Asia/Kolkata','Legacy test','Physiology','non_performance','house_of_bros','neutral','low','observed') returning id into legacy_draft;
 begin
  insert into public.canonical_slices(protocol_link_id,revision_number,draft_slice_id,owner_id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community,impact_direction,impact_intensity,confidence,status)
  values(gen_random_uuid(),1,legacy_draft,pilot,'2026-10-24T02:45:00Z','2026-10-24T03:15:00Z','Asia/Kolkata','Legacy overlap','Physiology','non_performance','house_of_bros','neutral','low','observed','validation_pending');
  raise exception 'FAIL: legacy overlapped native';
 exception when raise_exception then if sqlerrm<>'NATIVE_TIMELINE_OVERLAP' then raise; end if; end;
 insert into public.canonical_slices(protocol_link_id,revision_number,draft_slice_id,owner_id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community,impact_direction,impact_intensity,confidence,status)
 values(gen_random_uuid(),1,legacy_draft,pilot,'2026-10-24T03:00:00Z','2026-10-24T03:15:00Z','Asia/Kolkata','Adjacent','Physiology','non_performance','house_of_bros','neutral','low','observed','validation_pending');
 -- Native confirmation cannot overlap legacy, and cannot leave half an intake.
 d:=gen_random_uuid();perform public.save_native_log_draft(pilot,d,0,pg_temp.native_content());
 begin
  perform public.confirm_native_log(pilot,d,1,repeat('a',64),'pilot',jsonb_build_array(item||jsonb_build_object('id',gen_random_uuid(),'draft_id',gen_random_uuid(),'protocol_link_id',gen_random_uuid(),'start_at','2026-10-24T03:05:00Z','end_at','2026-10-24T03:10:00Z')),pg_temp.native_content(),'Approval',jsonb_build_object('timezone','Asia/Kolkata'));
  raise exception 'FAIL: native overlapped legacy';
 exception when raise_exception then if sqlerrm<>'NATIVE_TIMELINE_OVERLAP' then raise; end if; end;
 perform pg_temp.assert_native((select status='draft' from public.native_log_drafts where owner_id=pilot and id=d),'overlap rejection retains editable draft');
 update public.intake_sessions set narrative_ciphertext=null,narrative_iv=null,narrative_auth_tag=null,narrative_deleted_at=now() where id=(r->>'intakeId')::uuid;
 perform pg_temp.assert_native((select status='removed' and content_ciphertext is null from public.native_log_drafts where intake_session_id=(r->>'intakeId')::uuid),'narrative deletion clears duplicate draft copy');
 perform pg_temp.assert_native((select count(*)=2 from public.canonical_slices where owner_id=pilot),'source deletion preserves protocol history');
end $$;
select 'PASS: native draft leases, CAS, RLS, atomic approval, real source, overlap and removal contracts' as result;
rollback;
