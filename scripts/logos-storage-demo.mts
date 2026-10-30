// Narrated walkthrough of the native-log mirror against a running local node, for demos.
// Synthetic log, throwaway key, no Supabase. Press Enter to advance each step.
//   npm run logos:node    # terminal 1
//   npm run logos:demo    # terminal 2
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { decryptNarrative, encryptNarrative } from "../src/lib/crypto";
import { deleteFromNode, logosStorageConfig, mirrorEnvelope, uploadToNode } from "../src/lib/native-log/mirror";

process.env.LOGOS_STORAGE_URL ||= "http://127.0.0.1:8080/api/storage/v1";
process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString("base64");
process.env.AUDIT_DIGEST_KEY = randomBytes(32).toString("hex");

const config = logosStorageConfig()!;
const interactive = process.stdin.isTTY;
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`, dim = (s: string) => `\x1b[2m${s}\x1b[0m`, green = (s: string) => `\x1b[32m${s}\x1b[0m`;
let n = 0;
async function step(title: string) { if (rl) await rl.question(dim("\n  press Enter ↵ ")); console.log(`\n${bold(`${++n}. ${title}`)}`); }

const log = {
  date: "2026-10-29",
  activities: [
    { time: "07:00–07:45", activity: "Morning run", node: "Physiology" },
    { time: "09:30–12:30", activity: "Deep work on the Value Log", node: "Performance" },
    { time: "19:00–20:00", activity: "Dinner with family", node: "Emotion" },
  ],
};

try {
  console.log(bold("\nValue Log → Logos Storage mirror demo"));
  console.log(dim(`node: ${config.base}`));
  const space = await fetch(`${config.base}/space`).catch(() => null);
  if (!space?.ok) throw new Error("NODE_DOWN");

  await step("A member submits today's log");
  console.log(JSON.stringify(log, null, 2));

  await step("The app encrypts it before saving (AES-256-GCM, server-side key)");
  const plaintext = JSON.stringify(log);
  const sealed = encryptNarrative(plaintext);
  const envelope = mirrorEnvelope({ content_ciphertext: sealed.ciphertext, content_iv: sealed.iv, content_auth_tag: sealed.authTag, content_key_version: sealed.keyVersion });
  console.log(`ciphertext: ${sealed.ciphertext.slice(0, 72)}…`);
  console.log(dim("This is what Supabase stores. No names or account IDs are added for the mirror."));

  await step("The mirror job pushes the encrypted copy to the Logos Storage node");
  const cid = await uploadToNode(config, envelope);
  console.log(`CID: ${green(cid)}`);
  console.log(dim("The app records this CID next to the log. The node does not announce it to the network."));

  await step("What the Logos node actually holds");
  const held = await (await fetch(`${config.base}/data/${cid}`)).text();
  console.log(`${held.slice(0, 160)}…`);
  console.log(dim(`Try it yourself: curl ${config.base}/data/${cid}`));
  console.log(dim("Without the app's key it is unreadable."));

  await step("Only the app's key turns it back into the log");
  const restored = JSON.parse(decryptNarrative(JSON.parse(held)));
  console.log(JSON.stringify(restored, null, 2));
  console.log(green(JSON.stringify(restored) === plaintext ? "✓ identical to what the member submitted" : "✗ mismatch"));

  await step("The member removes the log, and the mirror deletes the node copy");
  await deleteFromNode(config, cid);
  const after = await fetch(`${config.base}/data/${cid}`);
  console.log(`GET ${cid.slice(0, 12)}… → ${after.status === 404 ? green("404 gone") : after.status}`);

  console.log(bold("\nDone.") + " Supabase stays the source of truth; Logos Storage holds an encrypted, content-addressed copy.\n");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message === "NODE_DOWN" ? `\nNo node at ${config.base}. Start it first: npm run logos:node\n` : `\nFAIL: ${message}\n`);
  process.exitCode = 1;
} finally {
  rl?.close();
}
