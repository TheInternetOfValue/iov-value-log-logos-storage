// Prepare a reviewable guarded transaction. This program never connects to a database.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const migrationFile='202610270001_dated_field_station.sql';
const migration=readFileSync(new URL('../supabase/migrations/'+migrationFile,import.meta.url),'utf8');
const commands=[...migration.matchAll(/^\s*(begin|commit);\s*$/gm)].map(match=>match[1]);
if(commands.join(',')!=='begin,commit')throw Error('Expected one reviewed migration transaction');
const includeBase=process.env.IOV_DATED_INCLUDE_COHORT_BASE==='true';
const baseFile='202610260001_field_station.sql';
const base=includeBase?readFileSync(new URL('../supabase/migrations/'+baseFile,import.meta.url),'utf8'):'';
if(includeBase&&/^\s*(begin|commit);\s*$/m.test(base))throw Error('Unexpected prerequisite transaction');
const prerequisiteMigrations=includeBase?[{file:baseFile,sha256:createHash('sha256').update(base).digest('hex')}]:[];
const body=migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
const digest=createHash('sha256').update(migration).digest('hex');
const sql=`-- Intended Value Log project: aalgobngnbvzichztsdo. Raw migration SHA-256: ${digest}.
-- No enrollment, reviewer activation or release switch is enabled by this transaction.
begin isolation level repeatable read;
set local lock_timeout='8s';
set local statement_timeout='120s';
do $$declare r record;begin
 for r in select tablename from pg_tables where schemaname='public' order by tablename loop
  execute format('lock table public.%I in share mode',r.tablename);
 end loop;
 if ${includeBase ? "to_regclass('public.cohort_policies') is not null" : "to_regclass('public.cohort_policies') is null"} then raise exception 'Unexpected cohort database baseline; no migration applied';end if;
 if not exists(select 1 from public.member_identity_bindings where did='did:iov:member:10000000-0000-4000-8000-000000000001') then raise exception 'Unexpected original Identity; no migration applied';end if;
end$$;
create temp table dated_guard_tables as
 select n.nspname schema_name,c.relname table_name,array_agg(a.attname::text order by a.attnum) original_columns
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
 where c.relkind='r' and n.nspname in ('public','auth','storage') and a.attnum>0 and not a.attisdropped
 group by n.nspname,c.relname;
create temp table dated_guard_rows(phase text,schema_name text,table_name text,row_hash text,row_count bigint,primary key(phase,schema_name,table_name,row_hash));
create function pg_temp.dated_collect_rows(p_phase text) returns void language plpgsql as $$
declare r record; projection text;
begin
 for r in select * from dated_guard_tables loop
  -- Project the exact original columns in SQL before JSON serialization. Rebuilding
  -- every row through jsonb_each/object_agg needlessly expands large narratives.
  select string_agg(format('%I',name),',' order by ordinal) into projection
   from unnest(r.original_columns) with ordinality as columns(name,ordinal);
  execute format('insert into dated_guard_rows select $1,$2,$3,encode(sha256(convert_to(to_jsonb(original_values)::text,''UTF8'')),''hex''),count(*) from (select %s from %I.%I) original_values group by 4',projection,r.schema_name,r.table_name)
  using p_phase,r.schema_name,r.table_name;
 end loop;
end$$;
select jsonb_build_object('guardPhase','before_original_values','at',clock_timestamp());
select pg_temp.dated_collect_rows('before');
select jsonb_build_object('guardPhase','before_migration','at',clock_timestamp());
create temp table dated_guard_relations as select c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage');
create temp table dated_guard_policies as select oid,to_jsonb(p) content from pg_policy p;
create temp table dated_guard_triggers as select oid,pg_get_triggerdef(oid) definition from pg_trigger;
${base}
${body}
select jsonb_build_object('guardPhase','after_migration','at',clock_timestamp());
select pg_temp.dated_collect_rows('after');
analyze dated_guard_rows;
select jsonb_build_object('guardPhase','verify_original_values','at',clock_timestamp());
do $$begin
 -- Match every original row using every original column. Added columns and the
 -- reviewed eligibility/policy insertions cannot conceal a changed original value.
 raise notice 'guard_step=original_values';
 if exists(select 1 from dated_guard_rows b left join dated_guard_rows a on a.phase='after' and a.schema_name=b.schema_name and a.table_name=b.table_name and a.row_hash=b.row_hash where b.phase='before' and coalesce(a.row_count,0)<b.row_count) then raise exception 'Original values changed; dated migration rolled back';end if;
 raise notice 'guard_step=unexpected_writes';
 if exists(with b as(select * from dated_guard_rows where phase='before'),a as(select * from dated_guard_rows where phase='after') select 1 from b full join a using(schema_name,table_name,row_hash) where coalesce(b.row_count,0)<>coalesce(a.row_count,0) and not(coalesce(b.schema_name,a.schema_name)='public' and coalesce(b.table_name,a.table_name) in ('cohort_policies','cohort_invitations'))) then raise exception 'Unexpected original-table writes; dated migration rolled back';end if;
 raise notice 'guard_step=existing_access';
 if exists(select 1 from dated_guard_relations b left join pg_class a on a.oid=b.oid where a.oid is null or a.relacl is distinct from b.relacl or a.relrowsecurity is distinct from b.relrowsecurity or a.relforcerowsecurity is distinct from b.relforcerowsecurity or a.reloptions is distinct from b.reloptions) then raise exception 'Original privileges or RLS changed; dated migration rolled back';end if;
 if exists(select 1 from dated_guard_policies b left join pg_policy a on a.oid=b.oid where to_jsonb(a) is distinct from b.content) then raise exception 'Original policy changed; dated migration rolled back';end if;
 if exists(select 1 from dated_guard_triggers b left join pg_trigger a on a.oid=b.oid where a.oid is null or pg_get_triggerdef(a.oid) is distinct from b.definition) then raise exception 'Original trigger changed; dated migration rolled back';end if;
 raise notice 'guard_step=new_access';
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='public' and (c.relname='native_log_day_index' or c.relname like 'cohort_%') and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'))) then raise exception 'New storage is not restricted; dated migration rolled back';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_dated_field_station_eligibility','enroll_dated_field_station','index_legacy_native_day','claim_cohort_queue_cursor','advance_cohort_queue_cursor','confirm_member_day_log','confirm_dated_native_log','designate_dated_account','bind_qa_member','complete_minimal_member_setup','cohort_command','confirm_cohort_log','claim_cohort_review','finish_cohort_review','promote_cohort_replay') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'New command authority is not restricted; dated migration rolled back';end if;
 raise notice 'guard_step=no_enrollment';
 if exists(select 1 from public.cohort_enrollments where policy_id in ('field-station-oct26-28-700-v1','field-station-oct26-28-qa-v1')) then raise exception 'Migration unexpectedly enrolled a member';end if;
end$$;
commit;
select jsonb_build_object('migration','${migrationFile}','migrationSha256','${digest}','existingTables',(select count(*) from dated_guard_tables),'originalColumnValuesPreserved',true,'originalAclRlsPoliciesTriggersUnchanged',true,'allowedMetadataInsertionTables',jsonb_build_array('cohort_policies','cohort_invitations'),'newSharedTables',${includeBase?14:3},'newPolicyEnrollments',0,'prerequisiteMigrations','${JSON.stringify(prerequisiteMigrations)}'::jsonb) as preservation_report;
`;
const path=process.env.IOV_DATED_GUARD_SQL||'/private/tmp/iov-dated-field-station-guarded.sql';
const metadata={project:'aalgobngnbvzichztsdo',migrationFile,prerequisiteMigrations,migrationSha256:digest,guardSha256:createHash('sha256').update(sql).digest('hex'),path,databaseConnected:false};
writeFileSync(path,sql,{mode:0o600});writeFileSync(path+'.metadata.json',JSON.stringify(metadata,null,2),{mode:0o600});console.log(JSON.stringify(metadata));
