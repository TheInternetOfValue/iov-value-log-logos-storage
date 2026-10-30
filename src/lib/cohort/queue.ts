import { adminClient } from "@/lib/supabase/admin-core";
import { valueLogOrigin } from "@/lib/app-origin";
import { cohortReviewOpen, cohortCalculationOpen } from "./storage";
import { reviewSignature } from "./review-worker";
import { cohortPolicyStageOpen, anyDatedStageOpen, isDatedPolicy } from "@/lib/field-station/dated-policy";
import { COHORT_POLICY } from "./policy";
import { randomUUID } from "node:crypto";
export const runCohortQueue = async () => {
  if (
    process.env.CONTEXT !== "production" ||
    (!cohortReviewOpen() && !cohortCalculationOpen() && !anyDatedStageOpen("REVIEW") && !anyDatedStageOpen("CALCULATION"))
  )
    return;
  const db = adminClient(),
    agent = await db
      .from("cohort_agents")
      .select("active")
      .eq("id", "system:field-station-reviewer:v1")
      .single();
  if (agent.error) throw new Error("QUEUE_UNAVAILABLE");
  const reviewReady = agent.data?.active;
  const metrics = { dueOwners: 0, dispatched: 0, oldestDueSeconds: 0 };
  const processMember = async (member: { owner_id: string; policy_id?: string; revision: number; calculated_revision: number }) => {
      const reviewAllowed = reviewReady && cohortPolicyStageOpen(member.policy_id ?? COHORT_POLICY, "REVIEW");
      const calculationAllowed = cohortPolicyStageOpen(member.policy_id ?? COHORT_POLICY, "CALCULATION");
      if (!reviewAllowed && !calculationAllowed) return;
      const owner = String(member.owner_id),
        due = await db
          .from("cohort_records")
          .select("id,created_at")
          .eq("owner_id", owner)
          .eq("review_status", "pending")
          .or(`retry_after.is.null,retry_after.lte.${new Date().toISOString()}`)
          .order("created_at")
          .limit(1);
      if (due.error) throw new Error("QUEUE_UNAVAILABLE");
      if (due.data?.length) {
        metrics.dueOwners++;
        const age = (Date.now() - Date.parse(due.data[0].created_at)) / 1000;
        if (Number.isFinite(age))
          metrics.oldestDueSeconds = Math.max(
            metrics.oldestDueSeconds,
            Math.max(0, Math.floor(age)),
          );
      }
      let calculate = false;
      if (
        calculationAllowed &&
        member.revision !== member.calculated_revision
      ) {
        const unresolved = await db
          .from("cohort_records")
          .select("id")
          .eq("owner_id", owner)
          .in("review_status", ["pending", "clarification", "escalated"])
          .limit(1);
        if (unresolved.error) throw new Error("QUEUE_UNAVAILABLE");
        calculate = !unresolved.data?.length;
        if (calculate && isDatedPolicy(member.policy_id ?? "")) {
          const notes = await db.from("native_log_day_index").select("source_id").eq("owner_id", owner).eq("outcome", "clarification").eq("source_kind", "native").is("superseded_at", null).limit(1);
          if (notes.error) throw new Error("QUEUE_UNAVAILABLE"); calculate = !notes.data?.length;
        }
      }
      if (!(reviewAllowed && due.data?.length) && !calculate) return;
      const body = JSON.stringify({ owner, expires: Date.now() + 120000 });
      const r = await fetch(
        `${valueLogOrigin()}/.netlify/functions/cohort-review-background`,
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "x-cohort-job": reviewSignature(body),
          },
          body,
          signal: AbortSignal.timeout(5000),
        },
      );
      await r.body?.cancel();
      if (!r.ok) throw new Error("QUEUE_DISPATCH_UNAVAILABLE");
      metrics.dispatched++;
    };
  // Keyset pages include every consenting owner. Each gets at most one review
  // dispatch per sweep; bounded batches avoid a burst of concurrent requests.
  const pageSize = 50, concurrency = 5;
  const token = randomUUID(), started = Date.now();
  const claim = await db.rpc("claim_cohort_queue_cursor", { p_token: token });
  if (claim.error) throw new Error("QUEUE_UNAVAILABLE");
  if (!claim.data) return;
  let cursor = String(claim.data.cursor ?? ""), failed = false;
  try { sweep: for (;;) {
    let query = db.from("cohort_enrollments")
      .select("owner_id,policy_id,revision,calculated_revision")
      .eq("active", true).eq("review_consent", true).order("owner_id");
    if (cursor) query = query.gt("owner_id", cursor);
    const members = await query.limit(pageSize);
    if (members.error) throw new Error("QUEUE_UNAVAILABLE");
    const page = members.data ?? [];
    for (let offset = 0; offset < page.length; offset += concurrency) {
      if (Date.now() - started >= 18000) break sweep;
      const results = await Promise.allSettled(page.slice(offset, offset + concurrency).map(processMember));
      failed ||= results.some(r => r.status === "rejected");
      const batchCursor = String(page[Math.min(page.length, offset + concurrency) - 1].owner_id);
      const advance = await db.rpc("advance_cohort_queue_cursor", { p_token: token, p_cursor: batchCursor, p_release: false });
      if (advance.error || advance.data !== true) throw new Error("QUEUE_CURSOR_STALE");
      cursor = batchCursor;
    }
    if (page.length < pageSize) { cursor = ""; break; }
  } } finally {
    const release = await db.rpc("advance_cohort_queue_cursor", { p_token: token, p_cursor: cursor || null, p_release: true });
    if (release.error) console.error("cohort_queue_cursor_release_failed");
  }
  if (metrics.dueOwners || metrics.dispatched)
    console.info("cohort_queue_status", metrics);
  if (failed)
    console.error("cohort_queue_dispatch_failed");
};
