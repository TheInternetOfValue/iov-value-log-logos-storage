import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { isReplayStale } from "@/lib/replay-runtime";

async function closeStaleReplay(ownerId: string, replay: { id: string; heartbeat_at: string | null; started_at: string }) {
  const db = adminClient();
  const now = new Date().toISOString();
  const message = "Replay worker stopped before completion and is safe to retry.";
  const { data: closed } = await db.from("replay_runs").update({
    status: "failed", completed_at: now, heartbeat_at: now, failure_message: message,
  }).eq("id", replay.id).eq("owner_id", ownerId).eq("status", "running").select("id").maybeSingle();
  if (closed) await db.from("audit_events").insert({
    owner_id: ownerId, actor_type: "system", event_type: "chronological_replay_stale_recovered",
    entity_type: "replay_run", entity_id: replay.id,
    metadata: { last_heartbeat_at: replay.heartbeat_at ?? replay.started_at },
  });
  return Boolean(closed);
}

export async function enqueueReplay(ownerId: string, fromTimestamp: string, reason: string) {
  const db = adminClient();
  const { data: running } = await db.from("replay_runs").select("id,from_timestamp,status,started_at,heartbeat_at")
    .eq("owner_id", ownerId).eq("status", "running").limit(1).maybeSingle();
  if (running && !isReplayStale(running)) return running;
  let replayFrom = fromTimestamp;
  let replayReason = reason;
  if (running) {
    const closed = await closeStaleReplay(ownerId, running);
    if (!closed) {
      const { data: current } = await db.from("replay_runs").select("id,from_timestamp,status")
        .eq("owner_id", ownerId).eq("status", "running").limit(1).maybeSingle();
      if (current) return current;
    }
    if (running.from_timestamp && running.from_timestamp < replayFrom) replayFrom = running.from_timestamp;
    replayReason = `stale_recovery:${running.id};${reason}`;
  }

  const { data: run, error } = await db.from("replay_runs").insert({ owner_id: ownerId, reason: replayReason, from_timestamp: replayFrom, heartbeat_at: new Date().toISOString() })
    .select("id,from_timestamp,status").single();
  if (error || !run) throw new Error(error?.message ?? "Could not create replay run");

  const secret = process.env.REPLAY_WORKER_SECRET;
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!secret || !origin) {
    await db.from("replay_runs").update({ status: "failed", completed_at: new Date().toISOString(), failure_message: "Replay worker is not configured" }).eq("id", run.id);
    throw new Error("Replay worker is not configured");
  }
  const response = await fetch(`${origin}/.netlify/functions/replay-value-log-background`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ owner_id: ownerId, from_timestamp: replayFrom, replay_run_id: run.id }),
  });
  if (!response.ok) {
    await db.from("replay_runs").update({ status: "failed", completed_at: new Date().toISOString(), failure_message: `Worker acknowledgement failed (${response.status})` }).eq("id", run.id);
    throw new Error("Replay worker did not acknowledge the request");
  }
  return run;
}
