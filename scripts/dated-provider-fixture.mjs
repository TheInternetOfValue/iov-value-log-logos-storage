// Local test process only. No real credentials or external connections are allowed.
if (process.env.SARVAM_API_KEY !== 'synthetic-dated-provider' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:4202') throw Error('ISOLATED_DATED_FIXTURE_REQUIRED');
const actualFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.href.startsWith('https://api.sarvam.ai/')) return actualFetch('http://127.0.0.1:4202/test-provider' + url.pathname, init);
  if (url.href === 'http://127.0.0.1:4200/.netlify/functions/native-log-structure-background') return actualFetch('http://127.0.0.1:4202/test-native-job', init);
  if (url.href === 'http://127.0.0.1:4200/.netlify/functions/cohort-review-background') return actualFetch('http://127.0.0.1:4202/test-cohort-job', init);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !['4200','4202','4203'].includes(url.port)) throw Error('EXTERNAL_REQUEST_BLOCKED_IN_DATED_FIXTURE');
  return actualFetch(input, init);
};
