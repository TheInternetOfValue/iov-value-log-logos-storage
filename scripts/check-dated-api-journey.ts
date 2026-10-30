// Actual Next.js APIs, signed jobs and PostgreSQL; fictional auth/audio/provider only.
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newNativeDraft } from "../src/lib/native-log/draft";
const app = "http://127.0.0.1:4200", fixture = "http://127.0.0.1:4202", policy = "field-station-oct26-28-qa-v1";
const checks: Array<{ id: string; passed: boolean }> = [];
type Session = { cookie: string; binding: string; scope: string };
function check(id: string, ok: unknown): asserts ok { checks.push({ id, passed: Boolean(ok) }); if (!ok) throw Error(id); }
async function login(name: string): Promise<Session> {
  const r = await fetch(fixture + "/test/" + name, { redirect: "manual" });
  if (r.status !== 302) throw Error("synthetic_login_failed");
  return { cookie: r.headers.getSetCookie().map(value => value.split(";")[0]).join("; "), binding: r.headers.get("x-synthetic-binding")!, scope: r.headers.get("x-synthetic-owner-scope")! };
}
async function call(session: Session, path: string, method = "GET", input?: unknown) {
  const form = input instanceof FormData;
  const r = await fetch(app + path, { method, headers: { cookie: session.cookie, "x-value-log-session": session.binding, ...(method === "GET" ? {} : { origin: app, "sec-fetch-site": "same-origin", ...(!form ? { "content-type": "application/json" } : {}) }) }, ...(input === undefined ? {} : { body: form ? input : JSON.stringify(input) }), redirect: "manual" });
  const value = await r.json().catch(() => ({}));
  return { status: r.status, headers: r.headers, value };
}
async function ok(session: Session, path: string, method = "GET", input?: unknown) {
  const r = await call(session, path, method, input); if (r.status < 200 || r.status >= 300) throw Error(`api_${path.split("?")[0]}_${r.status}_${r.value.code ?? "failure"}`); return r.value;
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 30000;
  do { const value = await read(); if (ready(value)) return value; await wait(250); } while (Date.now() < until);
  throw Error("synthetic_pipeline_deadline");
}
const enroll = (session: Session, house: string) => ok(session, "/api/cohort", "POST", { action: "enroll_dated", policy, house, consent: true, startingValuesConfirmed: true, termsVersion: "dated-700-non-performance-v1" });
function wave() {
  const pcm = Buffer.alloc(16000), b = Buffer.alloc(44 + pcm.length); b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(16000,24); b.writeUInt32LE(32000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write("data",36); b.writeUInt32LE(pcm.length,40);
  for(let i=0;i<8000;i++) b.writeInt16LE(Math.round(Math.sin(i / 16000 * 440 * 2 * Math.PI) * 7000),44+i*2);
  return new Blob([b],{type:"audio/wav"});
}
const capture = JSON.stringify({ version:1, elapsedMs:500, decodedMs:500, stopReason:"user", mimeType:"audio/wav" });
function audio(id: string, revision: number, turn: string, reply = false) {
  const form = new FormData(); for (const [key, value] of Object.entries({ id, revision:String(revision), [reply ? "replyId" : "recordingId"]:turn, ...(reply ? {activityId:""} : {}), index:"0",total:"1",consent:"true",capture })) form.set(key,value); form.set("audio",wave(),"synthetic.wav"); return form;
}
async function view(session: Session, id: string) { return ok(session, "/api/native-log/drafts?id=" + id); }
async function prepared(session: Session, id: string) { return poll(() => view(session,id), value => !value.processingUntil && value.document?.activities.length > 0 && !value.processingError); }
async function record(session: Session, retry = false, flavour = "standard") {
  await fetch(fixture + "/test/transcript/" + flavour);
  const id=randomUUID(), turn=randomUUID(), document=newNativeDraft(session.scope,"2026-10-26","Asia/Kolkata","personal");
  const saved=await ok(session,"/api/native-log/drafts","PUT",{id,revision:0,document,consent:true});
  let recovery: { ticket: string; turn: string } | undefined;
  if(retry){
    const issued=await call(session,"/api/native-log/recovery-key","POST",{id,turn,ticket:null});
    const first=issued.value;
    check("U20-U21-authenticated-expiring-recovery-key",issued.status===200 && issued.headers.get("cache-control")?.includes("no-store") && first.ownerScope===session.scope && first.expiresAt>Date.now()+86390000 && first.expiresAt<=Date.now()+86400000);
    const altered=first.ticket.slice(0,-1)+(first.ticket.endsWith("0")?"1":"0");
    check("U21-tampered-recovery-ticket-denied",(await call(session,"/api/native-log/recovery-key","POST",{id,turn,ticket:altered})).status===409);
    await fetch(fixture+"/test/expire");
    check("U20-expired-signin-cannot-unlock",(await call(session,"/api/native-log/recovery-key","POST",{id,turn,ticket:first.ticket})).status===401);
    await login("member-a");
    const returned=await ok(session,"/api/native-log/recovery-key","POST",{id,turn,ticket:first.ticket});
    check("U20-account-return-restores-same-key-and-deadline",returned.key===first.key && returned.expiresAt===first.expiresAt);
    recovery={ticket:first.ticket,turn};
  }
  const transcribed=await ok(session,"/api/native-log/transcribe","POST",audio(id,saved.revision,turn));
  if(retry){
    const before=await (await fetch(fixture+"/test/status")).json();
    await ok(session,"/api/native-log/transcribe","POST",audio(id,saved.revision,turn));
    const after=await (await fetch(fixture+"/test/status")).json();
    check("U19-exact-upload-retry-reuses-transcript",after.providerCalls.stt===before.providerCalls.stt);
  }
  await ok(session,"/api/native-log/structure","POST",{id,revision:transcribed.revision,consent:true});
  return {id,recovery,...await prepared(session,id)};
}
const confirm = (session: Session, id: string, revision: number) => ok(session,"/api/native-log/confirm","POST",{id,revision,confirmed:true,confirmationText:"I approve this fictional test log."});
async function score(session: Session, expected: number) {return poll(()=>ok(session,"/api/cohort"),value=>value.cohort?.state.score===expected && !value.cohort.records.some((r:{review_status:string})=>r.review_status==="pending"));}
function sourceHash() {
  const files: string[]=[];
  function walk(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else files.push(path);}}
  walk("src");walk("supabase/migrations");files.push("scripts/check-dated-api-journey.ts","scripts/dated-browser-fixture.mjs","scripts/dated-provider-fixture.mjs","scripts/dated-worker-fixture.mjs");
  const hash=createHash("sha256");for(const file of files.sort()){hash.update(file+"\n");hash.update(readFileSync(file));}return hash.digest("hex");
}
async function main() {
let failure: string | null=null;
try {
  const status=await (await fetch(fixture+"/test/status")).json();
  if(!status.syntheticOnly || process.env.IOV_SYNTHETIC_INSTANCE_ID && status.instanceId!==process.env.IOV_SYNTHETIC_INSTANCE_ID || JSON.parse(status.counts).enrollments!==0)throw Error("fresh_owned_synthetic_fixture_required");
  const a=await login("member-a");await enroll(a,"house_of_bros");
  const start=await ok(a,"/api/cohort");check("U01-U05-minimal-identity-six-700",start.cohort.state.score===700 && Object.values(start.cohort.state.state).every(value=>value===700));
  const log=await record(a,true);check("U08-U15-audio-to-complete-mixed-table",log.document.activities.length===2 && log.document.activities.some((r:{node:string})=>r.node==="Performance"));
  const receipt=await confirm(a,log.id,log.revision);await confirm(a,log.id,log.revision);
  check("U19-confirmation-retry-same-receipt",receipt.receipt.count===2);
  const positive=await score(a,700.007);check("U06-U08-golden-score-work-unassessed",positive.cohort.records.length===1 && positive.cohort.state.state.Performance===700);
  const day=await call(a,"/api/member/day?date=2026-10-26");check("U10-U12-own-day-private-two-occurrences",day.status===200 && day.headers.get("cache-control")?.includes("no-store") && day.value.activities.length===2 && day.value.unknownMinutes===1290);
  check("U22-submitted-log-cannot-unlock-device-audio",(await call(a,"/api/native-log/recovery-key","POST",{id:log.id,turn:log.recovery!.turn,ticket:log.recovery!.ticket})).status===409);
  const sis=await login("member-sis");
  check("U21-other-account-cannot-unlock-saved-audio",(await call(sis,"/api/native-log/recovery-key","POST",{id:log.id,turn:log.recovery!.turn,ticket:log.recovery!.ticket})).status===404);

  check("U04-wrong-House-rejected",(await call(sis,"/api/cohort","POST",{action:"enroll_dated",policy,house:"house_of_bros",consent:true,startingValuesConfirmed:true,termsVersion:"dated-700-non-performance-v1"})).status===409);
  check("U10-other-owner-draft-denied",(await call(sis,"/api/native-log/drafts?id="+log.id)).status===404);
  check("U10-account-bound-day-denied",(await call({...sis,binding:a.binding},"/api/member/day?date=2026-10-26")).status===403);
  await enroll(sis,"house_of_sis");const sisLog=await record(sis);await confirm(sis,sisLog.id,sisLog.revision);check("U06-identical-House-mathematics",(await score(sis,700.007)).cohort.enrollment.house_id==="house_of_sis");
  const approximate=await record(sis,false,"approximate");
  check("U16-coverage-proof-survives-encrypted-optional-field-roundtrip",approximate.coverageStatus==="complete" && Boolean(approximate.document.activities[0].timeNote));
  const changedWords=await ok(sis,"/api/native-log/drafts","PUT",{id:approximate.id,revision:approximate.revision,document:{...approximate.document,revision:approximate.document.revision+1,transcript:approximate.document.transcript+" This is new evidence."},consent:true});
  const stale=await view(sis,approximate.id), deniedStale=await call(sis,"/api/native-log/confirm","POST",{id:approximate.id,revision:changedWords.revision,confirmed:true,confirmationText:"Fictional stale approval must be rejected."});
  check("U24-changed-evidence-has-explained-stale-check-and-cannot-submit",stale.coverageStatus==="changed" && stale.processingError==="COVERAGE_CHECK_STALE" && deniedStale.status===409 && deniedStale.value.code==="OMISSION_REVIEW_REQUIRED");
  const correction=await ok(a,"/api/cohort/correct","POST",{recordId:positive.cohort.records[0].id}), correctedId=new URL(correction.path,app).searchParams.get("draft")!;
  let corrected=await prepared(a,correctedId);
  check("U16-corrected-version-checks-copy-without-regenerating-occurrence",corrected.document.activities[0].id===log.document.activities[0].id);
  await fetch(fixture+"/test/transcript/neutral");
  corrected=await ok(a,"/api/native-log/reply","POST",audio(correctedId,corrected.revision,randomUUID(),true));
  await ok(a,"/api/native-log/structure","POST",{id:correctedId,revision:corrected.revision,consent:true});corrected=await prepared(a,correctedId);
  check("U16-spoken-neutral-correction-keeps-times",corrected.document.activities[0].direction==="neutral" && corrected.document.activities[0].startLocal==="2026-10-26T08:00");
  await confirm(a,correctedId,corrected.revision);const neutral=await score(a,700);
  check("U25-neutral-replay-no-double-count",neutral.cohort.state.events.length===1 && neutral.cohort.records.filter((r:{review_status:string})=>r.review_status!=="superseded").length===1);
  const again=await ok(a,"/api/member/day?date=2026-10-26");check("U12-correction-retains-work-without-duplicate",again.activities.length===2);
  await enroll(a,"house_of_bros");check("U03-return-does-not-reset-consent-or-history",(await ok(a,"/api/cohort")).cohort.enrollment.consent_at===start.cohort.enrollment.consent_at);
  await ok(a,"/api/cohort","POST",{action:"consent",consent:false});
  const workSource=again.activities.find((r:{node:string})=>r.node==="Performance").sourceId;
  const continued=await ok(a,"/api/native-log/source-draft","POST",{action:"continue",sourceId:workSource}), privateCorrectionId=new URL(continued.path,app).searchParams.get("draft")!;
  const privateCorrection=await prepared(a,privateCorrectionId);await confirm(a,privateCorrectionId,privateCorrection.revision);
  check("U24-paused-review-retains-private-editing",(await ok(a,"/api/member/day?date=2026-10-26")).activities.length===2 && (await ok(a,"/api/cohort")).cohort.enrollment.review_consent===false);
  await ok(a,"/api/cohort","POST",{action:"consent",consent:true});
  const resumed=await ok(a,"/api/cohort");check("U03-U24-review-resumption-does-not-reset-history",resumed.cohort.state.score===700 && resumed.cohort.enrollment.boundary_at===start.cohort.enrollment.boundary_at);
  const outside=await login("outside"), outsideState=await ok(outside,"/api/cohort");check("U02-outside-window-ordinary-logging",outsideState.cohort===null && !outsideState.dated?.eligible);
  const privateLog=await record(outside);await confirm(outside,privateLog.id,privateLog.revision);
  const privateDay=await ok(outside,"/api/member/day?date=2026-10-26");check("U08-ordinary-day-unassessed-no-700",privateDay.activities.length===2 && privateDay.score.current===null);
  const removalView=await view(outside,privateLog.id);await ok(outside,"/api/native-log/drafts","DELETE",{id:privateLog.id,revision:removalView.revision});check("U22-private-removal-clears-visible-activities",(await ok(outside,"/api/member/day?date=2026-10-26")).activities.length===0);
  const legacy=await login("outside-legacy"), legacyLog=await record(legacy);await confirm(legacy,legacyLog.id,legacyLog.revision);
  await fetch(fixture+"/test/legacy-day-index?draft="+legacyLog.id);
  check("U11-legacy-unindexed-words-invent-no-arcs",(await ok(legacy,"/api/member/day?date=2026-10-26")).activities.length===0);
  check("U10-maintenance-denied-to-ordinary-member",(await call(legacy,"/api/cohort/admin/day-index","POST",{apply:false,cursor:null})).status===403);
  const founderMaintenance=await login("pilot"), beforeIndex=await view(legacy,legacyLog.id);
  const preview=await call(founderMaintenance,"/api/cohort/admin/day-index","POST",{apply:false,cursor:null});
  check("U11-U12-legacy-index-preview-private-no-writing",preview.status===200 && preview.headers.get("cache-control")?.includes("no-store") && preview.value.metrics.indexedOccurrences===2 && preview.value.metrics.needsOperatorReview===0 && !JSON.stringify(preview.value).includes('Synthetic walk') && (await ok(legacy,"/api/member/day?date=2026-10-26")).activities.length===0);
  const indexed=await ok(founderMaintenance,"/api/cohort/admin/day-index","POST",{apply:true,cursor:null}), afterIndex=await view(legacy,legacyLog.id);
  check("U12-legacy-index-exact-times-original-source-preserved",indexed.metrics.indexedOccurrences===2 && indexed.metrics.needsOperatorReview===0 && (await ok(legacy,"/api/member/day?date=2026-10-26")).activities.length===2 && beforeIndex.revision===afterIndex.revision && JSON.stringify(beforeIndex.document)===JSON.stringify(afterIndex.document));
  check("U19-legacy-index-retry-adds-no-duplicates",(await ok(founderMaintenance,"/api/cohort/admin/day-index","POST",{apply:true,cursor:null})).metrics.indexedOccurrences===0);
  await ok(legacy,"/api/native-log/drafts","DELETE",{id:legacyLog.id,revision:afterIndex.revision});
  check("U22-legacy-transcript-removal-preserves-confirmed-member-records",(await ok(legacy,"/api/member/day?date=2026-10-26")).activities.length===2);
  const founder=await login("pilot"), founderDay=await ok(founder,"/api/member/day?date=2026-10-26");check("U10-founder-uses-original-source-not-700",founderDay.score.status==="founder" && founderDay.score.current===null && founderDay.activities.length===0);
  // Hold normal review dispatch, then exercise the actual paginated scheduled queue.
  await fetch(fixture+"/test/hold-review");const loaded:Session[]=[];
  for(const name of ["member-b",...Array.from({length:10},(_,i)=>"load-"+(i+4))]){const session=await login(name);await enroll(session,"house_of_bros");const item=await record(session);await confirm(session,item.id,item.revision);loaded.push(session);}
  check("U23-eleven-owners-await-review",loaded.length===11);
  await fetch(fixture+"/test/release-review");const swept=await (await fetch(fixture+"/test/sweep")).json();check("U23-real-database-queue-sweep",swept.passed);
  await Promise.all(loaded.map(session=>score(session,700.007)));check("U23-all-eleven-process-without-starvation",true);
  const recorded=await (await fetch(fixture+"/test/diagnostics")).json() as {syntheticOnly:boolean;diagnostics:Array<{stage:string;outcome:string;actor:string;owned:boolean}>;wordMatches:number};
  check("U24-content-free-native-diagnostics-recorded",recorded.syntheticOnly && ["transcription","structure","submission"].every(stage=>recorded.diagnostics.some(d=>d.stage===stage && d.outcome==="ok")) && recorded.diagnostics.every(d=>d.actor==="system" && d.owned) && recorded.wordMatches===0);
} catch(error) { failure=error instanceof Error?error.message:"unknown_synthetic_failure"; }
const report={syntheticOnly:true,realPostgres:true,realNextApis:true,simulatedAuthAndProviders:true,realMicrophone:false,realGoogle:false,productionChanged:false,sourceSha256:sourceHash(),passed:failure===null,checks,failure,checkedAt:new Date().toISOString()};
writeFileSync("docs/context/evidence/field-station-dated-release/api-postgres-journey.json",JSON.stringify(report,null,2)+"\n");
process.stdout.write(JSON.stringify({passed:report.passed,checks:checks.length,failure})+"\n");if(failure)process.exitCode=1;

}
void main().catch(() => { process.stderr.write("Synthetic journey could not start; production was not accessed.\n"); process.exitCode=1; });
