// Generates a reviewable transaction only; never connects to any database.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const migration=readFileSync(new URL('../supabase/migrations/202610260001_field_station.sql',import.meta.url),'utf8');
const digest=createHash('sha256').update(migration).digest('hex');
const sql=`-- Field Station additive migration ${digest}; intended Value Log project aalgobngnbvzichztsdo.
-- New cohort objects only. Close all three cohort switches before applying.
begin;
set local lock_timeout='8s';
set local statement_timeout='120s';
-- Managed auth/storage tables cannot be explicitly locked. They are fingerprinted below.
do $$declare r record;begin for r in select tablename from pg_tables where schemaname='public' order by tablename loop execute format('lock table public.%I in share mode',r.tablename);end loop;end$$;
create function pg_temp.cohort_guard_rows() returns jsonb language plpgsql as $$declare r record;n bigint;h text;result jsonb:='{}';begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('public','auth','storage') loop
 execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(row_hash, '''' order by row_hash),''''),''UTF8'')),''hex'') from (select encode(sha256(convert_to(to_jsonb(t)::text,''UTF8'')),''hex'') row_hash from %I.%I t) hashed',r.schemaname,r.tablename) into n,h;
 result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,jsonb_build_object('count',n,'digest',h));end loop;return result;end$$;
create temp table cohort_guard_before as select pg_temp.cohort_guard_rows() rows;
create temp table cohort_guard_relations as select c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage');
create temp table cohort_guard_policies as select oid,to_jsonb(p) content from pg_policy p;
create temp table cohort_guard_triggers as select oid,pg_get_triggerdef(oid) definition from pg_trigger;
do $$begin if not exists(select 1 from public.member_identity_bindings where did='did:iov:member:10000000-0000-4000-8000-000000000001') then raise exception 'Unexpected original Identity; no migration applied';end if;end$$;
${migration}
create temp table cohort_guard_after as select pg_temp.cohort_guard_rows() rows;
do $$declare before_rows jsonb;after_rows jsonb;begin
 select rows into before_rows from cohort_guard_before;select rows into after_rows from cohort_guard_after;
 if exists(select 1 from jsonb_each(before_rows) b where after_rows->b.key is distinct from b.value) then raise exception 'Original rows changed; migration rolled back';end if;
 if exists(select 1 from cohort_guard_relations b left join pg_class a on a.oid=b.oid where a.oid is null or a.relacl is distinct from b.relacl or a.relrowsecurity is distinct from b.relrowsecurity or a.relforcerowsecurity is distinct from b.relforcerowsecurity or a.reloptions is distinct from b.reloptions) then raise exception 'Original privileges or RLS changed; migration rolled back';end if;
 if exists(select 1 from cohort_guard_policies b left join pg_policy a on a.oid=b.oid where to_jsonb(a) is distinct from b.content) then raise exception 'Original policy changed; migration rolled back';end if;
 if exists(select 1 from cohort_guard_triggers b left join pg_trigger a on a.oid=b.oid where a.oid is null or pg_get_triggerdef(a.oid) is distinct from b.definition) then raise exception 'Original trigger changed; migration rolled back';end if;
 if exists(select 1 from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='public' and t.tablename like 'cohort_%' and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'))) then raise exception 'Cohort access is not restricted; migration rolled back';end if;
 if (select count(*) from public.cohort_enrollments)<>0 or (select active from public.cohort_agents where id='system:field-station-reviewer:v1') then raise exception 'Unexpected enrollment or active agent';end if;
end$$;
commit;
select jsonb_build_object('migration','202610260001_field_station.sql','sha256','${digest}','existingTables',(select count(*) from jsonb_object_keys((select rows from cohort_guard_before))),'existingRowsUnchanged',true,'originalAclRlsPoliciesTriggersUnchanged',true,'newCohortTables',11,'enrolled',0,'reviewerActive',false) as preservation_report;
`;
const target=process.env.IOV_COHORT_GUARD_SQL||'/private/tmp/iov-field-station-guarded.sql';writeFileSync(target,sql,{mode:0o600});console.log(JSON.stringify({prepared:true,migrationSha256:digest,path:target,databaseConnected:false}));
