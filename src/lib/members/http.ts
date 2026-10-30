import "server-only";
import { timingSafeEqual } from "node:crypto";
import { narrativeDigest } from "@/lib/crypto";
import { NextRequest, NextResponse } from "next/server";
import { valueLogOrigin } from "@/lib/app-origin";
import { memberSession } from "./session";
import { memberWritingOpen } from "./admission";

export function privateJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
export const memberWriteBinding = (owner: string) => narrativeDigest(`value-log-member-write:${owner}`);
export function checkMemberBinding(request: NextRequest, owner: string) {
  const supplied = request.headers.get("x-value-log-session") ?? "";
  const expected = memberWriteBinding(owner);
  if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error("ACCOUNT_CHANGED");
}
export async function personalSession() {
  const session = await memberSession();
  if (session.kind !== "personal") throw new Error("UNAUTHORIZED");
  return session;
}
/** Cookies authenticate; exact Origin plus JSON and Fetch Metadata protect mutations. */
export async function memberWrite(request: NextRequest) {
  if (request.headers.get("origin") !== valueLogOrigin()
    || !request.headers.get("content-type")?.startsWith("application/json")
    || ["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "")) throw new Error("ORIGIN_REQUIRED");
  const session = await personalSession();
  checkMemberBinding(request, session.user.id);
  if (!memberWritingOpen()) throw new Error("WRITING_PAUSED");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_INPUT");
  const chunks: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const result = await reader.read(); if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > 30_000) { await reader.cancel(); throw new Error("INVALID_INPUT"); }
    chunks.push(result.value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("INVALID_INPUT"); }
  return { session, body };
}
export function memberFailure(error: unknown) {
  const reason = error instanceof Error ? error.message : "UNAVAILABLE";
  const status = reason === "UNAUTHORIZED" ? 401 : ["ORIGIN_REQUIRED", "ACCOUNT_CHANGED"].includes(reason) ? 403
    : reason === "RATE_LIMITED" ? 429 : reason === "INVALID_INPUT" ? 400 : reason === "REVISION_CONFLICT" ? 409 : 503;
  return privateJson({ error: status === 401 ? "Sign in again to continue. Keep this page open to preserve your writing."
    : reason === "ACCOUNT_CHANGED" ? "The signed-in account changed. Keep your writing here and sign back into the original account before saving."
    : status === 403 ? "Open Value Log and try again."
    : status === 400 ? "Check the date, activity and duration, then try again."
    : status === 409 ? "This activity changed in another tab. Your writing is still here; reload the saved version before editing again."
    : reason === "RATE_LIMITED" ? "Please wait a minute before saving again. Your writing is still here."
    : reason === "WRITING_PAUSED" ? "Saving is temporarily paused. Your saved activities remain available."
    : "Value Log could not finish. Your writing is still here; try again." }, status);
}
