// Local runner for the mirror job that Netlify schedules every 15 minutes in production.
// Needs Supabase service settings plus LOGOS_STORAGE_URL (defaults to the local node).
//   npm run logos:mirror              # one pass
//   npm run logos:mirror -- --watch   # a pass every 30 s until Ctrl-C
import { mirrorNativeLogs } from "../src/lib/native-log/mirror";

process.env.LOGOS_STORAGE_URL ||= "http://127.0.0.1:8080/api/storage/v1";
const watch = process.argv.includes("--watch");

async function pass() {
  try {
    const result = await mirrorNativeLogs({ limit: 50 });
    console.log(new Date().toISOString(), result);
  } catch (error) {
    console.error(new Date().toISOString(), error instanceof Error ? error.message : error);
    if (!watch) process.exitCode = 1;
  }
}

await pass();
if (watch) setInterval(pass, 30_000);
