// Fresh worker process for each synthetic dispatch; no real services are reachable.
if (process.env.SARVAM_API_KEY !== 'synthetic-dated-provider') throw Error('SYNTHETIC_WORKER_ONLY');
let input='';for await(const part of process.stdin){input+=part;if(input.length>4096)throw Error('FIXTURE_JOB_LIMIT');}
const {kind,raw,signature}=JSON.parse(input);
if(kind==='native'){const {runNativeStructure}=await import('../src/lib/native-log/structure-worker.ts');await runNativeStructure(raw,signature);}
else if(kind==='cohort'){const {runCohortReview}=await import('../src/lib/cohort/review-worker.ts');await runCohortReview(raw,signature);}
else if(kind==='queue'){const {runCohortQueue}=await import('../src/lib/cohort/queue.ts');await runCohortQueue();}
else throw Error('UNKNOWN_FIXTURE_JOB');
