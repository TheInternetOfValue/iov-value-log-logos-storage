import "server-only";
import { NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { memberSession } from "@/lib/members/session";
import { checkMemberBinding, privateJson } from "@/lib/members/http";
import { memberWritingOpen } from "@/lib/members/admission";
import { valueLogOrigin } from "@/lib/app-origin";
import { nativeProviderAllowance } from "./allowance";

export const nativeLoggingOpen = () => process.env.VALUE_LOG_NATIVE_LOGGING === "open";
export type NativeSession = Awaited<ReturnType<typeof memberSession>>;
export { nativeOwnerScope, nativeColumns, nativeView, readNativeContent, rpcFailure, writeNative, type NativeRow, type NativeReceipt } from "./storage-core";
import { nativeColumns, rpcFailure, type NativeRow } from "./storage-core";
export async function nativeSession(request: NextRequest, write = false, multipart = false) {
  if (write && (request.headers.get("origin") !== valueLogOrigin() || ["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "")
    || !request.headers.get("content-type")?.startsWith(multipart ? "multipart/form-data;" : "application/json"))) throw new Error("ORIGIN_REQUIRED");
  const session = await memberSession();
  checkMemberBinding(request, session.user.id);
  if (session.kind === "personal" && !session.onboarded) throw new Error("UNAUTHORIZED");
  if (write && (!nativeLoggingOpen() || session.kind === "personal" && !memberWritingOpen())) throw new Error("WRITING_PAUSED");
  return session;
}
export async function nativeBytes(request: NextRequest, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new Error("PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_INPUT");
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error("PAYLOAD_TOO_LARGE"); } chunks.push(next.value); }
  return Buffer.concat(chunks);
}
export async function nativeJson(request: NextRequest) {
  try { return JSON.parse((await nativeBytes(request, 450000)).toString("utf8")) as unknown; }
  catch (error) { if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") throw error; throw new Error("INVALID_INPUT"); }
}
export async function loadNative(session: NativeSession, id: string) {
  const result = await session.client.from("native_log_drafts").select(nativeColumns).eq("owner_id", session.user.id).eq("id", id).maybeSingle();
  if (result.error) throw new Error("UNAVAILABLE");
  if (!result.data) throw new Error("NOT_FOUND");
  return result.data as unknown as NativeRow;
}
export async function withNativeProcessing<T>(session: NativeSession, row: NativeRow, operation: (lease: string) => Promise<T>) {
  const db = adminClient();
  const reserved = await db.rpc("reserve_native_log_processing", { p_owner: session.user.id, p_id: row.id, p_revision: row.revision });
  if (reserved.error || typeof reserved.data !== "string") throw new Error(rpcFailure(reserved.error?.message ?? "UNAVAILABLE"));
  try { return await operation(reserved.data); }
  finally { await db.rpc("release_native_log_processing", { p_owner: session.user.id, p_id: row.id, p_token: reserved.data }); }
}
export async function providerAllowance(session: NativeSession, operation: "stt" | "chat") {
  return nativeProviderAllowance(session.user.id, operation);
}
export function nativeFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "UNAVAILABLE";
  const status = code === "OMISSION_REVIEW_REQUIRED" ? 409 : code === "UNAUTHORIZED" ? 401 : ["ACCOUNT_CHANGED", "ORIGIN_REQUIRED"].includes(code) ? 403 : code === "NOT_FOUND" ? 404
    : ["ADOPTION_UNAVAILABLE", "ADOPTION_ALREADY_USED", "INCOMPLETE_RECORDING", "CAPTURE_REVIEW_REQUIRED", "NO_TRANSCRIBED_WORDS", "REVISION_CONFLICT", "PROCESSING_BUSY", "NATIVE_DRAFT_CLOSED", "NATIVE_TIMELINE_OVERLAP", "TIME_REQUIRES_REVIEW", "RECOGNITION_REQUIRED", "TRANSCRIPT_CHANGED"].includes(code) ? 409
      : ["RATE_LIMITED", "PROVIDER_ALLOWANCE"].includes(code) ? 429 : code === "PAYLOAD_TOO_LARGE" ? 413 : ["INVALID_INPUT", "REVIEW_REQUIRED", "TOO_MANY_RECORDS"].includes(code) ? 400 : 503;
  const messages: Record<string, string> = {
    INCOMPLETE_RECORDING: "This recording is not fully processed. Keep the original tab open and retry, or deliberately use only its saved words.",
    CAPTURE_REVIEW_REQUIRED: "Part of this recording may be missing. Listen before choosing to use the captured words.",
    NO_TRANSCRIBED_WORDS: "No words came back from this recording. Keep the audio and try again.",
    ADOPTION_UNAVAILABLE: "This earlier log cannot be adopted into this policy. Its original private record is unchanged.",
    ADOPTION_ALREADY_USED: "This earlier log was already adopted. Open its existing Review record to correct it without counting it again.",
    OMISSION_REVIEW_REQUIRED: "Some narrated activities may be missing from this table. Your words are saved; process them again or add what’s missing before submitting.",
    UNAUTHORIZED: "Sign in again in another tab, then return here. Keep this page open to preserve your recording and writing.",
    ACCOUNT_CHANGED: "The signed-in account changed. Return to the original account before continuing. Your writing is still here.",
    ORIGIN_REQUIRED: "Open Value Log and try again.", NOT_FOUND: "This draft is not available in this account.",
    REVISION_CONFLICT: "This draft changed in another tab. Your writing is still here. Open the saved draft before continuing.",
    PROCESSING_BUSY: "This draft is already being processed. Wait a moment, then try again.", NATIVE_DRAFT_CLOSED: "This draft was already submitted or removed. Open your saved logs before starting another.",
    NATIVE_TIMELINE_OVERLAP: "These times overlap an existing activity. Check the timeline before confirming.",
    TIME_REQUIRES_REVIEW: "Check the dates, times and timezone before confirming.", RECOGNITION_REQUIRED: "Verified recognition is not available for that community and date. Your draft is saved; review its route before confirming.",
    REVIEW_REQUIRED: "Check the missing details and review the full timeline before confirming.",
    TRANSCRIPT_CHANGED: "You edited these words or activities after transcription began. Keep the edited draft, or start a new log for a different recording.",
    TOO_MANY_RECORDS: "This log has more than thirty records after splitting sleep across dates. Keep fewer activities in this log and save the others separately.",
    RATE_LIMITED: "Please wait before saving again. Your writing is still here.", PROVIDER_ALLOWANCE: "Today's voice-processing allowance is used. Your saved drafts remain available; you can keep writing and try again later.",
    PAYLOAD_TOO_LARGE: "This recording or draft is too large. Use a shorter recording or split your log.", INVALID_INPUT: "Check the recording, activities and dates, then try again.",
    WRITING_PAUSED: "Native logging is temporarily paused. Your saved drafts remain available.",
    PROVIDER_TIMEOUT: "Processing took too long. Your recording and saved words are still available; try again.",
    PROVIDER_RESPONSE: "The proposed activities could not be checked. Your words are saved. Try again or add the activities yourself.",
    PROVIDER_UNAVAILABLE: "Voice processing is temporarily unavailable. Your recording and writing are still here.",
    DRAFT_LIMIT: "You have many unfinished drafts. Finish or remove an old draft before creating another.",
  };
  console.warn("native_log_request_failed", { code: Object.hasOwn(messages, code) ? code : "UNAVAILABLE", status });
  return privateJson({ error: messages[code] ?? "Value Log could not finish. Your writing is still here; try again.", code: Object.hasOwn(messages, code) ? code : "UNAVAILABLE" }, status);
}
