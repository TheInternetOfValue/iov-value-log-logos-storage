import "server-only";
// Local demo only: reads days loaded by `npm run logos:import` back from the Logos Storage node.
// Decrypts with the demo key in .logos-storage/demo-key.json, never the production narrative key.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type LogosDemoRecord = { id?: string; start_at: string; end_at?: string; timezone?: string; activity: string; wellbeing_node?: string; slice_type?: string; community?: string; impact_direction?: string; impact_intensity?: string; status?: string; skill_level?: string; sao_lane?: string; proof?: string };
export type LogosDemoDay = { date: string; cid: string; records: number };
type Envelope = { iv: string; authTag: string; ciphertext: string };

const root = resolve(process.cwd(), ".logos-storage");
const base = () => (process.env.LOGOS_STORAGE_URL ?? "http://127.0.0.1:8080/api/storage/v1").replace(/\/+$/, "");

export function logosDemoEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.LOGOS_DEMO === "1";
}

/** Demo mode proper: no Supabase settings, and not a production build (unless explicitly enabled). */
export function logosDemoActive() {
  const active = !(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && logosDemoEnabled();
  if (active) applyDemoSecrets();
  return active;
}

// The demo encrypts drafts and signs its write binding with the local demo key, never production secrets.
function applyDemoSecrets() {
  const file = resolve(root, "demo-key.json");
  if (!existsSync(file)) return;
  const keys = JSON.parse(readFileSync(file, "utf8")) as { encryption: string; digest: string };
  process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 ||= keys.encryption;
  process.env.AUDIT_DIGEST_KEY ||= keys.digest;
  process.env.VALUE_LOG_NATIVE_LOGGING ||= "open";
  process.env.NEXT_PUBLIC_APP_URL ||= `http://localhost:${process.env.PORT ?? 3000}`;
  process.env.VALUE_LOG_LOCAL_JOBS = "inline";
  process.env.SARVAM_API_KEY ||= process.env.SARVAM_API;
}

// Before any Sarvam module reads its settings: accept the local SARVAM_API name and use the production model.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL && logosDemoEnabled()) {
  process.env.SARVAM_API_KEY ||= process.env.SARVAM_API;
  process.env.SARVAM_CHAT_MODEL ||= "glm5.3";
}

export function logosDemoDays(): LogosDemoDay[] {
  const file = resolve(root, "demo-records.json");
  if (!existsSync(file)) return [];
  const index = JSON.parse(readFileSync(file, "utf8")) as Record<string, { cid: string; records: number }>;
  return Object.entries(index).map(([date, entry]) => ({ date, cid: entry.cid, records: entry.records })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function logosNodeStatus() {
  try {
    const response = await fetch(`${base()}/space`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    return await response.json() as { totalBlocks: number; quotaUsedBytes: number; quotaMaxBytes: number };
  } catch { return null; }
}

function demoKey() {
  return Buffer.from((JSON.parse(readFileSync(resolve(root, "demo-key.json"), "utf8")) as { encryption: string }).encryption, "base64");
}

function openEnvelope(envelope: Envelope) {
  const decipher = createDecipheriv("aes-256-gcm", demoKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Fetches an object by CID from the node and decrypts it with the local demo key. */
export async function logosDemoFetch(cid: string) {
  const response = await fetch(`${base()}/data/${encodeURIComponent(cid)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(response.status === 404 ? `CID ${cid} is no longer on the node. Run npm run logos:import again.` : `The node returned ${response.status}.`);
  return openEnvelope(JSON.parse(await response.text()) as Envelope);
}

/** Encrypts with the local demo key and stores the object, unadvertised, on the node. Returns its CID. */
export async function logosDemoStore(plaintext: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", demoKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const body = JSON.stringify({ v: 1, alg: "aes-256-gcm", keyVersion: 1, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  const response = await fetch(`${base()}/data?advertise=false`, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="demo.json"' } });
  if (!response.ok) throw new Error(`LOGOS_UPLOAD_${response.status}`);
  return (await response.text()).trim();
}

export async function logosDemoDelete(cid: string) {
  await fetch(`${base()}/data/${encodeURIComponent(cid)}`, { method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(5000) });
}

export async function logosDemoDay(day: LogosDemoDay): Promise<{ ok: true; envelope: Envelope; records: LogosDemoRecord[] } | { ok: false; error: string }> {
  const response = await fetch(`${base()}/data/${encodeURIComponent(day.cid)}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) return { ok: false, error: response.status === 404 ? "This day's CID is no longer on the node. Run npm run logos:import again." : `The node returned ${response.status}.` };
  const envelope = JSON.parse(await response.text()) as Envelope;
  const records = (JSON.parse(openEnvelope(envelope)) as { records: LogosDemoRecord[] }).records;
  return { ok: true, envelope, records };
}

/** Every stored record, fetched day by day from the node (local demo only). */
export async function logosDemoAllRecords() {
  const results = await Promise.all(logosDemoDays().map((day) => logosDemoDay(day)));
  return results.flatMap((result) => result.ok ? result.records : []);
}
