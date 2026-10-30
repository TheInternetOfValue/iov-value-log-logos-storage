// Dry-run by default. New metadata only; never parses note text or submits/reviews logs.
import {
  prepareDayIndex,
  type DayIndexCursor,
} from "../src/lib/members/prepare-day-index";
async function main() {
  const apply = process.argv.includes("--apply");
  const metrics = {
    syntheticOnly: process.env.IOV_SYNTHETIC_SERVICES === "true",
    apply,
    inspected: 0,
    indexedOccurrences: 0,
    needsOperatorReview: 0,
  };
  let cursor: DayIndexCursor | null = null;
  do {
    const result = await prepareDayIndex(apply, cursor);
    for (const key of [
      "inspected",
      "indexedOccurrences",
      "needsOperatorReview",
    ] as const)
      metrics[key] += result.metrics[key];
    cursor = result.next;
  } while (cursor);
  process.stdout.write(JSON.stringify(metrics) + "\n");
  if (metrics.needsOperatorReview) process.exitCode = 2;
}
void main().catch(() => {
  process.stderr.write(
    "Day-index preparation could not finish. No original log was altered.\n",
  );
  process.exitCode = 1;
});
