// Imported only by the synthetic browser fixture. Never allows a real provider key.
if (process.env.SARVAM_API_KEY !== 'synthetic-native-provider' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:4199') throw new Error('Native provider fixture requires isolated synthetic configuration');
const actualFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url==='http://127.0.0.1:4198/.netlify/functions/native-log-structure-background') return actualFetch('http://127.0.0.1:4199/test-native-job',init);
  if(url.startsWith('https://api.sarvam.ai/')) return actualFetch('http://127.0.0.1:4199/test-provider/'+url.slice('https://api.sarvam.ai/'.length),init);
  return actualFetch(input,init);
};
