// Local-only synthetic service for exercising the real Next.js member screens.
// Never reads deployment env files or accepts a production connection.
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHmac, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServerClient } from '@supabase/ssr';
const native = process.argv.includes('--native');
const drafts = new Map();
const recordingCheck = native ? (await (await import('esbuild')).build({entryPoints:['scripts/native-recording-browser-check.ts'],bundle:true,write:false,platform:'browser',format:'esm'})).outputFiles[0].text : '';
const app = 'http://127.0.0.1:4198', api = 'http://127.0.0.1:4199';
const ownerA = '22222222-2222-4222-8222-222222222222', ownerB = '33333333-3333-4333-8333-333333333333';
const members = new Map([[ownerA, { display_name: 'Synthetic member A', timezone: 'Asia/Kolkata', onboarded: native }], [ownerB, { display_name: 'Synthetic member B', timezone: 'Europe/London', onboarded: true }]]);
const entries = new Map(), audit = [], jwtKey = randomBytes(32), encryptionKey = randomBytes(32).toString('base64'), digestKey = randomBytes(32).toString('hex');
const token = id => {
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',jwtKey).update(`${h}.${p}`).digest('base64url')}`;
};
function subject(req) {
  try {
    const t = req.headers.authorization?.replace(/^Bearer /,'') || '', [h,p,s] = t.split('.');
    if (createHmac('sha256',jwtKey).update(`${h}.${p}`).digest('base64url') !== s) return null;
    return JSON.parse(Buffer.from(p,'base64url').toString()).sub;
  } catch { return null; }
}
const user = id => ({ id, aud:'authenticated', role:'authenticated', email:`synthetic-${id.slice(0,8)}@members.valuelog.invalid`, app_metadata:{provider:'email',providers:['email']}, user_metadata:{}, created_at:'2026-10-25T00:00:00Z' });
let failSave = false, expiredSession = false;
const server = createServer(async(req,res)=>{
  const url = new URL(req.url,api), owner = subject(req);
  const json = (value,status=200,headers={}) => { res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value)); };
  if (url.pathname === '/test/recorder' && native) {
    res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Synthetic recorder check</title><h1>Generated-audio recorder check</h1><p>No microphone, member data or provider is used. Start, wait a few seconds, then finish.</p><button id="start">Start generated recording</button><button id="stop" disabled>Finish generated recording</button><pre id="result">Ready</pre><script type="module" src="/test/recorder.js"></script>');return;
  }
  if (url.pathname === '/test/recorder.js' && native) {
    res.writeHead(200,{'content-type':'application/javascript'});res.end(recordingCheck);return;
  }
  if(url.pathname==='/test-native-job') {
    let raw='';for await(const chunk of req) raw+=chunk;
    const signature=createHmac('sha256',digestKey).update('value-log-native-job:v1:'+raw).digest('hex');
    if(req.headers['x-value-log-native-job']!==signature) return json({error:'unauthorized synthetic job'},403);
    const job=JSON.parse(raw), key=job.owner+':'+job.id;
    setTimeout(()=>{
      const row=drafts.get(key); if(!row||row.revision!==job.revision||row.status!=='draft'||row.lease_token!==job.lease)return;
      const decipher=createDecipheriv('aes-256-gcm',Buffer.from(encryptionKey,'base64'),Buffer.from(row.content_iv,'base64'));decipher.setAuthTag(Buffer.from(row.content_auth_tag,'base64'));
      const content=JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.content_ciphertext,'base64')),decipher.final()]).toString());
      content.document.activities=[{id:randomUUID(),activity:'Synthetic walk',sourceQuote:content.document.transcript.slice(0,1000),startLocal:content.document.date+'T08:00',endLocal:'',startOffset:'',endOffset:'',node:'Physiology',context:'',proof:'',sleepRest:false,community:'',lane:'',direction:'',intensity:'',confidence:''}];content.document.revision++;
      const plaintext=JSON.stringify(content),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(encryptionKey,'base64'),iv);
      Object.assign(row,{content_ciphertext:Buffer.concat([cipher.update(plaintext),cipher.final()]).toString('base64'),content_iv:iv.toString('base64'),content_auth_tag:cipher.getAuthTag().toString('base64'),content_digest:createHmac('sha256',digestKey).update(plaintext).digest('hex'),revision:row.revision+1,lease_token:null,lease_until:null});
    },100);
    return json({},202);
  }
  if (url.pathname.startsWith('/test-provider/')) {
    if(req.headers['api-subscription-key']!=='synthetic-native-provider') return json({error:'synthetic key required'},403);
    let raw=''; for await(const chunk of req) raw+=chunk;
    if(url.pathname.endsWith('speech-to-text')) return json({transcript:'I walked from 8am to 8:30am. Felt better.'});
    const input=JSON.parse(JSON.parse(raw).messages[1].content);
    return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({activities:[{activity:'Walked',sourceQuote:input.transcript,startLocal:input.date+'T08:00',endLocal:null,node:'Physiology',context:null,proof:null,sleepRest:false,community:null,lane:null,direction:null,intensity:null,confidence:null}]})}}]});
  }
  if (url.pathname.startsWith('/test/')) {
    if (url.pathname === '/test/expire') {expiredSession=true;res.writeHead(204);res.end();return;}
    if (url.pathname === '/test/fail-next-save') {failSave=true;res.writeHead(302,{location:app+'/day'});res.end();return;}
    if (url.pathname === '/test/capture-recovery' && native) {
      const id='10000000-0000-4000-8000-000000000001', now=new Date().toISOString();
      const document={version:1,ownerScope:createHmac('sha256',digestKey).update(`value-log-native-draft:${ownerA}`).digest('hex'),mode:'personal',date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),timezone:'Asia/Kolkata',transcript:'Synthetic walk.\nSynthetic rest.\n\n\n',activities:[],revision:5,reviewedRevision:null,conversation:[]};
      const content={document,recordingId:'30000000-0000-4000-8000-000000000003',totalParts:5,parts:Object.fromEntries(Array.from({length:5},(_,i)=>[String(i),{hash:String(i).repeat(64),text:i===0?'Synthetic walk.':i===1?'Synthetic rest.':'',durationMs:25000}])),captureManifest:{version:1,elapsedMs:600000,decodedMs:125000,stopReason:'interrupted',mimeType:'audio/webm'}};
      const plaintext=JSON.stringify(content),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(encryptionKey,'base64'),iv);
      drafts.set(ownerA+':'+id,{id,owner_id:ownerA,revision:5,status:'draft',content_ciphertext:Buffer.concat([cipher.update(plaintext),cipher.final()]).toString('base64'),content_iv:iv.toString('base64'),content_auth_tag:cipher.getAuthTag().toString('base64'),content_digest:createHmac('sha256',digestKey).update(plaintext).digest('hex'),receipt:null,created_at:now,updated_at:now,removed_at:null});
      res.writeHead(302,{location:app+'/day?draft='+id});res.end();return;
    }
    expiredSession=false;
    const id = url.pathname === '/test/member-b' ? ownerB : ownerA, cookies=[];
    const sb = createServerClient(api,'synthetic-anon',{cookies:{getAll:()=>[],setAll:items=>cookies.push(...items)}});
    const result = await sb.auth.setSession({access_token:token(id),refresh_token:'synthetic-refresh'});
    if(result.error) return json({error:'fixture session failed'},500);
    res.writeHead(302,{'set-cookie':cookies.map(c=>`${c.name}=${c.value}; Path=/; SameSite=Lax`),location:app+'/day'});res.end();return;
  }
  if(url.pathname==='/auth/v1/user') return owner && !expiredSession ? json(user(owner)) : json({msg:'invalid synthetic session'},401);
  if(url.pathname==='/auth/v1/logout') return json({});
  if(url.pathname.startsWith('/rest/v1/rpc/')) {
    if(req.headers.authorization !== 'Bearer synthetic-service') return json({message:'service required'},403);
    let raw='';for await(const chunk of req) raw+=chunk;
    const p=JSON.parse(raw), name=url.pathname.split('/').at(-1);
    const m=members.get(p.p_owner_id || p.p_owner);
    if(name==='consume_ingestion_rate_limit') return json(true);
    if(!m) return json({message:'unknown fixture member'},403);
    if(name.includes('native_log')) {
      const key=p.p_owner+':'+p.p_id, previous=drafts.get(key);
      if(name==='save_native_log_draft') {
        if(failSave){failSave=false;return json({message:'synthetic save failure'},503);}
        if(previous && previous.revision!==p.p_revision) {
          if(previous.revision===p.p_revision+1 && previous.content_digest===p.p_content.digest) return json(previous.revision);
          return json({message:'REVISION_CONFLICT'},409);
        }
        const c=p.p_content, now=new Date().toISOString();
        drafts.set(key,{...previous,id:p.p_id,owner_id:p.p_owner,revision:p.p_revision+1,status:'draft',content_ciphertext:c.ciphertext,content_iv:c.iv,content_auth_tag:c.authTag,content_digest:c.digest,content_key_version:c.keyVersion,lease_token:null,lease_until:null,receipt:null,created_at:previous?.created_at||now,updated_at:now,removed_at:null});
        return json(p.p_revision+1);
      }
      if(!previous) return json({message:'NATIVE_DRAFT_CLOSED'},404);
      if(name==='reserve_native_log_processing') {previous.lease_token=randomUUID();previous.lease_until=new Date(Date.now()+75000).toISOString();return json(previous.lease_token);}
      if(name==='release_native_log_processing') return json(null);
      if(name==='confirm_native_log') {
        if(previous.receipt) return json(previous.receipt);
        if(previous.revision!==p.p_revision) return json({message:'REVISION_CONFLICT'},409);
        for(const item of p.p_entries) { const c=item.content,now=new Date().toISOString();entries.set(p.p_owner+':'+item.id,{id:item.id,owner_id:p.p_owner,revision:1,activity_date:item.date,wellbeing_node:item.node,content_ciphertext:c.ciphertext,content_iv:c.iv,content_auth_tag:c.authTag,content_digest:c.digest,created_at:now,updated_at:now,removed_at:null}); }
        previous.status='submitted';previous.revision++;previous.receipt={...p.p_receipt,intakeId:null};return json(previous.receipt);
      }
      if(name==='remove_native_log_draft') { previous.status='removed';previous.content_ciphertext=null;previous.content_iv=null;previous.content_auth_tag=null;previous.removed_at=new Date().toISOString();previous.revision++;return json(true); }
    }
    if(name==='setup_value_log_member'){m.display_name=p.p_name;m.timezone=p.p_timezone;m.onboarded=true;return json(true);}
    if(name==='save_value_log_member_entry'){
      if(failSave){failSave=false;return json({message:'synthetic network failure'},503);}
      const key=p.p_owner_id+':'+p.p_id, previous=entries.get(key);
      if(previous && previous.revision!==p.p_revision){
        if(previous.revision===p.p_revision+1&&previous.content_digest===p.p_content.digest)return json(previous.revision);
        return json({message:'revision_conflict'},409);
      }
      const content=p.p_content, now=new Date().toISOString();
      entries.set(key,{id:p.p_id,owner_id:p.p_owner_id,revision:p.p_revision+1,activity_date:p.p_remove?null:p.p_date,wellbeing_node:p.p_remove?null:p.p_node,
        content_ciphertext:p.p_remove?null:content.ciphertext,content_iv:p.p_remove?null:content.iv,content_auth_tag:p.p_remove?null:content.authTag,
        content_key_version:p.p_remove?null:content.keyVersion,content_digest:content.digest,created_at:previous?.created_at||now,updated_at:now,removed_at:p.p_remove?now:null});
      audit.push({id:String(audit.length),owner_id:p.p_owner_id,event_type:p.p_remove?'private_activity_removed':'private_activity_saved',metadata:{revision:p.p_revision+1},created_at:now});
      return json(p.p_revision+1);
    }
    return json({message:'unsupported fixture RPC'},400);
  }
  if(url.pathname.startsWith('/rest/v1/')){
    if(req.headers.authorization === 'Bearer synthetic-service' && url.pathname.split('/').at(-1).startsWith('cohort_')) return json(req.headers.accept?.includes('vnd.pgrst.object') ? null : []);
    if(!owner) return json({message:'sign in required'},401);
    const table=url.pathname.split('/').at(-1), m=members.get(owner);
    let rows=[];
    if(table==='members') rows=[{id:owner,...m}];
    if(table==='member_log_access') rows=[{owner_id:owner,onboarded_at:m.onboarded?'2026-10-25T00:00:00Z':null}];
    if(table==='member_identity_bindings')rows=[{owner_id:owner,did:`did:iov:member:${owner===ownerA?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}`}];
    if(table==='member_activity_entries')rows=[...entries.values()].filter(e=>e.owner_id===owner);
    if(table==='native_log_drafts')rows=[...drafts.values()].filter(e=>e.owner_id===owner);
    if(table==='audit_events')rows=audit.filter(e=>e.owner_id===owner);
    for(const [key,value]of url.searchParams){if(value.startsWith('eq.')) rows=rows.filter(r=>String(r[key])===value.slice(3));if(value.startsWith('neq.'))rows=rows.filter(r=>String(r[key])!==value.slice(4));if(value.startsWith('gt.'))rows=rows.filter(r=>String(r[key])>value.slice(3));if(value.startsWith('lte.'))rows=rows.filter(r=>String(r[key])<=value.slice(4));if(value==='is.null')rows=rows.filter(r=>r[key]==null);}
    if(url.searchParams.get('order')?.startsWith('id'))rows.sort((a,b)=>a.id.localeCompare(b.id));
    const count=rows.length, offset=Number(url.searchParams.get('offset')||0), limit=Number(url.searchParams.get('limit')||1000);
    rows=rows.slice(offset,offset+limit);
    return json(req.headers.accept?.includes('vnd.pgrst.object')?rows[0]||null:rows,200,{'content-range':`${offset}-${Math.max(offset,offset+rows.length-1)}/${count}`});
  }
  json({fixture:'local synthetic member A/B; no production connection'});
});
await new Promise(resolve=>server.listen(4199,'127.0.0.1',resolve));
writeFileSync('/private/tmp/iov-member-fixture.pid', String(process.pid));
const child = spawn(process.execPath,[...(native?['--import','./scripts/native-provider-fixture.mjs']:[]),'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','4198'],{env:{...process.env,
  NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',
  NARRATIVE_ENCRYPTION_KEY_BASE64:encryptionKey,AUDIT_DIGEST_KEY:digestKey,NARRATIVE_KEY_VERSION:'1',
  MOSES_EMAIL_ALLOWLIST:'original-pilot@example.test',VALUE_LOG_MEMBER_ADMISSION:'closed',VALUE_LOG_MEMBER_WRITING:'open',NEXT_PUBLIC_APP_URL:app,...(native?{VALUE_LOG_NATIVE_LOGGING:'open',SARVAM_API_KEY:'synthetic-native-provider'}:{})},stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill('SIGTERM');server.close(()=>process.exit(0));});
console.log('Synthetic member entry: http://127.0.0.1:4199/test/member-a');
