import { NextResponse } from "next/server";
import { decryptNarrative } from "@/lib/crypto";
import { memberSession } from "@/lib/members/session";
import { exportMemberLog } from "@/lib/members/export";
import { privateJson } from "@/lib/members/http";
import { adminClient } from "@/lib/supabase/admin";
import { MOSES_CANONICAL_DID } from "@/lib/identity";

export const runtime = "nodejs";

export async function GET() {
  let session;
  try { session = await memberSession(); }
  catch { return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }); }
  if (session.kind === "personal") {
    try { return await exportMemberLog(session); } catch (error) { return error instanceof Error && error.message === "EXPORT_USE_PAGED" ? privateJson({ error: "Open Privacy & data to download your complete Value Log in pages." }, 413) : privateJson({ error: "Export could not finish. Try again; no partial export was produced." }, 503); }
  }
  const { user } = session;
  const db = adminClient();
  const tables = [
    "intake_sessions", "draft_slices", "canonical_slices", "observer_events",
    "validation_events", "wellbeing_baselines", "community_rate_versions",
    "w_transitions", "credit_events", "audit_events", "pilot_metrics",
    "weekly_review_packets", "weekly_reviews",
  ] as const;
  const exportData: Record<string, unknown> = {};
  for (const table of tables) {
    const ownerColumn = table === "community_rate_versions" ? "created_by" : "owner_id";
    const { data } = await db.from(table).select("*").eq(ownerColumn, user.id);
    if (table === "intake_sessions") {
      exportData[table] = (data ?? []).map((row) => {
        let raw_narrative: string | null = null;
        if (!row.narrative_deleted_at && row.narrative_ciphertext && row.narrative_iv && row.narrative_auth_tag) {
          raw_narrative = decryptNarrative({ ciphertext: row.narrative_ciphertext, iv: row.narrative_iv, authTag: row.narrative_auth_tag });
        }
        return {
          ...row,
          narrative_ciphertext: undefined,
          narrative_iv: undefined,
          narrative_auth_tag: undefined,
          raw_narrative,
        };
      });
    } else exportData[table] = data ?? [];
  }
  const { data: promotedReplay } = await db.from("current_promoted_founder_replay")
    .select("*").eq("owner_id", user.id);
  const promotedRunIds = (promotedReplay ?? []).map((promotion) => promotion.replay_run_id);
  const [
    { data: promotedState },
    { data: promotedValues },
    { data: founderPolicies },
    { data: founderAuthorities },
  ] = await Promise.all([
    promotedRunIds.length
      ? db.from("founder_wellbeing_state_revisions").select("*").in("replay_run_id", promotedRunIds).order("sequence_number")
      : Promise.resolve({ data: [] }),
    promotedRunIds.length
      ? db.from("founder_wellbeing_value_events").select("*").in("replay_run_id", promotedRunIds).order("created_at")
      : Promise.resolve({ data: [] }),
    db.from("founder_flat_community_rate_policy_versions").select("*").eq("subject_did", MOSES_CANONICAL_DID),
    db.from("founder_flat_rate_authority_versions").select("*").eq("subject_did", MOSES_CANONICAL_DID),
  ]);
  const founderHistoryTables = [
    "founder_wellbeing_baseline_epochs",
    "founder_wellbeing_replay_runs",
    "founder_wellbeing_state_revisions",
    "founder_wellbeing_value_events",
    "founder_wellbeing_replay_verifications",
    "founder_wellbeing_replay_promotions",
  ] as const;
  const founderHistory: Record<string, unknown> = {};
  for (const table of founderHistoryTables) {
    const { data } = await db.from(table).select("*").eq("owner_id", user.id);
    founderHistory[table] = data ?? [];
  }
  exportData.founder_current_projection = {
    promoted_replay: promotedReplay ?? [],
    current_state: promotedState ?? [],
    value_events: promotedValues ?? [],
  };
  exportData.founder_append_only_history = {
    ...founderHistory,
    flat_community_rate_policy_versions: founderPolicies ?? [],
    flat_rate_authority_versions: founderAuthorities ?? [],
  };
  await db.from("audit_events").insert({
    owner_id: user.id, actor_id: user.id, actor_type: "observer",
    event_type: "private_export_created", entity_type: "member", entity_id: user.id,
    metadata: { table_count: tables.length + founderHistoryTables.length, founder_projection: "explicitly_promoted_only" },
  });
  return new NextResponse(JSON.stringify({
    exported_at: new Date().toISOString(),
    warning: "Private Value Log export. Handle as sensitive personal data.",
    data: exportData,
  }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="iov-value-log-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
