import { spawn } from 'node:child_process';
// Called only with the isolated test cluster's exact environment.
export async function testNativeConcurrency(env, psql) {
  const execute = input => new Promise((resolve,reject)=>{
    const proc=spawn(psql,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    proc.stdout.on('data',chunk=>stdout+=chunk);proc.stderr.on('data',chunk=>stderr+=chunk);proc.on('error',reject);proc.on('close',code=>resolve({code,stdout,stderr}));proc.stdin.end(input);
  });
  for(const [index,firstSource] of ['native_voice','custom_gpt'].entries()) {
    const day=`2030-01-0${index+1}`,owner='11111111-1111-4111-8111-111111111111';
    const insert=source=>`insert into public.canonical_slices(protocol_link_id,revision_number,draft_slice_id,owner_id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community,impact_direction,impact_intensity,confidence,status) select gen_random_uuid(),1,id,'${owner}','${day}T08:00Z','${day}T09:00Z','UTC','Concurrent boundary test','Physiology','non_performance','house_of_bros','neutral','low','observed','validation_pending' from public.draft_slices where activity='Concurrent ${index} ${source}';`;
    const setup=await execute(`insert into public.intake_sessions(owner_id,source,parser_version,idempotency_key,timezone,narrative_ciphertext,narrative_iv,narrative_auth_tag,narrative_key_version,narrative_digest) values('${owner}','native_voice','synthetic','concurrent-${index}','UTC','x','i','t',1,'d');
      insert into public.draft_slices(intake_session_id,owner_id,machine_source,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community,impact_direction,impact_intensity,confidence)
      select s.id,'${owner}',v.source,'${day}T08:00Z','${day}T09:00Z','UTC','Concurrent ${index} '||v.source,'Physiology','non_performance','house_of_bros','neutral','low','observed' from public.intake_sessions s cross join (values('native_voice'),('custom_gpt')) v(source) where s.idempotency_key='concurrent-${index}';`);
    if(setup.code!==0)throw new Error(setup.stderr);
    const first=spawn(psql,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});let output='',error='';
    const ready=new Promise((resolve,reject)=>{first.stdout.on('data',chunk=>{output+=chunk;if(output.includes('LOCK_READY'))resolve();});first.on('error',reject);first.on('exit',code=>{if(!output.includes('LOCK_READY'))reject(new Error(`First writer stopped ${code}: ${error}`));});});
    first.stderr.on('data',chunk=>error+=chunk);
    const finished=new Promise(resolve=>first.on('close',resolve));
    first.stdin.end(`begin;${insert(firstSource)}select 'LOCK_READY';select pg_sleep(1);commit;`);
    await ready;
    const second=await execute(`begin;${insert(firstSource==='native_voice'?'custom_gpt':'native_voice')}commit;`);
    const firstCode=await finished;
    if(firstCode!==0||second.code===0||!second.stderr.includes('NATIVE_TIMELINE_OVERLAP')) throw new Error(`Concurrent overlap guard failed (${firstSource} first): ${error} ${second.stderr}`);
  }
  console.log('PASS: concurrent native/legacy writers serialize and reject overlap in both orders.');
}
