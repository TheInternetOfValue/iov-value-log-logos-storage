import { NextRequest } from "next/server";
import { z } from "zod";
import { valueLogOrigin } from "@/lib/app-origin";
import { privateJson } from "@/lib/members/http";
import { loadNative, nativeSession, nativeJson, nativeOwnerScope, nativeFailure, nativeLoggingOpen } from "@/lib/native-log/server";
import { recoveryKey } from "@/lib/native-log/recovery-key";
import { deviceRecoveryFor } from "@/lib/field-station/shared-day";
const input = z.object({ id: z.uuid(), turn: z.uuid(), ticket: z.string().max(1500).nullable() }).strict();
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== valueLogOrigin() || !request.headers.get("content-type")?.startsWith("application/json") || ["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "")) throw new Error("ORIGIN_REQUIRED");
    const session = await nativeSession(request), body = input.safeParse(await nativeJson(request));
    if (!body.success) throw new Error("INVALID_INPUT");
    // Pausing new capture must not prevent an authenticated owner recovering
    // existing ciphertext within its original, non-extendable ticket lifetime.
    if (!body.data.ticket && (!nativeLoggingOpen() || !await deviceRecoveryFor(session.user.id, session.kind))) throw new Error("WRITING_PAUSED");
    const row = await loadNative(session, body.data.id);
    if (row.status !== "draft") throw new Error("NATIVE_DRAFT_CLOSED");
    const result = recoveryKey(session.user.id, row.id, body.data.turn, body.data.ticket);
    return privateJson({ ...result, ownerScope: nativeOwnerScope(session.user.id) });
  } catch (error) {
    if (error instanceof Error && error.message === "RECOVERY_UNAVAILABLE") return privateJson({ code: "RECOVERY_UNAVAILABLE", error: "This device recording cannot be unlocked. It may have expired or belong to a different account." }, 409);
    return nativeFailure(error);
  }
}
