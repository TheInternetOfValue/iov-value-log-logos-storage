begin;
create function pg_temp.assert_dated(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create temp table founder_before as select to_jsonb(m) snapshot from members m where id='11111111-1111-4111-8111-111111111111';
create temp table founder_binding_before as select to_jsonb(b) snapshot from member_identity_bindings b where owner_id='11111111-1111-4111-8111-111111111111';
do $$declare n integer; owner uuid; did text; locator text; count_before integer; consent_before timestamptz; revision_before integer;
begin
 for n in 1..14 loop
  owner=('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  did='did:iov:member:'||owner::text;
  locator='identity-'||encode(sha256(convert_to(owner::text,'UTF8')),'hex')||'@members.valuelog.invalid';
  insert into auth.users(id,email,raw_app_meta_data) values(owner,locator,jsonb_build_object('identity_issuer','word-wallet-web','identity_did',did));
  perform admit_value_log_member(owner,did,locator);
  perform setup_value_log_member(owner,'Synthetic dated member','Asia/Kolkata');
  update member_log_access set admitted_at=case when n=14 then '2026-10-29T00:00:00+05:30'::timestamptz else '2026-10-26T00:00:00+05:30'::timestamptz end where owner_id=owner;
  perform pg_temp.assert_dated(record_dated_field_station_eligibility(owner)=(n<>14),'U02: exact admission boundary');
  if n=14 then continue; end if;
  perform record_dated_field_station_eligibility(owner);
  perform pg_temp.assert_dated((select count(*)=1 from cohort_invitations where eligible_owner=owner),'U02/U03: one persisted eligibility record');
  if n=3 then
   update cohort_invitations set assigned_house='house_of_sis' where eligible_owner=owner;
   begin perform enroll_dated_field_station(owner,'field-station-oct26-28-700-v1',true,true,'house_of_bros'); raise exception 'FAIL: incorrect House accepted';
   exception when raise_exception then if sqlerrm<>'HOUSE_ASSIGNMENT_REQUIRED' then raise; end if; end;
  end if;
  begin perform enroll_dated_field_station(owner,'field-station-oct26-28-700-v1',false,true,'house_of_bros'); raise exception 'FAIL: missing consent accepted';
  exception when raise_exception then if sqlerrm<>'CONSENT_REQUIRED' then raise; end if; end;
  perform enroll_dated_field_station(owner,'field-station-oct26-28-700-v1',true,true,case when n=3 then 'house_of_sis' else 'house_of_bros' end);
  select consent_at,revision into consent_before,revision_before from cohort_enrollments where owner_id=owner;
  perform enroll_dated_field_station(owner,'field-station-oct26-28-700-v1',true,true,case when n=3 then 'house_of_sis' else 'house_of_bros' end);
  perform pg_temp.assert_dated((select consent_at=consent_before and revision=revision_before and boundary_at='2026-10-26T00:00:00+05:30'::timestamptz and timezone='Asia/Kolkata' from cohort_enrollments where owner_id=owner),'U03: repeat acceptance never resets baseline, consent or movement');
  update member_log_access set admitted_at='2026-10-30T00:00:00+05:30' where owner_id=owner;
  perform pg_temp.assert_dated(record_dated_field_station_eligibility(owner),'U02: eligibility survives the window closing');
 end loop;
 perform pg_temp.assert_dated((select count(*)=13 from cohort_enrollments),'U23: no ten-member enrollment ceiling');
 perform pg_temp.assert_dated((select count(*)=0 from cohort_rate_policies),'U08: no salary or rate created');
 perform pg_temp.assert_dated((select count(*)=13 from cohort_reviewer_delegations),'U03: one delegation per accepted member');
 perform pg_temp.assert_dated((select count(*)=13 from cohort_memberships),'U04: only the accepted House membership exists');
 perform pg_temp.assert_dated((select house_id='house_of_sis' from cohort_enrollments where owner_id='10000000-0000-4000-8000-000000000003'),'U04: explicit DID-bound Sis assignment preserved');
 perform cohort_command('11111111-1111-4111-8111-111111111111','invite',jsonb_build_object('id',gen_random_uuid(),'hash',repeat('9',64),'communities','[]'::jsonb));
 perform cohort_command('10000000-0000-4000-8000-000000000014','enroll',jsonb_build_object('hash',repeat('9',64),'house','house_of_bros','communities','[]'::jsonb,'consent',true,'startingValuesConfirmed',true));
 perform pg_temp.assert_dated((select policy_id='field-station-assumed-700-v1' from cohort_enrollments where owner_id='10000000-0000-4000-8000-000000000014'),'legacy invitation capacity counts only its own policy');
 perform pg_temp.assert_dated(not record_dated_field_station_eligibility('11111111-1111-4111-8111-111111111111'),'Founder never enters the new policy');
 begin perform enroll_dated_field_station('11111111-1111-4111-8111-111111111111','field-station-oct26-28-700-v1',true,true,'house_of_bros'); raise exception 'FAIL: founder enrolled';
 exception when raise_exception then if sqlerrm<>'UNAUTHORIZED' then raise; end if; end;
end $$;
do $$declare a uuid:='10000000-0000-4000-8000-000000000001';b uuid:='10000000-0000-4000-8000-000000000002';d uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();r uuid:=gen_random_uuid();w uuid:=gen_random_uuid();c jsonb:='{"ciphertext":"syntheticencryptedtext","iv":"iiiiiiiiiiiiiiii","authTag":"tttttttttttttttttttttttt","keyVersion":1,"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';receipt jsonb;entries jsonb;token uuid:=gen_random_uuid();
begin
 insert into native_log_drafts(owner_id,id,revision,content_ciphertext,content_iv,content_auth_tag,content_key_version,content_digest) values
 (a,d,1,c->>'ciphertext',c->>'iv',c->>'authTag',1,c->>'digest'),(b,d2,1,c->>'ciphertext',c->>'iv',c->>'authTag',1,c->>'digest');
 receipt=jsonb_build_object('kind','cohort_review_pending','sourceReferenced',true,'ids',jsonb_build_array(r,w),'count',2,'dates',jsonb_build_array('2026-10-26'),'timezone','Asia/Kolkata');
 entries=jsonb_build_array(
 jsonb_build_object('id',r,'occurrenceId',gen_random_uuid(),'start','2026-10-26T08:00:00+05:30','end','2026-10-26T08:30:00+05:30','node','Physiology','outcome','pending','content',c),
 jsonb_build_object('id',w,'occurrenceId',gen_random_uuid(),'start','2026-10-26T10:00:00+05:30','end','2026-10-26T12:00:00+05:30','node','Performance','outcome','pending','content',c));
 perform confirm_dated_native_log(a,d,1,c->>'digest','Approved synthetic mixed log',entries,receipt);
 perform pg_temp.assert_dated((select count(*)=1 from cohort_records where owner_id=a),'U08: work never becomes a House review record');
 perform pg_temp.assert_dated((select count(*)=2 from native_log_day_index where owner_id=a),'mixed approval indexes every visible occurrence');
 perform pg_temp.assert_dated((select outcome='unassessed' from native_log_day_index where source_id=w),'U08: server policy overrides work assessment intent');
 perform confirm_dated_native_log(a,d,1,c->>'digest','Approved synthetic mixed log',entries,receipt);
 perform pg_temp.assert_dated((select count(*)=2 from native_log_day_index where owner_id=a),'duplicate submission preserves the same occurrences');
 begin
  perform confirm_dated_native_log(b,d2,1,c->>'digest','Synthetic failing batch',jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'occurrenceId',gen_random_uuid(),'start','2026-10-26T08:00:00+05:30','end','2026-10-26T08:30:00+05:30','node','Physiology','outcome','pending','content',c),
    jsonb_build_object('id',gen_random_uuid(),'occurrenceId',gen_random_uuid(),'start','2026-10-26T10:00:00+05:30','end','2026-10-26T09:00:00+05:30','node','Physiology','outcome','pending','content',c)),receipt);
  raise exception 'FAIL: invalid second row committed';
 exception when raise_exception then if sqlerrm<>'INVALID_INPUT' then raise;end if;end;
 perform pg_temp.assert_dated((select count(*)=0 from cohort_records where owner_id=b) and (select count(*)=0 from native_log_day_index where owner_id=b) and (select status='draft' from native_log_drafts where owner_id=b and id=d2),'failed mixed transaction preserves no partial confirmation');
 perform remove_native_log_draft(a,d,2);
 perform pg_temp.assert_dated((select status='removed' and approved_source_retained and content_ciphertext is not null from native_log_drafts where owner_id=a and id=d),'U17: removing the draft keeps its single referenced approved source');
 perform pg_temp.assert_dated((select count(*)=1 from cohort_records where owner_id=a),'approved record retained after source-list removal');
 perform pg_temp.assert_dated(claim_cohort_queue_cursor(token) is not null,'queue cursor lease acquired');
 perform pg_temp.assert_dated(claim_cohort_queue_cursor(gen_random_uuid()) is null,'another sweep cannot steal an active cursor lease');
 perform pg_temp.assert_dated(not advance_cohort_queue_cursor(gen_random_uuid(),a,true),'stale queue sweep cannot advance cursor');
 perform pg_temp.assert_dated(advance_cohort_queue_cursor(token,a,true),'queue progress released after committed batch');
 token=gen_random_uuid();
 perform pg_temp.assert_dated(claim_cohort_queue_cursor(token)->>'cursor'=a::text,'U23: next sweep resumes after persisted owner');
 perform advance_cohort_queue_cursor(token,null,true);
end $$;
-- Removing an unassessed indexed capture removes its blocker, not a retained reviewed source.
do $$declare a uuid:='10000000-0000-4000-8000-000000000006'; d uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); c jsonb:='{"ciphertext":"syntheticencryptedtext","iv":"iiiiiiiiiiiiiiii","authTag":"tttttttttttttttttttttttt","keyVersion":1,"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
begin
 perform save_native_log_draft(a,d,0,c);
 perform confirm_dated_native_log(a,d,1,c->>'digest','Approved synthetic untimed capture',jsonb_build_array(jsonb_build_object('id',r,'occurrenceId',gen_random_uuid(),'start',null,'end',null,'date','2026-10-26','node',null,'outcome','clarification','content',null)),jsonb_build_object('kind','capture_review_pending','dayIndexVersion',1,'sourceReferenced',false,'count',1,'ids',jsonb_build_array(r),'dates',jsonb_build_array('2026-10-26'),'timezone','Asia/Kolkata'));
 perform remove_native_log_draft(a,d,2);
 perform pg_temp.assert_dated((select content_ciphertext is null and not approved_source_retained from native_log_drafts where owner_id=a and id=d),'explicit unassessed removal erases its words');
 perform pg_temp.assert_dated(not exists(select 1 from native_log_day_index where owner_id=a and native_draft_id=d and superseded_at is null),'U22/U26: removed private capture cannot keep calculation blocked');
end $$;
-- Explicit source adoption is append-only and cannot score the same history twice.
do $$declare a uuid:='10000000-0000-4000-8000-000000000004'; original uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); duplicate uuid:=gen_random_uuid(); c jsonb:='{"ciphertext":"syntheticencryptedtext","iv":"iiiiiiiiiiiiiiii","authTag":"tttttttttttttttttttttttt","keyVersion":1,"digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'; before_source jsonb; receipt jsonb;
begin
 insert into native_log_drafts(owner_id,id,revision,status,receipt,content_ciphertext,content_iv,content_auth_tag,content_key_version,content_digest) values
 (a,original,1,'submitted','{"kind":"unassessed","count":1,"ids":[],"dates":["2026-10-26"],"timezone":"Asia/Kolkata"}',c->>'ciphertext',c->>'iv',c->>'authTag',1,c->>'digest'),
 (a,fresh,1,'draft',null,c->>'ciphertext',c->>'iv',c->>'authTag',1,c->>'digest'),
 (a,duplicate,1,'draft',null,c->>'ciphertext',c->>'iv',c->>'authTag',1,c->>'digest');
 select to_jsonb(d) into before_source from native_log_drafts d where owner_id=a and id=original;
 receipt='{"kind":"cohort_review_pending","sourceReferenced":true,"dayIndexVersion":1,"count":1,"ids":[],"dates":["2026-10-26"],"timezone":"Asia/Kolkata"}';
 perform confirm_dated_native_log(a,fresh,1,c->>'digest','Fresh approval of synthetic history',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'occurrenceId',gen_random_uuid(),'start','2026-10-26T13:00:00+05:30','end','2026-10-26T13:30:00+05:30','node','Physiology','outcome','pending','content',c)),receipt,null,original);
 perform pg_temp.assert_dated((select to_jsonb(d)=before_source from native_log_drafts d where owner_id=a and id=original),'U09: adoption preserves original receipt and source');
 begin
  perform confirm_dated_native_log(a,duplicate,1,c->>'digest','Duplicate adoption rejected',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'occurrenceId',gen_random_uuid(),'start','2026-10-26T14:00:00+05:30','end','2026-10-26T14:30:00+05:30','node','Physiology','outcome','pending','content',c)),receipt,null,original);
  raise exception 'FAIL: history adopted twice';
 exception when raise_exception then if sqlerrm<>'ADOPTION_ALREADY_USED' then raise;end if;end;
 perform pg_temp.assert_dated((select count(*)=1 from cohort_records where owner_id=a) and (select status='draft' from native_log_drafts where id=duplicate),'U09: duplicate adoption creates no second movement or partial approval');
end $$;
-- A known QA DID may be designated before admission; minimal setup is idempotent.
do $$declare a uuid:='10000000-0000-4000-8000-000000000015'; actor uuid:='11111111-1111-4111-8111-111111111111'; did text:='did:iov:member:10000000-0000-4000-8000-000000000015'; locator text:='identity-'||repeat('e',64)||'@members.valuelog.invalid'; snapshot jsonb; consent timestamptz;
begin
 perform designate_dated_account(actor,did,'field-station-oct26-28-qa-v1','house_of_sis','synthetic-qa-prebinding');
 insert into auth.users(id,email,raw_app_meta_data) values(a,locator,jsonb_build_object('identity_issuer','word-wallet-web','identity_did',did));
 perform admit_value_log_member(a,did,locator);
 perform pg_temp.assert_dated(bind_qa_member(a),'U01: QA assignment binds the verified DID after admission');
 perform pg_temp.assert_dated(complete_minimal_member_setup(a),'U01: minimal Identity needs no additional facets');
 select to_jsonb(m) into snapshot from members m where id=a;
 select onboarded_at into consent from member_log_access where owner_id=a;
 perform complete_minimal_member_setup(a);
 perform pg_temp.assert_dated((select to_jsonb(m)=snapshot from members m where id=a) and (select onboarded_at=consent from member_log_access where owner_id=a),'U01/U03: returning minimal setup preserves profile and actual acceptance time');
 perform enroll_dated_field_station(a,'field-station-oct26-28-qa-v1',true,true,'house_of_sis');
 perform pg_temp.assert_dated((select policy_id='field-station-oct26-28-qa-v1' and house_id='house_of_sis' from cohort_enrollments where owner_id=a),'QA cannot silently become the real policy');
end $$;
-- A House revocation blocks a previously claimed review even without a client revision.
do $$declare a uuid:='10000000-0000-4000-8000-000000000001'; record uuid; lease uuid:=gen_random_uuid(); claim jsonb;
begin
 update cohort_agents set operator_did=(select did from member_identity_bindings where owner_id='10000000-0000-4000-8000-000000000002'),accepted_at=now(),active=true;
 select id into record from cohort_records where owner_id=a and review_status='pending' limit 1;
 claim=claim_cohort_review(a,record,lease);
 perform pg_temp.assert_dated(claim is not null,'review can claim an opted-in, accepted House record');
 update cohort_memberships set revoked_at=now() where owner_id=a;
 perform pg_temp.assert_dated(not finish_cohort_review(a,record,lease,(claim->'delegation'->>'id')::uuid,repeat('a',64),gen_random_uuid(),'reviewed','{}'),'U24: revoked House cannot commit a queued decision');
 perform pg_temp.assert_dated((select review_status='pending' from cohort_records where id=record),'U26: blocked review preserves prior state');
end $$;
select pg_temp.assert_dated((select to_jsonb(m) from members m where id='11111111-1111-4111-8111-111111111111')=(select snapshot from founder_before),'founder member unchanged');
select pg_temp.assert_dated((select to_jsonb(b) from member_identity_bindings b where owner_id='11111111-1111-4111-8111-111111111111')=(select snapshot from founder_binding_before),'founder DID unchanged');
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select pg_temp.assert_dated((select count(*)=1 from cohort_enrollments),'owner sees no other enrollment');
select pg_temp.assert_dated(not has_function_privilege(current_user,'public.enroll_dated_field_station(uuid,text,boolean,boolean,text)','EXECUTE'),'browser cannot choose policy/owner authority');
select pg_temp.assert_dated(not has_table_privilege(current_user,'public.native_log_day_index','INSERT'),'browser cannot forge day index');
reset role;
select 'PASS: dated eligibility, consent, fixed boundary, thirteen members, House binding, no salary and founder preservation' as result;
rollback;
