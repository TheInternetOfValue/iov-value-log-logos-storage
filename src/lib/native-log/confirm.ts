import "server-only";
import { randomUUID } from "node:crypto";
import { draftSliceInputSchema } from "@/lib/domain";
import { MOSES_CANONICAL_DID } from "@/lib/identity";
import { encryptNarrative } from "@/lib/crypto";
import { adminClient } from "@/lib/supabase/admin";
import { entrySchema } from "@/lib/members/entries";
import { assertTimelineIntegrity } from "@/lib/timeline-integrity";
import { canReviewDraft, activityInstants, type NativeDraft } from "./draft";
import { wallTime, sleepSegments } from "./time";
import type { NativeReceipt, NativeSession } from "./server";

export async function prepareNativeConfirmation(session: NativeSession, document: NativeDraft, now = new Date()) {
  if (document.mode !== session.kind || !canReviewDraft(document, now)) throw new Error("REVIEW_REQUIRED");
  const db = adminClient(), entries: Array<Record<string, unknown>> = [], dates = new Set<string>();
  for (const activity of document.activities) {
    const { start, end } = activityInstants(activity, document.timezone);
    if (!start || !end) throw new Error("TIME_REQUIRES_REVIEW");
    const segments = sleepSegments(start, end, document.timezone, activity.sleepRest);
    for (const [index, segment] of segments.entries()) {
      const date = wallTime(Date.parse(segment.start), document.timezone).slice(0, 10);
      dates.add(date);
      const episode = segments.length > 1 ? `Segment ${index + 1} of ${segments.length} of one reported sleep/rest episode.` : "";
      const id = randomUUID();
      if (session.kind === "personal") {
        const duration = (Date.parse(segment.end) - Date.parse(segment.start)) / 60000;
        const text = [activity.activity, `${wallTime(Date.parse(segment.start), document.timezone)} — ${wallTime(Date.parse(segment.end), document.timezone)} (${document.timezone})`, activity.context, activity.proof, episode].filter(Boolean).join("\n");
        const checked = entrySchema.safeParse({ id, revision: 0, date, node: activity.node, text, minutes: Number.isInteger(duration) && duration >= 1 && duration <= 1440 ? duration : null });
        if (!checked.success) throw new Error("INVALID_INPUT");
        entries.push({ id, date, node: activity.node, content: encryptNarrative(JSON.stringify({ date, node: activity.node, text, minutes: checked.data.minutes })) });
      } else {
        const performance = activity.node === "Performance";
        let nativeLevel: string | undefined;
        if (performance) {
          const resolution = await db.rpc("resolve_founder_flat_community_rate", { p_subject_did: MOSES_CANONICAL_DID, p_community: activity.community, p_route: activity.lane, p_occurrence_start_at: segment.start, p_system_time: now.toISOString() });
          const value = resolution.data?.[0];
          if (resolution.error || !value?.native_level || value.protocol_finality_status !== "final") throw new Error("RECOGNITION_REQUIRED");
          nativeLevel = value.native_level;
        }
        const proof = [activity.context, activity.proof, activity.timeNote, episode].filter(Boolean).join("\n");
        const checked = draftSliceInputSchema.safeParse({
          start_at: segment.start, end_at: segment.end, timezone: document.timezone, activity: activity.activity, proof: proof || undefined,
          wellbeing_node: activity.node, slice_type: performance ? "performance" : "non_performance", community: performance ? activity.community : "house_of_bros",
          ...(performance ? { sao_lane: activity.lane, native_skill_level: nativeLevel } : { impact_direction: activity.direction, impact_intensity: activity.intensity, confidence: activity.confidence }),
          activity_occurrence_id: activity.id,
        });
        if (!checked.success) throw new Error("REVIEW_REQUIRED");
        entries.push({ ...checked.data, id, draft_id: randomUUID(), protocol_link_id: randomUUID() });
      }
    }
  }
  if (!entries.length || entries.length > 30) throw new Error("TOO_MANY_RECORDS");
  if (session.kind === "pilot") {
    try { await assertTimelineIntegrity(db, session.user.id, entries.map(entry => ({ id: String(entry.id), start_at: String(entry.start_at), end_at: String(entry.end_at), community: String(entry.community) }))); }
    catch (error) { throw new Error(error instanceof Error && error.message.startsWith("timeline_overlap:") ? "NATIVE_TIMELINE_OVERLAP" : "UNAVAILABLE"); }
  }
  const receipt: NativeReceipt = { kind: session.kind === "pilot" ? "validation_pending" : "unassessed", count: entries.length, ids: entries.map(entry => String(entry.id)), dates: [...dates].sort(), timezone: document.timezone };
  return { entries, receipt, narrative: encryptNarrative(document.transcript) };
}
