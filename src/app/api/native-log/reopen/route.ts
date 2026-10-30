import { NextRequest } from "next/server";
import { nativeActionSchema } from "@/lib/native-log/schema";
import {
  nativeSession,
  nativeJson,
  nativeFailure,
  loadNative,
  readNativeContent,
  writeNative,
  nativeView,
} from "@/lib/native-log/server";
import {
  captureContinuationIds,
  captureContinuationSlot,
} from "@/lib/native-log/capture";
import { privateJson } from "@/lib/members/http";
export async function POST(request: NextRequest) {
  try {
    const session = await nativeSession(request, true),
      parsed = nativeActionSchema.safeParse(await nativeJson(request));
    if (!parsed.success) throw new Error("INVALID_INPUT");
    const parent = await loadNative(session, parsed.data.id);
    if (parent.revision !== parsed.data.revision)
      throw new Error("REVISION_CONFLICT");
    if (
      parent.status !== "submitted" ||
      parent.receipt?.kind !== "capture_review_pending"
    )
      throw new Error("INVALID_INPUT");
    const children = await session.client
      .from("native_log_drafts")
      .select("id,status")
      .eq("owner_id", session.user.id)
      .in("id", captureContinuationIds(parent));
    if (children.error) throw new Error("UNAVAILABLE");
    const slot = captureContinuationSlot(parent, children.data ?? []);
    if (!slot) throw new Error("DRAFT_LIMIT");
    const { id, generation } = slot;
    try {
      return privateJson(nativeView(await loadNative(session, id)));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "NOT_FOUND")
        throw error;
    }
    const old = readNativeContent(parent);
    const content = {
      ...old,
      approval: undefined,
      continuationGeneration: generation,
      document: {
        ...old.document,
        supersedesDraftId: parent.id,
        revision: old.document.revision + 1,
        reviewedRevision: null,
      },
    };
    try {
      await writeNative(session, id, 0, content);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "REVISION_CONFLICT")
        throw error;
    }
    return privateJson(nativeView(await loadNative(session, id)));
  } catch (error) {
    return nativeFailure(error);
  }
}
