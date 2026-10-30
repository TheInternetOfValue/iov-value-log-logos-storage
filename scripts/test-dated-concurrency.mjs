import { spawn } from 'node:child_process';
// Only called with the disposable socket-only cluster created by test-member-database.
export async function testDatedConcurrency(env, psql) {
  const execute = input => new Promise((resolve,reject) => {
    const child=spawn(psql,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);
  });
  async function paired(firstSql, secondSql) {
    const child=spawn(psql,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    const ready=new Promise((resolve,reject)=>{child.stdout.on('data',part=>{stdout+=part;if(stdout.includes('LOCK_READY'))resolve();});child.on('error',reject);child.on('exit',code=>{if(!stdout.includes('LOCK_READY'))reject(Error('Dated first writer stopped: '+code));});});
    child.stderr.on('data',part=>stderr+=part);const closed=new Promise(resolve=>child.on('close',resolve));child.stdin.end(firstSql);await ready;
    const second=await execute(secondSql);return {code:await closed,stdout,stderr,second};
  }
  const owner='70000000-0000-4000-8000-000000000001', did='did:iov:member:'+owner, alias='identity-'+'d'.repeat(64)+'@members.valuelog.invalid';
  const setup=await execute(`insert into auth.users(id,email,raw_app_meta_data)values('${owner}','${alias}',jsonb_build_object('identity_issuer','word-wallet-web','identity_did','${did}'));select admit_value_log_member('${owner}','${did}','${alias}');select complete_minimal_member_setup('${owner}');update member_log_access set admitted_at='2026-10-26T00:00:00+05:30' where owner_id='${owner}';select record_dated_field_station_eligibility('${owner}');`);
  if(setup.code!==0)throw Error('Dated concurrency setup: '+setup.stderr);
  const enroll=`select enroll_dated_field_station('${owner}','field-station-oct26-28-700-v1',true,true,'house_of_bros');`;
  const enrollment=await paired(`begin;${enroll}select 'LOCK_READY';select pg_sleep(1);commit;`,enroll);
  if(enrollment.code!==0||enrollment.second.code!==0)throw Error('Concurrent dated enrollment failed: '+enrollment.stderr+enrollment.second.stderr);
  const cardinality=await execute(`select count(*)=1 from cohort_enrollments where owner_id='${owner}';select count(*)=1 from cohort_memberships where owner_id='${owner}';select count(*)=1 from cohort_reviewer_delegations where owner_id='${owner}';select revision=1 from cohort_enrollments where owner_id='${owner}';`);
  if(cardinality.stdout.trim()!=='t\nt\nt\nt')throw Error('Concurrent enrollment duplicated or reset state');
  const historical='70000000-0000-4000-8000-000000000002', first='70000000-0000-4000-8000-000000000003', second='70000000-0000-4000-8000-000000000004';
  const cipher=JSON.stringify({ciphertext:'syntheticencryptedtext',iv:'i'.repeat(16),authTag:'t'.repeat(24),keyVersion:1,digest:'a'.repeat(64)});
  const source=await execute(`insert into native_log_drafts(owner_id,id,revision,status,receipt,content_ciphertext,content_iv,content_auth_tag,content_key_version,content_digest)values('${owner}','${historical}',1,'submitted','{"kind":"unassessed","count":1,"ids":[],"dates":["2026-10-26"],"timezone":"Asia/Kolkata"}','syntheticencryptedtext',repeat('i',16),repeat('t',24),1,repeat('a',64));select save_native_log_draft('${owner}','${first}',0,'${cipher}');select save_native_log_draft('${owner}','${second}',0,'${cipher}');`);
  if(source.code!==0)throw Error('Adoption concurrency fixture failed');
  const approve=(draft,hour)=>`select confirm_dated_native_log('${owner}','${draft}',1,repeat('a',64),'Fresh synthetic adoption approval',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'occurrenceId',gen_random_uuid(),'start','2026-10-26T${hour}:00:00+05:30','end','2026-10-26T${hour}:30:00+05:30','node','Physiology','outcome','pending','content','${cipher}'::jsonb)),'{"kind":"cohort_review_pending","sourceReferenced":true,"dayIndexVersion":1,"count":1,"ids":[],"dates":["2026-10-26"],"timezone":"Asia/Kolkata"}',null,'${historical}');`;
  const adoption=await paired(`begin;${approve(first,'08')}select 'LOCK_READY';select pg_sleep(1);commit;`,approve(second,'09'));
  if(adoption.code!==0||adoption.second.code===0||!adoption.second.stderr.includes('ADOPTION_ALREADY_USED'))throw Error('Concurrent adoption did not reject duplicate history: '+adoption.stderr+adoption.second.stderr);
  const final=await execute(`select count(*)=1 from cohort_records where owner_id='${owner}';select count(*)=1 from cohort_source_links where owner_id='${owner}' and kind='adoption';select status='draft' from native_log_drafts where owner_id='${owner}' and id='${second}';select receipt->>'kind'='unassessed' and revision=1 from native_log_drafts where owner_id='${owner}' and id='${historical}';`);
  if(final.stdout.trim()!=='t\nt\nt\nt')throw Error('Concurrent adoption changed source or partially confirmed the losing writer');
  console.log('PASS: concurrent dated enrollment is idempotent; concurrent history adoption preserves the source and scores it only once.');
}
