// Trusted Netlify worker core. Never import from browser code.
// Mirrors submitted native-log ciphertext to a Logos Storage node. Postgres stays the source
// of truth; the node only ever receives the existing AES-GCM envelope, never plaintext or ids.
import { adminClient } from "@/lib/supabase/admin-core";

type PendingRow = { owner_id: string; id: string; revision: number; content_ciphertext: string; content_iv: string; content_auth_tag: string; content_key_version: number; content_digest: string };
type StaleRow = { owner_id: string; draft_id: string; revision: number; cid: string };
export type MirrorResult = { mirrored: number; deleted: number; failed: number };

const cidPattern = /^[A-Za-z0-9]{10,200}$/;

export function logosStorageConfig() {
  const base = (process.env.LOGOS_STORAGE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const token = process.env.LOGOS_STORAGE_TOKEN?.trim();
  return { base, headers: token ? { authorization: `Bearer ${token}` } : {} as Record<string, string> };
}

export function mirrorEnvelope(row: Pick<PendingRow, "content_ciphertext" | "content_iv" | "content_auth_tag" | "content_key_version">) {
  return JSON.stringify({ v: 1, alg: "aes-256-gcm", keyVersion: row.content_key_version, iv: row.content_iv, authTag: row.content_auth_tag, ciphertext: row.content_ciphertext });
}

export async function uploadToNode(config: NonNullable<ReturnType<typeof logosStorageConfig>>, body: string) {
  // advertise=false keeps the CID off the DHT, so only this node serves the copy.
  const response = await fetch(`${config.base}/data?advertise=false`, {
    method: "POST", body, signal: AbortSignal.timeout(8000),
    headers: { ...config.headers, "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="native-log.json"' },
  });
  if (!response.ok) throw new Error(`LOGOS_UPLOAD_${response.status}`);
  const cid = (await response.text()).trim();
  if (!cidPattern.test(cid)) throw new Error("LOGOS_UPLOAD_CID");
  return cid;
}

export async function deleteFromNode(config: NonNullable<ReturnType<typeof logosStorageConfig>>, cid: string) {
  const response = await fetch(`${config.base}/data/${encodeURIComponent(cid)}`, { method: "DELETE", headers: config.headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok && response.status !== 404) throw new Error(`LOGOS_DELETE_${response.status}`);
}

export async function mirrorNativeLogs({ limit = 10, budgetMs = 20000 } = {}): Promise<MirrorResult | null> {
  const config = logosStorageConfig();
  if (!config) return null;
  const db = adminClient(), deadline = Date.now() + budgetMs, result: MirrorResult = { mirrored: 0, deleted: 0, failed: 0 };

  const stale = await db.rpc("stale_native_log_mirrors", { p_limit: limit });
  if (stale.error) throw new Error("UNAVAILABLE");
  for (const row of (stale.data ?? []) as StaleRow[]) {
    if (Date.now() > deadline) return result;
    try {
      await deleteFromNode(config, row.cid);
      const update = await db.from("native_log_mirrors").update({ node_deleted_at: new Date().toISOString() })
        .eq("owner_id", row.owner_id).eq("draft_id", row.draft_id).eq("revision", row.revision).is("node_deleted_at", null);
      if (update.error) throw new Error("UNAVAILABLE");
      result.deleted++;
    } catch { result.failed++; }
  }

  const pending = await db.rpc("pending_native_log_mirrors", { p_limit: limit });
  if (pending.error) throw new Error("UNAVAILABLE");
  for (const row of (pending.data ?? []) as PendingRow[]) {
    if (Date.now() > deadline) return result;
    try {
      const cid = await uploadToNode(config, mirrorEnvelope(row));
      const insert = await db.from("native_log_mirrors").upsert(
        { owner_id: row.owner_id, draft_id: row.id, revision: row.revision, cid, content_digest: row.content_digest },
        { onConflict: "owner_id,draft_id,revision", ignoreDuplicates: true });
      if (insert.error) throw new Error("UNAVAILABLE");
      result.mirrored++;
    } catch { result.failed++; }
  }
  return result;
}
