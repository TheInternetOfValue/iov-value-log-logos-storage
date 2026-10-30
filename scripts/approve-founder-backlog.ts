import { pathToFileURL } from "node:url";
import { adminClient } from "../src/lib/supabase/admin-core";
import { MOSES_CANONICAL_DID } from "../src/lib/identity";
import { appendNewFounderPilotRows, founderPilotValidationRows } from "../src/lib/founder-review-server";
import { findTimelineOverlaps } from "../src/lib/timeline-integrity";
import { runReplayFrom } from "../src/lib/replay";
import { founderWellbeingMode } from "../src/lib/founder-mode";
import type { Community, WellbeingNode } from "../src/lib/domain";
import type { PerformanceImpactStatus } from "../src/lib/founder-pilot-authority";

export function approvedPerformanceImpact(slice: {
  founder_performance_impact_status: string | null;
  founder_performance_impact: string | null;
  impact_direction: string | null;
}) {
  if (slice.founder_performance_impact_status === "applied") {
    if (!["positive", "negative"].includes(slice.impact_direction ?? "")
      || !["low", "medium", "high"].includes(slice.founder_performance_impact ?? "")) {
      throw new Error("Applied impact requires existing direction and intensity");
    }
    return { status: "applied" as const, impact: slice.founder_performance_impact, direction: slice.impact_direction };
  }
  return { status: "no_transition" as const, impact: null, direction: null };
}

export async function approveFounderBacklog(apply: boolean, approvalReference?: string) {
  if (apply && founderWellbeingMode() !== "founder_v0_1_live") throw new Error("Live founder calculation mode required");
  const db = adminClient();
  const { data: binding, error: bindingError } = await db.from("member_identity_bindings")
    .select("owner_id").eq("did", MOSES_CANONICAL_DID).single();
  if (bindingError || !binding) throw new Error("Canonical owner binding required");
  const ownerId = binding.owner_id;
  const cutoff = new Date().toISOString();
  const [{ data: timeline, error: timelineError }, { data: drafts, error: draftError }, { data: running, error: runningError }] = await Promise.all([
    db.from("canonical_slices").select("*").eq("owner_id", ownerId).order("start_at").limit(10000),
    db.from("draft_slices").select("id").eq("owner_id", ownerId).eq("status", "drafted"),
    db.from("replay_runs").select("id").eq("owner_id", ownerId).eq("status", "running"),
  ]);
  if (timelineError || draftError || runningError) throw new Error("Review preflight read failed");
  if ((timeline?.length ?? 0) >= 10000) throw new Error("Timeline requires pagination before approval");
  if (findTimelineOverlaps(timeline ?? []).length) throw new Error("Timeline correction required before approval");
  if (drafts?.length) throw new Error("Observer draft decisions remain");
  if (running?.length) throw new Error("Wait for the active replay before approval");
  const pending = (timeline ?? []).filter(slice => slice.status === "validation_pending" && new Date(slice.end_at).getTime() <= new Date(cutoff).getTime());
  // Resolve all appointments and validate all declared impacts before any write.
  const prepared = [];
  for (const slice of pending) {
    const impact = slice.slice_type === "performance" ? approvedPerformanceImpact(slice) : null;
    const routed = await founderPilotValidationRows(db, ownerId, {
      id: slice.id, slice_type: slice.slice_type, community: slice.community as Community,
      wellbeing_node: slice.wellbeing_node as WellbeingNode, proof: slice.proof,
      performance_impact_status: impact?.status as PerformanceImpactStatus | undefined,
    }, {
      adequate: true, classification: true, integrity: slice.slice_type === "non_performance" ? true : null,
      rationale: `Owner-authorized founder backlog approval: ${approvalReference ?? "dry-run"}`,
      reviewed: slice.proof || "Owner-approved activity evidence.",
    });
    if (!routed.settles) throw new Error("Final source and impact decisions required");
    prepared.push({ slice, impact, rows: routed.rows });
  }
  if (!apply) return { mode: "dry-run", completedPending: prepared.length, cutoff };
  if (!approvalReference?.trim()) throw new Error("Explicit owner approval reference required");
  for (const { slice, impact, rows } of prepared) {
    await appendNewFounderPilotRows(db, rows);
    const { data: updated, error } = await db.from("canonical_slices").update({
      status: "validated",
      ...(impact ? { founder_performance_impact_status: impact.status, founder_performance_impact: impact.impact, impact_direction: impact.direction } : {}),
    }).eq("owner_id", ownerId).eq("id", slice.id).eq("status", "validation_pending").select("id").maybeSingle();
    if (error) throw new Error("Could not advance reviewed record");
    if (updated) {
      const { error: auditError } = await db.from("audit_events").insert({
        owner_id: ownerId, actor_id: ownerId, actor_type: "validator", event_type: "founder_backlog_review_confirmed",
        entity_type: "canonical_slice", entity_id: slice.id,
        metadata: { approval_reference: approvalReference, cutoff_at: cutoff, impact_status: impact?.status ?? null },
      });
      if (auditError) throw new Error("Could not record review audit");
    }
  }
  const { data: earliest, error: earliestError } = await db.from("canonical_slices").select("start_at")
    .eq("owner_id", ownerId).eq("status", "validated").order("start_at").limit(1).maybeSingle();
  if (earliestError) throw new Error("Could not determine replay start");
  if (!earliest) return { mode: "applied", approved: prepared.length, replay: "not_needed" };
  const { data: run, error: runError } = await db.from("replay_runs").insert({
    owner_id: ownerId, reason: `owner_approved_backlog:${approvalReference}`, from_timestamp: earliest.start_at,
    heartbeat_at: new Date().toISOString(),
  }).select("id").single();
  if (runError || !run) throw new Error("Reviewed records saved; replay could not start");
  await runReplayFrom(ownerId, earliest.start_at, run.id);
  const [{ data: result }, { data: outstanding, error: outstandingError }, { data: founderRun }] = await Promise.all([
    db.from("replay_runs").select("status,affected_count").eq("id", run.id).single(),
    db.from("canonical_slices").select("id").eq("owner_id", ownerId).in("status", ["validation_pending", "validated"]).lte("end_at", cutoff),
    db.from("founder_wellbeing_replay_runs").select("id,status").eq("owner_id", ownerId).eq("reason", `legacy_replay:${run.id}`).single(),
  ]);
  if (outstandingError || result?.status !== "completed" || outstanding?.length || founderRun?.status !== "completed") {
    throw new Error("Approval saved; calculation requires inspection");
  }
  const { data: promoted, error: promotionError } = await db.from("current_promoted_founder_replay")
    .select("replay_run_id,verification_id,promotion_id").eq("owner_id", ownerId).single();
  if (promotionError || promoted?.replay_run_id !== founderRun.id) throw new Error("Calculation candidate did not pass promotion");
  return { mode: "applied", approved: prepared.length, calculated: result.affected_count, pending: 0, replayRunId: run.id, ...promoted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  approveFounderBacklog(process.argv.includes("--apply"), process.argv.find(arg => arg.startsWith("--approval-reference="))?.split("=").slice(1).join("="))
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error("Founder backlog operation stopped; inspect private replay/audit state before retrying."); process.exitCode = 1; });
}
