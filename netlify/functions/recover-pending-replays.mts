import { adminClient } from "../../src/lib/supabase/admin-core";
import { isReplayStale } from "../../src/lib/replay-runtime";

async function recoverPendingReplays() {
  const db = adminClient();
  const configuredEmail = (process.env.MOSES_EMAIL_ALLOWLIST ?? "").split(",")[0]?.trim().toLowerCase();
  if (!configuredEmail) return;
  const { data: owner } = await db.from("members").select("id").ilike("email", configuredEmail).maybeSingle();
  if (!owner) return;
  const { data: running } = await db.from("replay_runs").select("id,started_at,heartbeat_at")
    .eq("owner_id", owner.id).eq("status", "running").limit(1).maybeSingle();
  if (running && !isReplayStale(running)) return;
  if (running) {
    const now = new Date().toISOString();
    await db.from("replay_runs").update({ status: "failed", completed_at: now, heartbeat_at: now,
      failure_message: "Replay worker stopped before completion and was recovered by the scheduled worker." })
      .eq("id", running.id).eq("status", "running");
    await db.from("audit_events").insert({ owner_id: owner.id, actor_type: "system",
      event_type: "chronological_replay_stale_recovered", entity_type: "replay_run", entity_id: running.id,
      metadata: { recovery: "scheduled", last_heartbeat_at: running.heartbeat_at ?? running.started_at } });
  }
  const { data: earliest } = await db.from("canonical_slices").select("start_at").eq("owner_id", owner.id).eq("status", "validated").order("start_at").limit(1).maybeSingle();
  if (!earliest) return;
  const { data: run, error } = await db.from("replay_runs").insert({ owner_id: owner.id, reason: "scheduled_validated_recovery", from_timestamp: earliest.start_at, heartbeat_at: new Date().toISOString() }).select("id").single();
  if (error || !run) return;
  const secret = process.env.REPLAY_WORKER_SECRET;
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!secret || !origin) {
    await db.from("replay_runs").update({ status: "failed", completed_at: new Date().toISOString(),
      failure_message: "Replay worker is not configured" }).eq("id", run.id);
    return;
  }
  const response = await fetch(`${origin}/.netlify/functions/replay-value-log-background`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ owner_id: owner.id, from_timestamp: earliest.start_at, replay_run_id: run.id }),
  });
  if (!response.ok) await db.from("replay_runs").update({ status: "failed", completed_at: new Date().toISOString(),
    failure_message: `Worker acknowledgement failed (${response.status})` }).eq("id", run.id);
}

export default recoverPendingReplays;
export const config = { schedule: "@hourly" };
