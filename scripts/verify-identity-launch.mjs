#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const canonicalSlug = "moses-sam-paul-johnraj";
const evidenceArgument = process.argv.indexOf("--evidence");
const evidencePath = evidenceArgument >= 0 ? process.argv[evidenceArgument + 1] : null;
const modeArgument = process.argv.indexOf("--mode");
const mode = modeArgument >= 0 ? process.argv[modeArgument + 1] : "live";

if (!evidencePath) {
  console.error("Usage: npm run verify:identity-launch -- --evidence docs/evolution/identity-launch-verification/<utc-timestamp>.json");
  process.exit(2);
}
if (!new Set(["live", "pre-synced"]).has(mode)) {
  console.error("--mode must be live or pre-synced");
  process.exit(2);
}

const wordWalletBase = String(process.env.WORD_WALLET_PUBLIC_API_BASE || "https://wordwallet.theinternetofvalue.org").replace(/\/+$/, "");
const foundationBase = String(process.env.FOUNDATION_PUBLIC_BASE || "https://theinternetofvalue.org").replace(/\/+$/, "");

async function readPublicProjection(name, url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const body = response.ok && response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    return {
      handoff: name,
      route: new URL(url).pathname,
      status: response.status,
      ok: response.ok,
      canonical_slug: canonicalSlug,
      source_updated_at: typeof body?.source_updated_at === "string" ? body.source_updated_at : null,
      version: typeof body?.calculator_version === "string" ? body.calculator_version : typeof body?.projection_version === "string" ? body.projection_version : null,
    };
  } catch {
    return { handoff: name, route: new URL(url).pathname, status: null, ok: false, canonical_slug: canonicalSlug, source_updated_at: null, version: null };
  }
}

const checkedAt = new Date().toISOString();
const results = await Promise.all([
  readPublicProjection("signed_word_wallet_pilot_w", `${wordWalletBase}/v1/public/wellbeing-identities/${canonicalSlug}/pilot-w`),
  readPublicProjection("signed_word_wallet_community_value", `${wordWalletBase}/v1/public/wellbeing-identities/${canonicalSlug}/community-value`),
  readPublicProjection("foundation_public_identity", `${foundationBase}/wellbeing-identity/people/${canonicalSlug}`),
]);

const evidence = { checked_at: checkedAt, mode, canonical_slug: canonicalSlug, results };
await fs.mkdir(path.dirname(evidencePath), { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence));
process.exit(results.every((result) => result.ok) ? 0 : 1);
