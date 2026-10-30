import { NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { encryptNarrative, narrativeDigest } from "@/lib/crypto";
import { localDateFor } from "@/lib/format";
import { dateSchema, entrySchema } from "@/lib/members/entries";
import { checkMemberBinding, memberFailure, memberWrite, personalSession, privateJson } from "@/lib/members/http";
import { entryColumns, readMemberEntry } from "@/lib/members/storage";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const session = await personalSession();
    checkMemberBinding(request, session.user.id);
    const date = dateSchema.safeParse(request.nextUrl.searchParams.get("date"));
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    if (!date.success || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("INVALID_INPUT");
    const result = await session.client.from("member_activity_entries").select(entryColumns, { count: "exact" })
      .eq("owner_id", session.user.id).eq("activity_date", date.data).is("removed_at", null)
      .order("created_at").order("id").range(offset, offset + 49);
    if (result.error) throw new Error("UNAVAILABLE");
    return privateJson({ entries: result.data.map(readMemberEntry), total: result.count ?? 0 });
  } catch (error) { return memberFailure(error); }
}
export async function PUT(request: NextRequest) {
  try {
    const { session, body } = await memberWrite(request);
    const parsed = entrySchema.safeParse(body);
    if (!parsed.success || parsed.data.date > localDateFor(new Date().toISOString(), session.timezone)) throw new Error("INVALID_INPUT");
    const e = parsed.data;
    const content = encryptNarrative(JSON.stringify({ date: e.date, node: e.node, text: e.text, minutes: e.minutes }));
    const result = await adminClient().rpc("save_value_log_member_entry", {
      p_owner_id: session.user.id, p_id: e.id, p_revision: e.revision, p_date: e.date, p_node: e.node, p_content: content,
    });
    if (result.error) throw new Error(result.error.message.includes("revision_conflict") ? "REVISION_CONFLICT" : result.error.message.includes("write_rate_limited") ? "RATE_LIMITED" : "UNAVAILABLE");
    return privateJson({ id: e.id, revision: result.data });
  } catch (error) { return memberFailure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const { session, body } = await memberWrite(request);
    const parsed = z.object({ id: z.uuid(), revision: z.number().int().min(1).max(2147483645) }).strict().safeParse(body);
    if (!parsed.success) throw new Error("INVALID_INPUT");
    const row = await session.client.from("member_activity_entries").select("activity_date,wellbeing_node").eq("owner_id", session.user.id).eq("id", parsed.data.id).single();
    if (row.error) throw new Error("UNAVAILABLE");
    const result = await adminClient().rpc("save_value_log_member_entry", {
      p_owner_id: session.user.id, p_id: parsed.data.id, p_revision: parsed.data.revision,
      p_date: row.data.activity_date, p_node: row.data.wellbeing_node,
      p_content: { digest: narrativeDigest(`removed:${parsed.data.id}:${parsed.data.revision}`) }, p_remove: true,
    });
    if (result.error) throw new Error(result.error.message.includes("revision_conflict") ? "REVISION_CONFLICT" : result.error.message.includes("write_rate_limited") ? "RATE_LIMITED" : "UNAVAILABLE");
    return privateJson({ removed: true, revision: result.data });
  } catch (error) { return memberFailure(error); }
}
