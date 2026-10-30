// Local-only browser fixture. Overrides its process key with fresh random bytes;
// never loads env files, database settings, production accounts or provider keys.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { build } from "esbuild";
import { recoveryKey } from "../src/lib/native-log/recovery-key";
process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString("base64");
async function main() {
const bundle = await build({ entryPoints: ["scripts/field-station-device-check.ts"], bundle: true, write: false, platform: "browser", format: "esm" });
const owner = "10000000-0000-4000-8000-000000000001";
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4201");
  const json = (value: unknown, status = 200) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
  if (url.pathname === "/qa/account") {
    let body = ""; for await (const chunk of request) body += chunk;
    response.writeHead(204, { "set-cookie": `synthetic-account=${body === "b" ? "b" : "a"}; Path=/; HttpOnly; SameSite=Strict` }); response.end(); return;
  }
  if (url.pathname === "/api/native-log/recovery-key") {
    if (request.headers["x-value-log-session"] !== "synthetic-account-a" || request.headers.cookie?.includes("synthetic-account=b")) return json({ error: "synthetic account denied" }, 403);
    try {
      let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 2000) return json({}, 413); }
      const body = JSON.parse(raw); return json({ ...recoveryKey(owner, body.id, body.turn, body.ticket), ownerScope: "a".repeat(64) });
    } catch { return json({ error: "synthetic ticket denied" }, 409); }
  }
  if (url.pathname === "/check.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(bundle.outputFiles[0].text); return; }
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Field Station synthetic device recovery</title><style>body{font:18px system-ui;max-width:720px;margin:32px auto;padding:20px;background:#f8f5ee;color:#151515}button{padding:12px;margin:6px;font:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Device recovery check</h1><p>Fictional bytes and accounts only. No microphone, database or AI provider. This does not establish real-phone readiness.</p><button id="save">Save synthetic audio</button><button onclick="location.reload()">Reload page</button><button id="recover">Recover after reload</button><button id="wrong">Check other account</button><button id="tamper">Check tampered ciphertext</button><button id="expiry">Check expiry cleanup</button><button id="cleanup">Remove synthetic audio</button><pre id="result">Ready</pre><script type="module" src="/check.js"></script>`);
});
server.listen(4201, "127.0.0.1", () => process.stdout.write("Synthetic device check at http://127.0.0.1:4201 — no production services\n"));
}
void main().catch(() => { process.stderr.write("Synthetic fixture could not start. Production is unchanged.\n"); process.exitCode = 1; });
