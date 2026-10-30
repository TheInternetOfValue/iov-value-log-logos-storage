-- Synthetic transaction only. Logos Storage mirror bookkeeping, no node or credential.
begin;
create function pg_temp.assert_mirror(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function pg_temp.mirror_content(d text default 'a') returns jsonb language sql as $$
 select jsonb_build_object('ciphertext','synthetic encrypted payload','iv',repeat('i',16),'authTag',repeat('t',24),'keyVersion',1,'digest',repeat(d,64)) $$;

do $$
declare a uuid:='11111111-1111-4111-8111-111111111111'; draft uuid:=gen_random_uuid(); open_draft uuid:=gen_random_uuid(); first_cid text:='zDvSyntheticMirrorCid0001';
begin
 perform pg_temp.assert_mirror(not has_table_privilege('authenticated','public.native_log_mirrors','select'),'members cannot read mirror rows');
 perform pg_temp.assert_mirror(not has_table_privilege('anon','public.native_log_mirrors','select'),'anon cannot read mirror rows');
 perform pg_temp.assert_mirror(not has_function_privilege('authenticated','public.pending_native_log_mirrors(integer)','execute'),'members cannot list pending mirrors');
 perform pg_temp.assert_mirror(not has_function_privilege('authenticated','public.stale_native_log_mirrors(integer)','execute'),'members cannot list stale mirrors');
 perform pg_temp.assert_mirror(has_function_privilege('service_role','public.pending_native_log_mirrors(integer)','execute'),'worker can list pending mirrors');
 perform pg_temp.assert_mirror(not has_table_privilege('service_role','public.native_log_mirrors','delete'),'worker cannot delete mirror rows');

 perform public.save_native_log_draft(a,draft,0,pg_temp.mirror_content());
 perform public.save_native_log_draft(a,open_draft,0,pg_temp.mirror_content('b'));
 perform pg_temp.assert_mirror(not exists(select 1 from public.pending_native_log_mirrors(50)),'open drafts are never mirrored');

 update public.native_log_drafts set status='submitted',submitted_at=now() where owner_id=a and id=draft;
 perform pg_temp.assert_mirror((select count(*)=1 and bool_and(id=draft and revision=1 and content_ciphertext='synthetic encrypted payload') from public.pending_native_log_mirrors(50)),'submitted revision is pending with its ciphertext');

 insert into public.native_log_mirrors(owner_id,draft_id,revision,cid,content_digest) values(a,draft,1,first_cid,repeat('a',64));
 perform pg_temp.assert_mirror(not exists(select 1 from public.pending_native_log_mirrors(50)),'mirrored revision is no longer pending');
 perform pg_temp.assert_mirror(not exists(select 1 from public.stale_native_log_mirrors(50)),'current mirror is not stale');

 update public.native_log_drafts set revision=revision+1 where owner_id=a and id=draft;
 perform pg_temp.assert_mirror((select count(*)=1 and bool_and(revision=2) from public.pending_native_log_mirrors(50)),'newer revision is pending again');
 perform pg_temp.assert_mirror((select count(*)=1 and bool_and(s.revision=1 and s.cid=first_cid) from public.stale_native_log_mirrors(50) s),'superseded revision is stale');
 update public.native_log_mirrors set node_deleted_at=now() where owner_id=a and draft_id=draft and revision=1;
 insert into public.native_log_mirrors(owner_id,draft_id,revision,cid,content_digest) values(a,draft,2,'zDvSyntheticMirrorCid0002',repeat('a',64));

 update public.native_log_drafts set status='removed',content_ciphertext=null,content_iv=null,content_auth_tag=null,content_key_version=null,removed_at=now(),revision=revision+1 where owner_id=a and id=draft;
 perform pg_temp.assert_mirror(not exists(select 1 from public.pending_native_log_mirrors(50)),'removed drafts are never uploaded');
 perform pg_temp.assert_mirror((select count(*)=1 and bool_and(revision=2) from public.stale_native_log_mirrors(50)),'removed draft node copy is stale');
 update public.native_log_mirrors set node_deleted_at=now() where owner_id=a and draft_id=draft and revision=2;
 perform pg_temp.assert_mirror(not exists(select 1 from public.stale_native_log_mirrors(50)),'deleted node copies are not retried');
 perform pg_temp.assert_mirror((select count(*)=2 from public.native_log_mirrors where owner_id=a and draft_id=draft),'mirror history is retained');

 begin
  insert into public.native_log_mirrors(owner_id,draft_id,revision,cid,content_digest) values(a,gen_random_uuid(),1,first_cid,repeat('a',64));
  raise exception 'FAIL: mirror without a source draft';
 exception when foreign_key_violation then null; end;
end $$;
select 'PASS: native log mirror privileges, pending, superseded and removal bookkeeping' as result;
rollback;
