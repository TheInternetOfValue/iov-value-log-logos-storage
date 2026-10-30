// Child of the local diagnostic helper. Credentials arrive only over a private pipe.
import {
  runCohortQuality,
  probeLongCoverageQuality,
} from "./cohort-quality.ts";
import { existsSync } from "node:fs";
let input = "";
for await (const part of process.stdin) {
  input += part;
  if (input.length > 4096) throw Error("Invalid local input");
}
process.env.SARVAM_API_KEY = JSON.parse(input).key;
input = "";
process.env.AUDIT_DIGEST_KEY =
  "synthetic-quality-digest-key-not-used-by-production";
let requests = 0;
const providerFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (
    url.hostname !== "api.sarvam.ai" ||
    !url.pathname.includes("chat/completions") ||
    ++requests > 20
  )
    throw Error("QUALITY_REQUEST_BOUNDARY");
  return providerFetch(input, init);
};
try {
  process.stdout.write(
    JSON.stringify({
      ...(await (existsSync("/private/tmp/iov-quality-fixed-long-probe")
        ? probeLongCoverageQuality()
        : runCohortQuality())),
      usage: { modelRequests: requests, maximum: 20 },
    }),
  );
} finally {
  delete process.env.SARVAM_API_KEY;
  delete process.env.AUDIT_DIGEST_KEY;
  globalThis.fetch = providerFetch;
}
