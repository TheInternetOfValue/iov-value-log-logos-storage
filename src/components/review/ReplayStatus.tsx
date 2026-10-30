"use client";

import { useEffect, useState } from "react";
import { retryReplay } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { isReplayStale } from "@/lib/replay-runtime";

type Replay = { id: string; status: string; started_at: string; completed_at: string | null; from_timestamp: string | null; failure_message: string | null; affected_count: number; heartbeat_at: string | null };

export function ReplayStatus({ initial }: { initial: Replay }) {
  const [replay, setReplay] = useState(initial);
  const [longRunning, setLongRunning] = useState(false);
  useEffect(() => {
    if (replay.status !== "running") return;
    const longTimer = window.setTimeout(() => setLongRunning(true), 10_000);
    const poll = window.setInterval(async () => {
      const response = await fetch(`/api/internal/replay-status?id=${encodeURIComponent(replay.id)}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as Replay;
      setReplay(next);
      if (next.status === "completed") window.setTimeout(() => window.location.reload(), 900);
    }, 2_000);
    return () => { window.clearTimeout(longTimer); window.clearInterval(poll); };
  }, [replay.id, replay.status]);

  const stopped = replay.status === "failed" || (replay.status === "running" && isReplayStale(replay));
  if (stopped) return <section className="card replay-status failed" aria-live="polite">
    <span className="replay-tilde" aria-hidden="true">~</span>
    <div><p className="meta">Calculation stopped safely</p><h2>Your confirmation is preserved</h2><p>The background worker stopped before finishing. Only the calculation needs another attempt. Reference: <code>{replay.id}</code></p></div>
    <form action={retryReplay}><input type="hidden" name="replay_run_id" value={replay.id} /><SubmitButton idle="Retry calculation" pending="Restarting safely…" /></form>
  </section>;
  return <section className="card replay-status" aria-live="polite" aria-busy="true">
    <span className="replay-tilde filling" aria-hidden="true">~</span>
    <div><p className="meta">Recalculation running</p><h2>Recalculating later records in chronological order…</h2><p>{longRunning ? "Processing is continuing safely. You may leave this page and return later." : "Your evidence is confirmed. The timeline is being rebuilt in the background."}</p></div>
  </section>;
}
