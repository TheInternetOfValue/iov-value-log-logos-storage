import { assertCapturesReady } from "@/lib/native-log/capture-storage";
import { NextRequest } from "next/server";
import { privateJson } from "@/lib/members/http";
import { nativeActionSchema } from "@/lib/native-log/schema";
import { dispatchNativeProcessing } from "@/lib/native-log/dispatch";
import { loadNative, nativeFailure, nativeJson, nativeSession, readNativeContent } from "@/lib/native-log/server";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const session = await nativeSession(request, true), input = nativeActionSchema.safeParse(await nativeJson(request));
    if (!input.success) throw new Error("INVALID_INPUT");
    const { id, revision } = input.data, row = await loadNative(session, id), content = readNativeContent(row);
    if (row.revision !== revision) throw new Error("REVISION_CONFLICT");
    assertCapturesReady(content);
    if (!content.document.transcript.trim()) throw new Error("INVALID_INPUT");
    await dispatchNativeProcessing(session.user.id, id, revision);
    return privateJson({ id, revision, processing: true }, 202);
  } catch (error) { return nativeFailure(error); }
}
