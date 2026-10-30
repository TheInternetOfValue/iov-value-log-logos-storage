import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin";
import { encryptNarrative } from "@/lib/crypto";
import { canSubmitCapture } from "./draft";
import {
  nativeColumns,
  nativeOwnerScope,
  readNativeContent,
  type NativeRow,
  type NativeReceipt,
} from "./storage-core";

/** One stable continuation per immutable approved capture, including concurrent clicks. */
export function captureContinuationId(
  id: string,
  revision: number,
  generation = 0,
) {
  const hash = createHash("sha256")
    .update(`native-capture-continuation:${id}:${revision}:${generation}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function captureContinuationSlot(
  parent: Pick<NativeRow, "id" | "revision">,
  rows: Array<{ id: string; status: string }>,
) {
  for (let generation = 0; generation <= 20; generation++) {
    const id = captureContinuationId(parent.id, parent.revision, generation),
      row = rows.find((r) => r.id === id);
    if (!row || row.status !== "removed") return { id, generation, row };
  }
  return null;
}
export const captureContinuationIds = (
  parent: Pick<NativeRow, "id" | "revision">,
) =>
  Array.from({ length: 21 }, (_, i) =>
    captureContinuationId(parent.id, parent.revision, i),
  );
/** Atomic owner/revision/digest/lease CAS; never creates a canonical record or calculation.
 * The encrypted row is the immutable approval record; missing facts stay missing.
 */
export async function queueApprovedCapture(
  owner: string,
  row: NativeRow,
  confirmationText: string,
  now = new Date(),
) {
  const content = readNativeContent(row),
    document = content.document;
  if (document.ownerScope !== nativeOwnerScope(owner))
    throw new Error("ACCOUNT_CHANGED");
  if (row.status === "submitted") return row.receipt;
  if (!canSubmitCapture(document, now)) throw new Error("REVIEW_REQUIRED");
  const approval = {
    at: now.toISOString(),
    documentRevision: document.revision,
    contentDigest: row.content_digest,
    confirmationText,
  };
  const encrypted = encryptNarrative(
    JSON.stringify({
      ...content,
      document: { ...document, reviewedRevision: document.revision },
      approval,
    }),
  );
  const receipt: NativeReceipt = {
    kind: "capture_review_pending",
    ids: [],
    dates: [document.date],
    count: document.activities.length,
    timezone: document.timezone,
  };
  const q = await adminClient()
    .from("native_log_drafts")
    .update({
      status: "submitted",
      submitted_at: now.toISOString(),
      updated_at: now.toISOString(),
      revision: row.revision + 1,
      lease_token: null,
      lease_until: null,
      receipt,
      content_ciphertext: encrypted.ciphertext,
      content_iv: encrypted.iv,
      content_auth_tag: encrypted.authTag,
      content_key_version: encrypted.keyVersion,
      content_digest: encrypted.digest,
    })
    .eq("owner_id", owner)
    .eq("id", row.id)
    .eq("revision", row.revision)
    .eq("content_digest", row.content_digest)
    .eq("status", "draft")
    .or(`lease_until.is.null,lease_until.lte.${now.toISOString()}`)
    .select(nativeColumns)
    .maybeSingle();
  if (q.error) throw new Error("UNAVAILABLE");
  if (!q.data) {
    const latest = await adminClient()
      .from("native_log_drafts")
      .select(nativeColumns)
      .eq("owner_id", owner)
      .eq("id", row.id)
      .maybeSingle();
    if (latest.error) throw new Error("UNAVAILABLE");
    if (
      latest.data?.status === "submitted" &&
      readNativeContent(latest.data as NativeRow).approval?.contentDigest ===
        row.content_digest
    )
      return (latest.data as NativeRow).receipt;
    throw new Error("REVISION_CONFLICT");
  }
  return receipt;
}
