// Local-only synthetic diagnostic session. No credential file, production data or arbitrary prompt endpoint.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const maxRuns=process.env.IOV_CONVERSATION_QUALITY==='true'?4:process.env.SARVAM_CHAT_MODEL==='glm5.3'?2:6;
const profileLabel=process.env.SARVAM_CHAT_MODEL==='glm5.3'?'GLM-5.3, hosted by Sarvam':'Sarvam 105B Conversations';
const port=4198,origin=`http://127.0.0.1:${port}`,csrf=randomBytes(24).toString('hex');
let busy=false,report=null,status='Ready. Synthetic examples only.',sessionKey='',expiresAt=0,runs=0,child=null;
function clear(){sessionKey='';expiresAt=0;child?.kill('SIGTERM');status='Diagnostic session ended. Key cleared; production unchanged.';}
setInterval(()=>{if(sessionKey&&Date.now()>=expiresAt)clear();},1000).unref();
async function run(){
 if(busy)throw Error('BUSY');
 if(!sessionKey||Date.now()>=expiresAt)throw Error('NO_SESSION');
 if(runs>=maxRuns)throw Error('SESSION_LIMIT');
 busy=true;runs++;status=`Running fixed synthetic suite ${runs} of at most ${maxRuns}. Production unchanged.`;
 try{
  const result=await new Promise((resolve,reject)=>{
   child=spawn(process.execPath,['--import','tsx','scripts/cohort-quality-runner.mjs'],{stdio:['pipe','pipe','pipe'],env:{...process.env,SARVAM_API_KEY:''}});
   let text='';child.stdout.on('data',part=>{text+=part;if(text.length>100000)child.kill('SIGTERM');});
   child.stderr.resume(); // Provider errors may contain text: never print or retain stderr.
   child.on('error',()=>reject(Error('RUN_FAILED')));child.on('close',code=>{child=null;if(code!==0)return reject(Error('RUN_FAILED'));try{resolve(JSON.parse(text));}catch{reject(Error('RUN_FAILED'));}});
   child.stdin.end(JSON.stringify({key:sessionKey}));
  });
  report=result;writeFileSync('/private/tmp/iov-cohort-sarvam-quality.json',JSON.stringify(report,null,2),{mode:0o600});
  status=report.passed?'All synthetic checks passed. Diagnostic session remains available until it expires or you clear it. Production unchanged.':'Some synthetic checks need improvement. Diagnostic session remains available until it expires or you clear it. Production unchanged.';
  return report;
 }catch{status='The synthetic suite stopped. Production unchanged.';return null;}
 finally{busy=false;}
}
const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Check Value Log conversation with Sarvam</title><style>body{font:17px/1.6 system-ui;max-width:650px;margin:6vh auto;padding:24px;background:#f8f5ee;color:#151515}input,button{width:100%;box-sizing:border-box;padding:14px;font:inherit;margin:8px 0 20px}button{background:#151515;color:white;border:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Check Value Log conversation with Sarvam</h1><p><strong>Test model: ${profileLabel}.</strong> Sarvam supplies this model through the existing API key and credits. Transcription is unchanged. Standard model usage charges apply; no new subscription.</p><p>Start a local diagnostic session for the fixed synthetic Value Log conversation examples (including flowing narration, eighteen timed activities, omissions, corrections and long source references). Nothing changes in Value Log; no member data, voice or salary is read.</p><p><strong>Your key stays only in this helper’s memory for up to 30 minutes.</strong> Codex can rerun the fixed synthetic suite after repairs, at most ${maxRuns} suites per session, with at most 20 model requests per suite (80 requests maximum in this four-suite session). Every run starts fresh code and records its source hash. Ordinary Sarvam usage applies. Clear the key at any time; it is never saved to a file or shown in results.</p><p>Reports contain synthetic classification/time fields, pass/fail and content-free provider diagnostics. They contain no private member data or model reasoning.</p><form><label for="key">Existing Sarvam API key</label><input id="key" type="password" autocomplete="off" required><button>Start 30-minute diagnostic session and run checks</button></form><button id="clear">End session and clear key</button><pre id="status" role="status">Ready.</pre><script>const form=document.querySelector('form'),status=document.querySelector('#status'),button=form.querySelector('button');form.onsubmit=async e=>{e.preventDefault();const input=document.querySelector('input'),key=input.value;input.value='';button.disabled=true;status.textContent='Starting synthetic diagnostics…';try{const r=await fetch('/quality',{method:'POST',headers:{'content-type':'application/json','x-quality-csrf':'${csrf}'},body:JSON.stringify({key})});status.textContent=JSON.stringify(await r.json(),null,2);}catch{status.textContent='Local diagnostics stopped. Production unchanged.';}button.disabled=false;};document.querySelector('#clear').onclick=async()=>{await fetch('/clear',{method:'POST',headers:{'x-quality-csrf':'${csrf}'}});status.textContent='Key cleared. Production unchanged.';};</script></html>`;
createServer(async(req,res)=>{
 const finish=(value,code=200)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
 if(req.headers.host!==`127.0.0.1:${port}`)return finish({status:'Invalid local address'},403);
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(page);return;}
 if(req.method==='GET'&&req.url==='/status')return finish({busy,status,sessionActive:Boolean(sessionKey)&&Date.now()<expiresAt,expiresAt:expiresAt||null,runs,report});
 if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-quality-csrf']!==csrf)return finish({status:'Use the local form'},403);
 if(req.url==='/clear'){clear();return finish({status});}
 if(req.url!=='/quality')return finish({status:'Use the local form'},404);
 if(busy)return finish({busy,status},409);
 let raw='';for await(const part of req){raw+=part;if(raw.length>4096)return finish({status:'Input too long'},400);}
 let body;try{body=JSON.parse(raw);}catch{return finish({status:'Check the key input'},400);}
 if(typeof body.key!=='string'||body.key.trim().length<10)return finish({status:'Enter the existing Sarvam key'},400);
 sessionKey=body.key.trim();body.key='';raw='';expiresAt=Date.now()+30*60000;runs=0;
 await run();finish({status,report});
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic diagnostic session ready at ${origin}`));
// Trusted local console commands avoid exposing a key or control token to automation.
createInterface({input:process.stdin}).on('line',async line=>{
 if(line.trim()==='clear'){clear();console.log(JSON.stringify({status}));}
 if(line.trim()==='run'){try{await run();console.log(JSON.stringify({status,report}));}catch{console.log(JSON.stringify({status:'No active session, busy, or session run limit reached.'}));}}
});
