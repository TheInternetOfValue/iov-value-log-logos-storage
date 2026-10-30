import {readMemberAudit} from "./export-audit";
import "server-only";
import type { personalSession } from "./http";
import { entryColumns, readMemberEntry } from "./storage";
type MemberSession = Awaited<ReturnType<typeof personalSession>>;
export async function memberExportPage(session: MemberSession, stage: "activities" | "audit", cutoff: string, cursor?: string) {
  const table = stage === "activities" ? "member_activity_entries" : "audit_events";
  const columns = stage === "activities" ? entryColumns : "id,event_type,entity_type,entity_id,metadata,created_at";
  let query = session.client.from(table).select(columns).eq("owner_id", session.user.id).lte("created_at", cutoff).order("id").limit(100);
  if (cursor) query = query.gt("id", cursor);
  const result = await query;
  if (result.error) throw new Error("UNAVAILABLE");
  const rows = result.data as unknown as Array<Record<string,unknown> & { id: string }>;
  return { records: stage === "activities" ? rows.map(readMemberEntry) : rows.map(readMemberAudit),
    next: rows.length === 100 ? rows.at(-1)!.id : null };
}
