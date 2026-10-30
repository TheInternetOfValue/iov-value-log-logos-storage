// Local restore only: encrypted rows arrive over stdin; output is counts only.
// This never saves a transcript, submits a log or makes an external request.
import { legacyNativeDayIndex } from "../src/lib/members/native-day-index";
import type { NativeRow } from "../src/lib/native-log/storage-core";

async function main() {
  globalThis.fetch = async () => { throw new Error("External access is disabled in restore checks"); };
  let input = "";
  for await (const part of process.stdin) {
    input += String(part);
    if (input.length > 16_000_000) throw new Error("Restore page is too large");
  }
  const rows: unknown = JSON.parse(input);
  if (!Array.isArray(rows) || rows.length > 100) throw new Error("Unexpected restore page");
  const metrics = { inspected: 0, indexedOccurrences: 0, needsOperatorReview: 0 };
  for (const row of rows) {
    metrics.inspected++;
    try { metrics.indexedOccurrences += legacyNativeDayIndex(row as NativeRow).length; }
    catch { metrics.needsOperatorReview++; }
  }
  process.stdout.write(JSON.stringify(metrics));
}
void main().catch(() => {
  process.stderr.write("Local day-index inspection could not finish. No record was changed.\n");
  process.exitCode = 1;
});
