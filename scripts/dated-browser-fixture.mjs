// Real PostgreSQL + PostgREST + Next.js; fictional authentication and providers.
// This creates its own socket-only database. It never loads deployment env files.
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { encryptNarrative } from '../src/lib/crypto.ts';
import { nativeColumns, readNativeContent } from '../src/lib/native-log/storage-core.ts';
const node = process.execPath, pg = process.env.IOV_TEST_PG_BIN || (process.platform==='darwin'?'/opt/homebrew/opt/postgresql@17/bin':spawnSync('pg_config',['--bindir'],{encoding:'utf8'}).stdout.trim());
if(readdirSync('.').some(name=>name.startsWith('.env')&&name!=='.env.example'))throw Error('ISOLATED_CHECKOUT_WITHOUT_ENV_FILES_REQUIRED');
const postgrest = process.env.IOV_TEST_POSTGREST_BIN || '/private/tmp/iov-field-station-tools/postgrest';
if (!existsSync(postgrest)) throw Error('Install the verified official local PostgREST binary first; see the dated test runbook.');
const dir = mkdtempSync(join(existsSync('/private/tmp')?'/private/tmp':tmpdir(),'iov-dated-browser.')), env = { ...process.env, PGHOST: dir, PGPORT:'55473', PGUSER:'postgres', PGDATABASE:'postgres', PGPASSWORD:'' };
const app = 'http://127.0.0.1:4200', api = 'http://127.0.0.1:4202', rest = 'http://127.0.0.1:4203';
const instanceId=process.env.IOV_SYNTHETIC_INSTANCE_ID || randomBytes(16).toString('hex');
const secret = randomBytes(40), encryption = randomBytes(32).toString('base64'), digest = randomBytes(32).toString('hex');
const founder = '11111111-1111-4111-8111-111111111111';
const owner = n => `20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const accounts = Object.fromEntries([['member-a',owner(1)],['member-b',owner(2)],['member-sis',owner(3)],['outside',owner(14)],['outside-legacy',owner(15)],['pilot',founder]]);
for(let n=4;n<=13;n++)accounts['load-'+n]=owner(n);
function run(name, args, input) { const r = spawnSync(join(pg,name),args,{ env, input, encoding:'utf8', maxBuffer:12e6 }); if (r.status !== 0) throw Error(`${name}: ${r.stderr || r.error}`); return r.stdout; }
const sql = text => run('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],text);
function jwt(role, sub) { const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), p=Buffer.from(JSON.stringify({ role, ...(sub?{sub}:{}), aud:'authenticated', iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200 })).toString('base64url');return `${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`; }
function subject(req) { try { const [h,p,s]=(req.headers.authorization||'').replace(/^Bearer /,'').split('.'); if(createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')!==s)return null; return JSON.parse(Buffer.from(p,'base64url')).sub || null; } catch { return null; } }
const user = id => ({id,aud:'authenticated',role:'authenticated',email:id===founder?'synthetic-founder@example.test':`synthetic-${id}@example.test`,email_confirmed_at:'2026-10-26T00:00:00Z',app_metadata:{provider:'google',providers:['google'],identity_issuer:'word-wallet-web',identity_did:`did:iov:member:${id}`},user_metadata:{},created_at:'2026-10-26T00:00:00Z'});
const children=[]; let started=false, stopping=false, expired=false, failSave=false, jobs=0, failedJobs=0, nextTranscript="standard", holdReview=false;
const providerCalls={stt:0,chat:0};
const json = (res,value,status=200,headers={}) => {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(value));};
const response = data => ({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]});
async function body(req) {let text='';for await(const part of req){text+=part;if(text.length>2e6)throw Error('FIXTURE_INPUT_LIMIT');}return text;}
async function provider(req,res,url) {
  if(req.headers['api-subscription-key']!=='synthetic-dated-provider')return json(res,{},403);
  if(url.pathname.endsWith('speech-to-text')){providerCalls.stt++;await body(req);return json(res,{transcript:nextTranscript==='neutral'?'Actually, that walk caused no change in my physical wellbeing. Keep the same activity and times.':nextTranscript==='approximate'?'I walked from 8am until around 8:30am and my physical wellbeing improved a little. I worked on a paid website from 10am to noon.':'I walked from 8am to 8:30am and my physical wellbeing improved a little. I worked on a paid website from 10am to noon.'});}
  providerCalls.chat++;
  const envelope=JSON.parse(await body(req)), operation=envelope.messages[0].content.split('\n')[0], input=JSON.parse(envelope.messages.at(-1).content);
  if(operation.includes('omission_check'))return json(res,response({actions:input.rows.map(r=>({quote:r.sourceQuote,summary:r.activity,node:r.node,kind:'activity',activityId:r.id}))}));
  if(operation.includes('cohort_review'))return json(res,response({decisions:input.records.map(r=>({recordId:r.recordId,supportedNode:'Physiology',decision:{outcome:'reviewed',rationale:'Explicit synthetic first-person activity and reported effect are supported.',question:'',evidenceQuotes:[r.activity.quote]}}))}));
  if(operation.includes('conversation'))return json(res,response({updates:input.activities.filter(a=>a.node==='Physiology').map(a=>({id:a.id,changes:{direction:'neutral',intensity:null,confidence:'observed'}})),additions:[],removed:[]}));
  const words=input.transcript || '', date=input.date;
  const activities=[{id:null,activity:'Synthetic walk',sourceQuote:words.includes('until around')?'I walked from 8am until around 8:30am and my physical wellbeing improved a little.':'I walked from 8am to 8:30am and my physical wellbeing improved a little.',startLocal:date+'T08:00',endLocal:date+'T08:30',node:'Physiology',context:null,proof:null,sleepRest:false,community:null,lane:null,direction:'positive',intensity:'low',confidence:'observed'}, {id:null,activity:'Synthetic website work',sourceQuote:'I worked on a paid website from 10am to noon.',startLocal:date+'T10:00',endLocal:date+'T12:00',node:'Performance',context:'Paid website work',proof:null,sleepRest:false,community:null,lane:'Earning',direction:null,intensity:null,confidence:null}].filter(a=>words.includes(a.sourceQuote));
  return json(res,response({activities}));
}
const server=createServer(async(req,res)=>{try {
  const url=new URL(req.url,api), id=subject(req);
  if(url.pathname.startsWith('/rest/v1/')){
    if(failSave && req.method==='POST' && url.pathname.endsWith('save_native_log_draft')){failSave=false;await body(req);return json(res,{message:'synthetic temporary save failure'},503);}
    const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
    const r=await fetch(rest+url.pathname.slice('/rest/v1'.length)+url.search,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:await body(req)})});
    res.writeHead(r.status,Object.fromEntries([...r.headers].filter(([k])=>!['content-encoding','content-length','transfer-encoding'].includes(k))));res.end(Buffer.from(await r.arrayBuffer()));return;
  }
  if(url.pathname==='/auth/v1/user')return id&&!expired?json(res,user(id)):json(res,{msg:'Synthetic session expired'},401);
  if(url.pathname.startsWith('/test-provider/'))return await provider(req,res,url);
  if(url.pathname==='/test-native-job'||url.pathname==='/test-cohort-job'){
    const raw=await body(req),signature=req.headers[url.pathname==='/test-native-job'?'x-value-log-native-job':'x-cohort-job']||''; jobs++;
    if(url.pathname==='/test-cohort-job' && holdReview)return json(res,{},202);
    const worker=spawn(node,['--import','tsx','--import','./scripts/dated-provider-fixture.mjs','scripts/dated-worker-fixture.mjs'],{env:process.env,stdio:['pipe','ignore','pipe']});children.push(worker);
    worker.stderr.on('data',part=>process.stderr.write(part));worker.on('close',code=>{if(code!==0)failedJobs++;});worker.stdin.end(JSON.stringify({kind:url.pathname==='/test-native-job'?'native':'cohort',raw,signature}));
    return json(res,{},202);
  }
  if(url.pathname==='/test/status')return json(res,{syntheticOnly:true,instanceId,jobs,failedJobs,providerCalls,counts:sql('select json_build_object(\'enrollments\',count(*)) from cohort_enrollments;').trim()});
  if(url.pathname==='/test/hold-review'||url.pathname==='/test/release-review'){holdReview=url.pathname==='/test/hold-review';return json(res,{syntheticOnly:true,holdReview});}
  if(url.pathname==='/test/sweep'){
    const worker=spawn(node,['--import','tsx','--import','./scripts/dated-provider-fixture.mjs','scripts/dated-worker-fixture.mjs'],{env:{...process.env,CONTEXT:'production'},stdio:['pipe','pipe','pipe']});children.push(worker);let output='';worker.stdout.on('data',part=>output+=part);worker.stderr.on('data',part=>process.stderr.write(part));worker.stdin.end(JSON.stringify({kind:'queue'}));const code=await new Promise(resolve=>worker.on('close',resolve));return json(res,{syntheticOnly:true,passed:code===0,output});
  }
  if(['/test/transcript/neutral','/test/transcript/standard','/test/transcript/approximate'].includes(url.pathname)){nextTranscript=url.pathname.split('/').at(-1);return json(res,{syntheticOnly:true,mode:nextTranscript});}
  if(url.pathname==='/test/diagnostics'){
    // Content-free evidence only: stage/outcome/route/actor shape and a word-leak count, never metadata values.
    const rows=JSON.parse(sql(`select coalesce(json_agg(json_build_object('stage',metadata->>'stage','outcome',metadata->>'outcome','route',metadata->>'route','actor',actor_type,'owned',owner_id is not null)),'[]') from public.audit_events where event_type='native_log_diagnostic';`).trim());
    const leaks=Number(sql(`select count(*) from public.audit_events where event_type='native_log_diagnostic' and metadata::text ~* '(walk|wellbeing|physical|morning)';`).trim());
    return json(res,{syntheticOnly:true,diagnostics:rows,wordMatches:leaks});
  }
  if(url.pathname==='/test/expire'){expired=true;return json(res,{});}
  if(url.pathname==='/test/fail-save'){failSave=true;return json(res,{});}
  if(url.pathname==='/test/legacy-day-index'){
    const draft=url.searchParams.get('draft');if(!/^[0-9a-f-]{36}$/.test(draft??''))throw Error('SYNTHETIC_INPUT');
    const row=JSON.parse(sql(`select row_to_json(r) from(select owner_id,${nativeColumns} from native_log_drafts where id='${draft}' and owner_id='${owner(15)}' and status='submitted' and receipt->>'kind'='unassessed') r;`)),content=readNativeContent(row);
    if(content.document.activities.length!==row.receipt.ids.length)throw Error('SYNTHETIC_LEGACY_SHAPE');
    const entries=content.document.activities.map((activity,i)=>{const id=row.receipt.ids[i],c=encryptNarrative(JSON.stringify({date:content.document.date,node:activity.node,text:activity.activity,minutes:null}));return `insert into member_activity_entries(owner_id,id,revision,activity_date,wellbeing_node,content_ciphertext,content_iv,content_auth_tag,content_key_version,content_digest)values('${row.owner_id}','${id}',1,'${content.document.date}','${activity.node}','${c.ciphertext}','${c.iv}','${c.authTag}',${c.keyVersion},'${c.digest}') on conflict do nothing;`;}).join('\n');
    sql(`begin; ${entries} update native_log_drafts set receipt=receipt-'dayIndexVersion' where id='${draft}'; delete from native_log_day_index where native_draft_id='${draft}'; commit;`);
    return json(res,{syntheticOnly:true});
  }
  const selected=accounts[url.pathname.slice('/test/'.length)];
  if(url.pathname.startsWith('/test/')&&selected){expired=false;const cookies=[],sb=createServerClient(api,jwt('anon'),{cookies:{getAll:()=>[],setAll:items=>cookies.push(...items)}});const r=await sb.auth.setSession({access_token:jwt('authenticated',selected),refresh_token:'synthetic-dated-refresh'});if(r.error)throw Error('FIXTURE_AUTH_FAILED');res.writeHead(302,{'x-synthetic-binding':createHmac('sha256',digest).update('value-log-member-write:'+selected).digest('hex'),'x-synthetic-owner-scope':createHmac('sha256',digest).update('value-log-native-draft:'+selected).digest('hex'),'set-cookie':cookies.map(c=>`${c.name}=${c.value}; Path=/; SameSite=Lax`),location:app+'/day?date=2026-10-26'});res.end();return;}
  json(res,{syntheticOnly:true,accounts:Object.keys(accounts),entry:api+'/test/member-a'});
}catch(error){console.error('Synthetic fixture:',error.message);json(res,{error:'SYNTHETIC_FIXTURE_FAILURE'},500);}});
async function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');server.close();if(started)run('pg_ctl',['-D',join(dir,'data'),'-m','fast','stop']);rmSync(dir,{recursive:true,force:true});}
try {
  run('initdb',['-D',join(dir,'data'),'-U','postgres','--auth=trust','--no-locale']);run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'pg.log'),'-o',`-k ${dir} -p 55473 -h ''`,'start']);started=true;
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator login;grant anon,authenticated,service_role to authenticator;create schema extensions;create extension pgcrypto with schema extensions;alter database postgres set search_path=public,extensions;grant usage on schema extensions to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant all on sequences to authenticated,service_role;insert into auth.users(id,email)values('${founder}','synthetic-founder@example.test');`);
  for(const file of readdirSync(resolve('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){if(file==='202607060001_wellbeing_identity_binding.sql')sql(`insert into members(id,email,display_name)values('${founder}','synthetic-founder@example.test','Synthetic founder control');`);sql(readFileSync(resolve('supabase/migrations',file),'utf8'));}
  for(let n=1;n<=15;n++){const id=owner(n),did=`did:iov:member:${id}`,alias='identity-'+createHmac('sha256',secret).update(id).digest('hex')+'@members.valuelog.invalid';sql(`insert into auth.users(id,email,raw_app_meta_data)values('${id}','${alias}',jsonb_build_object('identity_issuer','word-wallet-web','identity_did','${did}'));select admit_value_log_member('${id}','${did}','${alias}');select complete_minimal_member_setup('${id}');update member_log_access set admitted_at='2026-10-${n>=14?'29':'26'}T00:00:00+05:30' where owner_id='${id}';delete from cohort_invitations where eligible_owner='${id}';`);if(n<14)sql(`select designate_dated_account('${founder}','${did}','field-station-oct26-28-qa-v1','${n===3?'house_of_sis':'house_of_bros'}','synthetic-harness');`);}
  sql(`update cohort_agents set operator_did='did:iov:member:${owner(2)}',accepted_at=now(),active=true;`);
  const service=jwt('service_role'),anon=jwt('anon');
  Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,NARRATIVE_ENCRYPTION_KEY_BASE64:encryption,AUDIT_DIGEST_KEY:digest,NARRATIVE_KEY_VERSION:'1',NEXT_PUBLIC_APP_URL:app,MOSES_EMAIL_ALLOWLIST:'synthetic-founder@example.test',VALUE_LOG_MEMBER_WRITING:'open',VALUE_LOG_MEMBER_ADMISSION:'closed',VALUE_LOG_NATIVE_LOGGING:'open',SARVAM_API_KEY:'synthetic-dated-provider',VALUE_LOG_SHARED_DAY:'open',VALUE_LOG_DEVICE_RECOVERY:'open',VALUE_LOG_OMISSION_CHECK:'open',VALUE_LOG_DATED_ENROLLMENT:'qa',VALUE_LOG_DATED_REVIEW:'qa',VALUE_LOG_DATED_CALCULATION:'qa',VALUE_LOG_COHORT_ENROLLMENT:'closed',VALUE_LOG_COHORT_REVIEW:'closed',VALUE_LOG_COHORT_CALCULATION:'closed'});
  await import('./dated-provider-fixture.mjs');
  const restChild=spawn(postgrest,[],{env:{...process.env,PGRST_DB_URI:`postgresql://authenticator@/postgres?host=${encodeURIComponent(dir)}&port=55473`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret.toString('base64'),PGRST_JWT_SECRET_IS_BASE64:'true',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'4203'},stdio:['ignore','ignore','pipe']});children.push(restChild);restChild.stderr.on('data',chunk=>process.stderr.write(chunk));
  await new Promise(resolve=>server.listen(4202,'127.0.0.1',resolve));
  const next=spawn(node,['--import','./scripts/dated-provider-fixture.mjs','node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','4200'],{env:{...process.env,NODE_ENV:'development'},stdio:'inherit'});children.push(next);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void stop().then(()=>process.exit(0));});
  console.log('Synthetic dated journey: '+api+'/test/member-a');
}catch(error){await stop();throw error;}
