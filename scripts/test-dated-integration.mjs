// Self-contained local/CI orchestration. Only the localhost synthetic fixture is used.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
// A startup failure must never publish a passing report left by an earlier run.
rmSync(new URL('../docs/context/evidence/field-station-dated-release/api-postgres-journey.json', import.meta.url), { force: true });
const testEnv={...process.env,IOV_SYNTHETIC_INSTANCE_ID:randomUUID()};
const fixture=spawn(process.execPath,['--import','tsx','scripts/dated-browser-fixture.mjs'],{env:testEnv,stdio:['ignore','pipe','pipe']});
let stopped=false, output='';fixture.on('exit',()=>{stopped=true;});
for(const stream of [fixture.stdout,fixture.stderr])stream.on('data',part=>{output=(output+part).slice(-12000);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  const deadline=Date.now()+60000;let ready=false;
  while(Date.now()<deadline&&!stopped){
    try {const r=await fetch('http://127.0.0.1:4202/test/status',{signal:AbortSignal.timeout(1000)});const status=r.ok?await r.json():null;if(status?.syntheticOnly&&status.instanceId===testEnv.IOV_SYNTHETIC_INSTANCE_ID){const app=await fetch('http://127.0.0.1:4200/login',{signal:AbortSignal.timeout(10000)});if(app.ok){ready=true;break;}}}catch{ /* The disposable services are still starting. */ }
    await sleep(250);
  }
  if(!ready)throw Error('Synthetic integration services could not start.');
  const check=spawn(process.execPath,['--import','tsx','scripts/check-dated-api-journey.ts'],{env:testEnv,stdio:'inherit'});
  const code=await new Promise(resolve=>check.on('exit',resolve));if(code!==0)throw Error('Synthetic integration acceptance failed.');
} catch(error){process.stderr.write((error.message||'Synthetic integration failed.')+'\n'+output+'\n');process.exitCode=1;}
finally {
  fixture.kill('SIGTERM');const deadline=Date.now()+15000;while(!stopped&&Date.now()<deadline)await sleep(100);
  if(!stopped){process.stderr.write('Disposable services did not stop cleanly; check this test process before rerunning.\n');process.exitCode=1;}
}
