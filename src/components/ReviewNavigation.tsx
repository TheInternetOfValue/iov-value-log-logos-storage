import { PrimaryNav } from "@/components/PrimaryNav";
import { isConfigured } from "@/lib/env";
import { reviewDecisionSummary, type ReviewDecisionDraft, type ReviewDecisionSlice } from "@/lib/review-decisions";
import { isReplayStale } from "@/lib/replay-runtime";
import { memberSession } from "@/lib/members/session";
import { findTimelineOverlaps } from "@/lib/timeline-integrity";

export async function ReviewNavigation() {
  if (!isConfigured()) return <PrimaryNav />;

  let attention = { reviewBlocked: false, reviewCount: 0, reviewUnavailable: false };
  let session;
  try { session = await memberSession(); } catch { session = null; }
  if (!session) return <PrimaryNav reviewUnavailable />;
  if (session.kind === "personal") return <PrimaryNav personal />;
  try {
    const { client } = session;
    const [pendingResult, draftsResult, timelineResult, replayResult] = await Promise.all([
      client.from("canonical_slices").select("id,start_at,end_at,timezone,community,wellbeing_node").eq("status", "validation_pending"),
      client.from("draft_slices").select("id,start_at,timezone").eq("status", "drafted"),
      client.from("canonical_slices").select("id,start_at,end_at,community,status").order("start_at"),
      client.from("replay_runs").select("status,heartbeat_at,started_at,from_timestamp").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (pendingResult.error || draftsResult.error || timelineResult.error || replayResult.error) {
      attention.reviewUnavailable = true;
    } else {
      const pending = pendingResult.data;
      const drafts = draftsResult.data;
      const timeline = timelineResult.data;
      const replay = replayResult.data;
      const hasRetryBlocker = replay?.status === "failed" || (replay?.status === "running" && isReplayStale(replay));
      const summary = reviewDecisionSummary({
        pending: (pending ?? []) as ReviewDecisionSlice[],
        drafts: (drafts ?? []) as ReviewDecisionDraft[],
        hasConflict: findTimelineOverlaps(timeline ?? []).length > 0,
        hasRetryBlocker,
      });
      attention = { reviewBlocked: summary.navBlocked, reviewCount: summary.navCount, reviewUnavailable: false };
    }
  } catch {
    attention.reviewUnavailable = true;
  }
  return <PrimaryNav {...attention} />;
}
