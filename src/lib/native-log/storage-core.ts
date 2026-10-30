// Trusted server and Netlify worker core. Never import from browser code.
import { encryptNarrative, decryptNarrative, narrativeDigest } from "@/lib/crypto";
import { adminClient } from "@/lib/supabase/admin-core";
import { nativeDocumentSchema, type NativeStoredContent } from "./schema";
import { captureSummaries } from "./capture-storage";
import { storedCaptureSchema } from "./capture-manifest";
import type { NativeDraft } from "./draft";
import { narrationCoverageStatus } from "./coverage";
export const nativeOwnerScope = (id: string) => narrativeDigest(`value-log-native-draft:${id}`);
export type NativeReceipt = { kind: "validation_pending" | "unassessed" | "cohort_review_pending" | "capture_review_pending"; ids: string[]; dates: string[]; count: number; timezone: string; intakeId?: string | null; sourceReferenced?: boolean; dayIndexVersion?: 1 };
export const nativeColumns = "id,revision,status,content_ciphertext,content_iv,content_auth_tag,content_key_version,content_digest,receipt,created_at,updated_at,removed_at,lease_until";
export type NativeRow = { id: string; revision: number; status: "draft" | "submitted" | "removed"; content_ciphertext: string | null; content_iv: string | null; content_auth_tag: string | null; content_digest: string; lease_until?: string | null; receipt: NativeReceipt | null; updated_at: string; created_at: string; removed_at: string | null };
export function readNativeContent(row: NativeRow): NativeStoredContent {
  if (row.status === "removed" || !row.content_ciphertext || !row.content_iv || !row.content_auth_tag) throw new Error("NATIVE_DRAFT_CLOSED");
  const parsed = JSON.parse(decryptNarrative({ ciphertext: row.content_ciphertext, iv: row.content_iv, authTag: row.content_auth_tag })) as NativeStoredContent;
  parsed.document = nativeDocumentSchema.parse(parsed.document);
  if (!storedCaptureSchema.safeParse(parsed).success) throw new Error("UNAVAILABLE");
  return parsed;
}
export function nativeView(row: NativeRow) {
  if (row.status === "removed") return { id: row.id, revision: row.revision, status: row.status, removedAt: row.removed_at, receipt: row.receipt };
  const content = readNativeContent(row);
  let processingError = content.processingError ?? null;
  const coverageStatus = narrationCoverageStatus(content.document, content.coverage);
  if (row.status === "draft" && content.document.activities.length) {
    if (coverageStatus !== "disabled" && coverageStatus !== "complete" &&
      (!processingError || processingError === "OMISSION_REVIEW_REQUIRED"))
      processingError = coverageStatus === "incomplete"
        ? "OMISSION_REVIEW_REQUIRED" : "COVERAGE_CHECK_STALE";
  }
  return { id: row.id, revision: row.revision, status: row.status, document: content.document, receipt: row.receipt,
    captures: captureSummaries(content),
    recording: content.recordingId ? { id: content.recordingId, manifest: content.captureManifest } : undefined,
    approval:content.approval??null,
    updatedAt: row.updated_at, processingUntil: row.lease_until && Date.parse(row.lease_until) > Date.now() ? row.lease_until : null, processingError, coverageStatus, unmatchedRows: row.status === "draft" ? content.unmatchedRows ?? 0 : 0, transcription: { done: Object.keys(content.parts).length, total: content.totalParts } };
}
export function rpcFailure(message: string) {
  return ["REVISION_CONFLICT", "PROCESSING_BUSY", "NATIVE_DRAFT_CLOSED", "RATE_LIMITED", "UNAUTHORIZED", "NATIVE_TIMELINE_OVERLAP", "DRAFT_LIMIT", "INVALID_INPUT", "ADOPTION_UNAVAILABLE", "ADOPTION_ALREADY_USED"].find(code => message.includes(code))
    ?? (message.includes("write_rate_limited") ? "RATE_LIMITED" : "UNAVAILABLE");
}
export async function writeNative(session: { kind: NativeDraft["mode"]; user: { id: string } }, id: string, revision: number, content: NativeStoredContent, lease: string | null = null) {
  const document = nativeDocumentSchema.parse(content.document);
  if (document.ownerScope !== nativeOwnerScope(session.user.id) || document.mode !== session.kind) throw new Error("ACCOUNT_CHANGED");
  const result = await adminClient().rpc("save_native_log_draft", { p_owner: session.user.id, p_id: id, p_revision: revision, p_content: encryptNarrative(JSON.stringify({ ...content, document })), p_lease: lease });
  if (result.error) throw new Error(rpcFailure(result.error.message));
  return result.data as number;
}
