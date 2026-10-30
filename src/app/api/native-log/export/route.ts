import { NextRequest } from "next/server";
import { z } from "zod";
import { privateJson } from "@/lib/members/http";
import { nativeColumns, nativeFailure, nativeSession, nativeView, type NativeRow } from "@/lib/native-log/server";
export const runtime = "nodejs";
/** Bounded pages include removal markers; never silently truncate a private export. */
export async function GET(request: NextRequest) {
  try {
    const session = await nativeSession(request);
    const cursor = request.nextUrl.searchParams.get("cursor");
    const cutoff = request.nextUrl.searchParams.get("cutoff") ?? new Date().toISOString();
    if (cursor && !z.uuid().safeParse(cursor).success || !z.iso.datetime().safeParse(cutoff).success || Date.parse(cutoff) > Date.now() + 60000) throw new Error("INVALID_INPUT");
    let query = session.client.from("native_log_drafts").select(nativeColumns).eq("owner_id", session.user.id).lte("created_at", cutoff).order("id").limit(5);
    if (cursor) query = query.gt("id", cursor);
    const result = await query;
    if (result.error) throw new Error("UNAVAILABLE");
    const rows = result.data as unknown as NativeRow[];
    return privateJson({ records: rows.map(nativeView), cutoff, next: rows.length === 5 ? rows.at(-1)!.id : null });
  } catch (error) { return nativeFailure(error); }
}
