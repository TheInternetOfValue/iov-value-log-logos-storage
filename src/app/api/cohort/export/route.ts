import { NextRequest } from "next/server";
import { z } from "zod";
import { memberSession } from "@/lib/members/session";
import { adminClient } from "@/lib/supabase/admin";
import { checkMemberBinding, privateJson } from "@/lib/members/http";
import { cohortFailure } from "@/lib/cohort/http";
import { readCipher } from "@/lib/cohort/server";
import { readApprovedSource } from "@/lib/cohort/sources";
import type { NativeRow } from "@/lib/native-log/storage-core";
const tables = [
  "cohort_enrollments",
  "cohort_memberships",
  "cohort_reviewer_delegations",
  "cohort_rate_policies",
  "cohort_records",
  "cohort_review_events",
  "cohort_replay_runs",
  "approved_sources",
  "cohort_source_links",
] as const;
const querySchema = z.object({
  table: z.enum(tables),
  offset: z.coerce.number().int().min(0).max(1000000),
  cutoff: z.iso.datetime({ offset: true }),
});
export async function GET(request: NextRequest) {
  try {
    const session = await memberSession(),
      parsed = querySchema.safeParse({
        table: request.nextUrl.searchParams.get("table"),
        offset: request.nextUrl.searchParams.get("offset") ?? 0,
        cutoff:
          request.nextUrl.searchParams.get("cutoff") ??
          new Date().toISOString(),
      });
    checkMemberBinding(request,session.user.id);
    if (!parsed.success) throw new Error("INVALID_INPUT");
    const { table, offset, cutoff } = parsed.data;
    let q = adminClient()
      .from(table === "approved_sources" ? "native_log_drafts" : table)
      .select("*")
      .eq("owner_id", session.user.id);
    if (table === "approved_sources") q = q.eq("receipt->>sourceReferenced", "true").eq("receipt->>kind", "cohort_review_pending");
    q = q.lte(
      table === "cohort_reviewer_delegations" ? "granted_at" : "created_at",
      cutoff,
    );
    q = table === "cohort_source_links" ? q.order("policy_id").order("kind").order("source_id") : q.order(table === "cohort_enrollments" ? "owner_id" : "id");
    const r = await q.range(offset, offset + 99);
    if (r.error) throw new Error("UNAVAILABLE");
    const rows = (r.data ?? []).map((row) => table === "approved_sources" ? { id: row.id, document: readApprovedSource(session.user.id, row as unknown as NativeRow) } : ({
      ...row,
      ...(row.content ? { content: readCipher(row.content) } : {}),
    }));
    return privateJson({
      table,
      cutoff,
      rows,
      next: rows.length === 100 ? offset + 100 : null,
    });
  } catch (error) {
    return cohortFailure(error);
  }
}
