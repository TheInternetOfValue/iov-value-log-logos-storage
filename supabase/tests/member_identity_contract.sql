-- Behavioural assertions; run with scripts/test-member-database.mjs.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', message; end if; end $$;
select pg_temp.assert_true((select count(*) = 1 from public.members), 'original member preserved');
select pg_temp.assert_true((select did = 'did:iov:member:10000000-0000-4000-8000-000000000001' from public.member_identity_bindings where owner_id='11111111-1111-4111-8111-111111111111'), 'original immutable DID preserved');
select pg_temp.assert_true((select count(*) = 0 from public.member_log_access), 'pilot not enrolled in personal mode');
select pg_temp.assert_true(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and has_table_privilege('authenticated',c.oid,'SELECT') and not coalesce(c.reloptions @> array['security_invoker=true'],false)), 'all member-readable views obey caller RLS');
select pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))), 'privileged public functions are service-only');

insert into auth.users(id,email,raw_app_meta_data) values
 ('22222222-2222-4222-8222-222222222222','identity-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@members.valuelog.invalid','{"identity_issuer":"word-wallet-web","identity_did":"did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}'),
 ('33333333-3333-4333-8333-333333333333','identity-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@members.valuelog.invalid','{"identity_issuer":"word-wallet-web","identity_did":"did:iov:member:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}'),
 ('44444444-4444-4444-8444-444444444444','collision@example.test','{}');

set local role service_role;
select pg_temp.assert_true(public.admit_value_log_member('22222222-2222-4222-8222-222222222222','did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','identity-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@members.valuelog.invalid') = '22222222-2222-4222-8222-222222222222', 'first admission');
select pg_temp.assert_true(public.admit_value_log_member('22222222-2222-4222-8222-222222222222','did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','identity-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@members.valuelog.invalid') = '22222222-2222-4222-8222-222222222222', 'duplicate admission idempotent');
select public.admit_value_log_member('33333333-3333-4333-8333-333333333333','did:iov:member:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','identity-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@members.valuelog.invalid');
select public.setup_value_log_member('22222222-2222-4222-8222-222222222222','Person A','Asia/Kolkata');
select public.setup_value_log_member('33333333-3333-4333-8333-333333333333','Person B','Europe/London');
do $$ begin
  begin perform public.admit_value_log_member('44444444-4444-4444-8444-444444444444','did:iov:member:cccccccc-cccc-4ccc-8ccc-cccccccccccc','collision@example.test'); raise exception 'FAIL: collision admitted';
  exception when raise_exception then if sqlerrm = 'FAIL: collision admitted' then raise; end if; end;
end $$;
select pg_temp.assert_true(public.save_value_log_member_entry('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555',0,'2026-10-25','Physiology', jsonb_build_object('ciphertext',repeat('s',24000),'iv',repeat('i',16),'authTag',repeat('t',24),'keyVersion',1,'digest',repeat('a',64))) = 1, 'first save');
select pg_temp.assert_true(public.save_value_log_member_entry('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555',0,'2026-10-25','Physiology', jsonb_build_object('ciphertext',repeat('s',24000),'iv',repeat('i',16),'authTag',repeat('t',24),'keyVersion',1,'digest',repeat('a',64))) = 1, 'retry does not duplicate');
do $$ begin
  begin perform public.save_value_log_member_entry('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555',0,'2026-10-25','Physiology', jsonb_build_object('digest',repeat('b',64))); raise exception 'FAIL: stale revision accepted';
  exception when raise_exception then if sqlerrm <> 'revision_conflict' then raise; end if; end;
end $$;
reset role;
select pg_temp.assert_true((select count(*)=1 from public.member_activity_entries), 'one retry-safe entry');
select pg_temp.assert_true(not exists(select 1 from public.wellbeing_baselines where owner_id <> '11111111-1111-4111-8111-111111111111'), 'no invented baseline');
select pg_temp.assert_true(not exists(select 1 from public.canonical_slices where owner_id <> '11111111-1111-4111-8111-111111111111'), 'private entry is not canonical');

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select pg_temp.assert_true((select count(*)=0 from public.member_activity_entries), 'B cannot read A');
select pg_temp.assert_true((select count(*)=1 from public.members), 'B sees only own membership');
do $$ begin
 begin insert into public.wellbeing_baselines(owner_id,value,effective_at,rationale) values('33333333-3333-4333-8333-333333333333',500,now(),'unauthorised synthetic baseline'); raise exception 'FAIL: self baseline accepted';
 exception when insufficient_privilege then null; end;
end $$;
select pg_temp.assert_true((select display_name='Person B' from public.members), 'B own profile');
select pg_temp.assert_true((select count(*)=1 from public.member_identity_bindings), 'B sees only own DID');
select pg_temp.assert_true(not has_table_privilege(current_user,'public.member_activity_entries','INSERT'), 'no direct private write');
select pg_temp.assert_true(not has_table_privilege(current_user,'public.member_log_access','UPDATE'), 'cannot self-grant or change onboarding');
select pg_temp.assert_true(not has_function_privilege(current_user,'public.admit_value_log_member(uuid,text,text)','EXECUTE'), 'no browser admission RPC');
select pg_temp.assert_true(not has_function_privilege(current_user,'public.value_log_identity_candidate(text,text)','EXECUTE'), 'Auth candidate lookup service only');
select pg_temp.assert_true(not has_function_privilege(current_user,'public.save_value_log_member_entry(uuid,uuid,integer,date,public.wellbeing_node,jsonb,boolean)','EXECUTE'), 'no browser writer RPC');
select pg_temp.assert_true(not has_table_privilege(current_user,'public.canonical_slices','INSERT'), 'cannot manufacture canonical slice');
select pg_temp.assert_true(not has_table_privilege(current_user,'public.validation_events','INSERT'), 'cannot manufacture authority');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select pg_temp.assert_true((select count(*)=1 from public.member_activity_entries), 'A sees own entry');
reset role;

set local role service_role;
select pg_temp.assert_true(public.save_value_log_member_entry('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555',1,'2026-10-25','Physiology',jsonb_build_object('digest',repeat('c',64)),true)=2, 'remove writing');
select pg_temp.assert_true(public.save_value_log_member_entry('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555',1,'2026-10-25','Physiology',jsonb_build_object('digest',repeat('c',64)),true)=2, 'remove retry safe');
reset role;
select pg_temp.assert_true((select activity_date is null and wellbeing_node is null and content_ciphertext is null and content_iv is null and content_auth_tag is null and removed_at is not null from public.member_activity_entries), 'removed writing erased');
select pg_temp.assert_true((select count(*)=1 from public.audit_events where event_type='private_activity_removed'), 'removal audit once');
select pg_temp.assert_true((select count(*)=2 from public.audit_events where event_type='value_log_member_admitted'), 'one admission per new owner');
select pg_temp.assert_true((select email='pilot@example.test' and display_name='Original pilot fixture' and timezone='Asia/Kolkata' from public.members where id='11111111-1111-4111-8111-111111111111'), 'pilot profile intact');
do $$ begin
 begin update public.member_identity_bindings set did='did:iov:member:dddddddd-dddd-4ddd-8ddd-dddddddddddd' where owner_id='11111111-1111-4111-8111-111111111111'; raise exception 'FAIL: rebinding allowed';
 exception when raise_exception then if sqlerrm not like 'Wellbeing Identity bindings are immutable%' then raise; end if; end;
end $$;
set local role service_role;
update public.member_log_access set write_window_count=30 where owner_id='33333333-3333-4333-8333-333333333333';
do $$ begin
 begin perform public.save_value_log_member_entry('33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',0,'2026-10-25','Thought',jsonb_build_object('ciphertext','synthetic','iv',repeat('i',16),'authTag',repeat('t',24),'keyVersion',1,'digest',repeat('d',64)));raise exception 'FAIL: rate limit bypassed';
 exception when raise_exception then if sqlerrm <> 'write_rate_limited' then raise; end if; end;
end $$;
reset role;
select 'PASS: synthetic member admission, isolation, retries, removal and original binding preservation' as result;
rollback;
