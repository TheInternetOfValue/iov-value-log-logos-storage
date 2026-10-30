// Smoke test for a running Logos Storage node, without Supabase. Encrypts a synthetic
// narrative with a throwaway key, pushes it through the mirror's own upload code, reads it
// back, decrypts it, deletes it and confirms it is gone.
//   npm run logos:node     # in another terminal
//   npm run logos:check
import { randomBytes } from "node:crypto";
import { decryptNarrative, encryptNarrative } from "../src/lib/crypto";
import { deleteFromNode, logosStorageConfig, mirrorEnvelope, uploadToNode } from "../src/lib/native-log/mirror";

process.env.LOGOS_STORAGE_URL ||= "http://127.0.0.1:8080/api/storage/v1";
// Throwaway keys: this check never touches real narratives.
process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString("base64");
process.env.AUDIT_DIGEST_KEY = randomBytes(32).toString("hex");

const config = logosStorageConfig()!;
const plaintext = JSON.stringify({ synthetic: true, note: "Logos Storage mirror check", at: new Date().toISOString() });
const sealed = encryptNarrative(plaintext);
const envelope = mirrorEnvelope({ content_ciphertext: sealed.ciphertext, content_iv: sealed.iv, content_auth_tag: sealed.authTag, content_key_version: sealed.keyVersion });

try {
  const cid = await uploadToNode(config, envelope);
  console.log(`uploaded   ${cid}`);
  const read = await fetch(`${config.base}/data/${cid}`, { headers: config.headers });
  const stored = JSON.parse(await read.text());
  if (decryptNarrative(stored) !== plaintext) throw new Error("read-back did not decrypt to the original");
  console.log("read back  ciphertext only on the node; decrypts with the local key");
  await deleteFromNode(config, cid);
  const after = await fetch(`${config.base}/data/${cid}`, { headers: config.headers });
  if (after.status !== 404) throw new Error(`expected 404 after delete, got ${after.status}`);
  console.log("deleted    node returns 404");
  console.log(`PASS: ${config.base}`);
} catch (error) {
  const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
  console.error(`FAIL: ${reason}. Is the node running (npm run logos:node) at ${config.base}?`);
  process.exit(1);
}
