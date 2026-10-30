import { NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/members/http";
import { nativeSaveSchema } from "@/lib/native-log/schema";
import { loadNative, nativeColumns, nativeFailure, nativeJson, nativeOwnerScope, nativeSession, nativeView, readNativeContent, rpcFailure, writeNative, type NativeRow } from "@/lib/native-log/server";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const session = await nativeSession(request);
    const id = request.nextUrl.searchParams.get("id");
    if (id) { if (!z.uuid().safeParse(id).success) throw new Error("INVALID_INPUT"); return privateJson(nativeView(await loadNative(session, id))); }
    const result = await session.client.from("native_log_drafts").select(nativeColumns).eq("owner_id", session.user.id).neq("status", "removed").order("updated_at", { ascending: false }).limit(50);
    if (result.error) throw new Error("UNAVAILABLE");
    return privateJson({ drafts: (result.data as unknown as NativeRow[]).map(row => {
      const view = nativeView(row); return { id: row.id, revision: row.revision, status: row.status, updatedAt: row.updated_at, date: view.document?.date ?? null, count: view.document?.activities.length ?? 0 };
    }) });
  } catch (error) { return nativeFailure(error); }
}
export async function PUT(request: NextRequest) {
  try {
    const session = await nativeSession(request, true), input = nativeSaveSchema.safeParse(await nativeJson(request));
    if (!input.success) throw new Error("INVALID_INPUT");
    const { id, revision, document } = input.data;
    if (document.ownerScope !== nativeOwnerScope(session.user.id) || document.mode !== session.kind) throw new Error("ACCOUNT_CHANGED");
    let previous;
    try { previous = readNativeContent(await loadNative(session, id)); }
    catch (error) { if (!(error instanceof Error) || error.message !== "NOT_FOUND" || revision !== 0) throw error; }
    const content = { ...(previous ?? { parts: {}, totalParts: null, storageConsentAt: new Date().toISOString() }), processingError: undefined, document: { ...document, reviewedRevision: null } };
    const next = await writeNative(session, id, revision, content);
    return privateJson({ id, revision: next, document: content.document });
  } catch (error) { return nativeFailure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const session = await nativeSession(request, true);
    const input = z.object({ id: z.uuid(), revision: z.number().int().min(1) }).strict().safeParse(await nativeJson(request));
    if (!input.success) throw new Error("INVALID_INPUT");
    const result = await adminClient().rpc("remove_native_log_draft", { p_owner: session.user.id, p_id: input.data.id, p_revision: input.data.revision });
    if (result.error) throw new Error(rpcFailure(result.error.message));
    return privateJson({ removed: true });
  } catch (error) { return nativeFailure(error); }
}
