import { randomUUID } from "node:crypto";
import { encryptNarrative } from "@/lib/crypto";
import { activityInstants, canSubmitCapture, type NativeDraft } from "@/lib/native-log/draft";
import { nativeOwnerScope, type NativeReceipt } from "@/lib/native-log/storage-core";
import { cohortActivitySchema } from "@/lib/cohort/policy";
import { datedActivityOutcome, DATED_BOUNDARY, isDatedPolicy } from "./dated-policy";
import { wallTime } from "@/lib/native-log/time";

export function prepareDayApproval(owner: string, draftId: string, draft: NativeDraft, policy: string | null) {
  if (draft.mode !== "personal" || draft.ownerScope !== nativeOwnerScope(owner)) throw new Error("ACCOUNT_CHANGED");
  if (!canSubmitCapture(draft)) throw new Error("REVIEW_REQUIRED");
  if (policy && !isDatedPolicy(policy)) throw new Error("UNKNOWN_POLICY");
  const dates = new Set<string>();
  const entries = draft.activities.map(a => {
    const instants = activityInstants(a, draft.timezone), id = randomUUID();
    // An incomplete interval is an untimed note. Never infer a missing clock.
    const start = instants.start && instants.end ? instants.start : null;
    const end = start ? instants.end : null;
    if (start && end) {
      const first = wallTime(Date.parse(start), "Asia/Kolkata").slice(0, 10), last = wallTime(Date.parse(end) - 1, "Asia/Kolkata").slice(0, 10);
      dates.add(first); dates.add(last);
    } else dates.add(draft.date);
    const activity = start && end && a.node ? cohortActivitySchema.parse({ id, occurrenceId: a.id, start, end, activity: a.activity, node: a.node, quote: a.sourceQuote, context: a.context, proof: [a.proof, a.timeNote].filter(Boolean).join("\n"), workCommunity: null, lane: null, direction: a.direction || null, intensity: a.direction === "neutral" ? null : a.intensity || null, confidence: a.confidence || null, sleepRest: a.sleepRest, sourceReference: { draftId, documentRevision: draft.revision, replyIds: a.sourceReplyIds ?? (draft.conversation ?? []).filter(reply => !reply.activityId || reply.activityId === a.id).map(reply => reply.id) }, manualFields: a.manualFields }) : null;
    const outcome = !policy || a.node === "Performance" || start && Date.parse(start) < Date.parse(DATED_BOUNDARY) ? "unassessed" : activity ? datedActivityOutcome(activity) : "clarification";
    return { id, occurrenceId: a.id, start, end, date: draft.date, node: a.node, outcome, content: activity ? encryptNarrative(JSON.stringify(activity)) : null };
  });
  const hasReview = entries.some(e => e.outcome !== "unassessed" && e.start && e.node);
  const receipt: NativeReceipt = { kind: hasReview ? "cohort_review_pending" : entries.some(e => e.outcome === "clarification") ? "capture_review_pending" : "unassessed", sourceReferenced: hasReview, dayIndexVersion: 1, count: entries.length, ids: entries.map(e => e.id), dates: [...dates].sort(), timezone: "Asia/Kolkata" };
  return { entries, receipt };
}
