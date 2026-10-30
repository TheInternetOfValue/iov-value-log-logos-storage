import {readMemberAudit} from "./export-audit";
import "server-only";
import { personalSession, privateJson } from "./http";
import { entryColumns, readMemberEntry } from "./storage";
export async function exportMemberLog(session: Awaited<ReturnType<typeof personalSession>>) {
  const startedAt = new Date().toISOString();
  const activities: unknown[] = [], audit: unknown[] = [];
  let activityCursor: string | null = null;
  for (;;) {
    let query = session.client.from("member_activity_entries").select(entryColumns).eq("owner_id", session.user.id).lte("created_at", startedAt).order("id").limit(1000);
    if (activityCursor) query = query.gt("id", activityCursor);
    const result = await query;
    if (result.error) throw new Error("UNAVAILABLE");
    activities.push(...result.data.map(readMemberEntry)); if (result.data.length < 1000) break;
    activityCursor = result.data.at(-1)!.id;
  }
  let auditCursor: string | null = null;
  for (;;) {
    let query = session.client.from("audit_events").select("id,event_type,entity_type,entity_id,metadata,created_at")
      .eq("owner_id", session.user.id).lte("created_at", startedAt).order("id").limit(1000);
    if (auditCursor) query = query.gt("id", auditCursor);
    const result = await query;
    if (result.error) throw new Error("UNAVAILABLE");
    audit.push(...result.data.map(readMemberAudit)); if (result.data.length < 1000) break;
    auditCursor = result.data.at(-1)!.id;
  }
  const data = { schema: "value-log-private-activities-v1", exportedAt: startedAt,
    member: { name: session.name, timezone: session.timezone, did: session.did }, assessment: "unassessed", activities, audit };
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > 4_500_000) throw new Error("EXPORT_USE_PAGED");
  const response = privateJson(data);
  response.headers.set("Content-Disposition", 'attachment; filename="my-value-log.json"');
  return response;
}
