// Real PostgreSQL rehearsal. Always creates and removes its own synthetic cluster;
// no connection string, project credential or existing database is accepted.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { testCohortConcurrency } from './test-cohort-concurrency.mjs';
import { testNativeConcurrency } from './test-native-concurrency.mjs';
import { testDatedConcurrency } from './test-dated-concurrency.mjs';
const bin = process.env.IOV_TEST_PG_BIN || '';
const command = name => bin ? join(bin, name) : name;
const dir = mkdtempSync(join(existsSync('/private/tmp') ? '/private/tmp' : tmpdir(), 'iov-member-test.'));
const env = { ...process.env, PGHOST: dir, PGPORT: '55472', PGUSER: 'postgres', PGDATABASE: 'postgres', PGPASSWORD: '' };
function run(name, args, input) {
  const r = spawnSync(command(name), args, { env, encoding: 'utf8', input, maxBuffer: 8e6 });
  if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr || r.error || r.stdout}`);
  return r.stdout;
}
const sql = content => run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], content);
let started = false;
try {
  run('initdb', ['-D', join(dir, 'data'), '-U', 'postgres', '--auth=trust', '--no-locale']);
  run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'server.log'), '-o', `-k ${dir} -p 55472 -h ''`, 'start']); started = true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions; create extension pgcrypto with schema extensions; alter database postgres set search_path=public,extensions; grant usage on schema extensions to anon,authenticated,service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to authenticated, service_role;
    insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','pilot@example.test');`);
  const files = readdirSync(resolve('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (file === '202610260001_field_station.sql' && process.env.IOV_DATED_GUARD_SQL && JSON.parse(readFileSync(process.env.IOV_DATED_GUARD_SQL+'.metadata.json','utf8')).prerequisiteMigrations?.some(item => item.file === file)) continue;
    if (file === '202607060001_wellbeing_identity_binding.sql') {
      sql(`insert into public.members(id,email,display_name) values('11111111-1111-4111-8111-111111111111','pilot@example.test','Original pilot fixture');`);
    }
    const migrationSql=readFileSync(file === '202610260001_field_station.sql' && process.env.IOV_COHORT_GUARD_SQL ? process.env.IOV_COHORT_GUARD_SQL : file === '202610270001_dated_field_station.sql' && process.env.IOV_DATED_GUARD_SQL ? process.env.IOV_DATED_GUARD_SQL : resolve('supabase/migrations', file), 'utf8');
    if(file==='202610270001_dated_field_station.sql' && process.env.IOV_DATED_GUARD_SQL){
      // Small happy-path fixtures missed the unindexed snapshot comparison cost.
      // This synthetic table exists only in this disposable cluster.
      sql("create table public.guard_load_fixture(id integer primary key,payload text not null); alter table public.guard_load_fixture enable row level security; revoke all on public.guard_load_fixture from anon,authenticated; insert into public.guard_load_fixture select n,repeat('fictional-preservation-load-',20) from generate_series(1,20000) n;");
      const marker="select jsonb_build_object('guardPhase','after_migration'";
      if(!migrationSql.includes(marker))throw Error('Expected preservation phase marker');
      const destructiveProbe=migrationSql.replace(marker,"alter table public.members add column guard_probe text; update public.members set display_name='Changed synthetic original' where id='11111111-1111-4111-8111-111111111111';\n"+marker);
      const rejected=spawnSync(command('psql'),['-X','-q','-v','ON_ERROR_STOP=1'],{env,encoding:'utf8',input:destructiveProbe,maxBuffer:1000000});
      if(rejected.status===0||!rejected.stderr.includes('Original values changed; dated migration rolled back'))throw Error('Preservation guard failed to reject an original value change');
      const intact=run('psql',['-X','-q','-A','-t'],"select display_name='Original pilot fixture' and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='guard_probe') from public.members where id='11111111-1111-4111-8111-111111111111';").trim();
      if(intact!=='t')throw Error('Rejected guard probe did not roll back');
      console.log('PASS: changed-original-column probe rejected and rolled back, including its added column.');
    }
    sql(migrationSql);
  }
  const result = sql(readFileSync(resolve('supabase/tests/member_identity_contract.sql'), 'utf8'));
  const nativeResult = sql(readFileSync(resolve('supabase/tests/native_log_contract.sql'), 'utf8'));
  console.log(nativeResult.trim());
  console.log(sql(readFileSync(resolve('supabase/tests/native_log_mirror_contract.sql'), 'utf8')).trim());
  const cohortResult = sql(readFileSync(resolve('supabase/tests/cohort_contract.sql'), 'utf8'));
  console.log(cohortResult.trim());
  console.log(sql(readFileSync(resolve("supabase/tests/cohort_extended_contract.sql"), "utf8")).trim());
  console.log(sql(readFileSync(resolve("supabase/tests/dated_field_station_contract.sql"), "utf8")).trim());
  await testCohortConcurrency(env, command("psql"));
  await testNativeConcurrency(env, command('psql'));
  await testDatedConcurrency(env, command('psql'));
  writeFileSync(join(dir, 'result.txt'), result + nativeResult);
  console.log(result.trim());
  console.log(`PASS: ${files.length} migrations applied to isolated PostgreSQL; member admission, RLS and preservation assertions passed.`);
} finally {
  if (started) run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', 'stop']);
  rmSync(dir, { recursive: true, force: true });
}
