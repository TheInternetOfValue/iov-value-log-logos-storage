import { wellbeingNodes } from "@/lib/members/nodes";
import { resolveWallTime, timeCandidates, sleepSegments } from "./time";
import type { DraftSliceInput } from "@/lib/domain";

export const MANUAL_ACTIVITY_FIELDS = [
  "activity",
  "startLocal",
  "endLocal",
  "startOffset",
  "endOffset",
  "node",
  "context",
  "proof",
  "sleepRest",
  "community",
  "lane",
  "direction",
  "intensity",
  "confidence",
] as const;
export type ManualActivityField = (typeof MANUAL_ACTIVITY_FIELDS)[number];
export type NativeActivity = {
  id: string;
  activity: string;
  startLocal: string;
  endLocal: string;
  startOffset: string;
  endOffset: string;
  node: (typeof wellbeingNodes)[number] | "";
  context: string;
  proof: string;
  sourceQuote: string;
  timeNote?: string;
  /** How precisely the person stated the time; absent on older drafts. */
  timePrecision?: import("./vague-time").TimePrecision;
  /** The person's own time words for an untimed row ("after lunch", "in the afternoon"). */
  timeLabel?: string;
  startFromReply?: boolean;
  inheritedStartFrom?: string;
  sleepRest: boolean;
  community: string;
  lane: NonNullable<DraftSliceInput["sao_lane"]> | "";
  direction: NonNullable<DraftSliceInput["impact_direction"]> | "";
  intensity: NonNullable<DraftSliceInput["impact_intensity"]> | "";
  confidence: NonNullable<DraftSliceInput["confidence"]> | "";
  manualFields?: ManualActivityField[];
  sourceReplyIds?: string[];
};
export type NativeDraft = {
  version: 1;
  ownerScope: string;
  mode: "pilot" | "personal";
  date: string;
  timezone: string;
  transcript: string;
  activities: NativeActivity[];
  revision: number;
  reviewedRevision: number | null;
  conversation?: Array<{ id: string; activityId: string | null; text: string }>;
  cohort?: {
    policyId: string;
    houseId: string;
    houseName?: string;
    workCommunities: Array<{ id: string; name: string }>;
  };
  correctsRecordId?: string;
  reviewQuestion?: string;
  supersedesDraftId?: string;
  processedReplyId?: string;
  adoptsDraftId?: string;
  continuesSourceId?: string;
};
export type DraftQuestion = {
  key: string;
  activityId: string;
  field:
    | "activity"
    | "time"
    | "node"
    | "context"
    | "route"
    | "effect"
    | "overlap"
    | "proof"
    | "count";
  title: string;
  detail: string;
};
export function newNativeDraft(
  ownerScope: string,
  date: string,
  timezone: string,
  mode: NativeDraft["mode"],
): NativeDraft {
  return {
    version: 1,
    ownerScope,
    mode,
    date,
    timezone,
    transcript: "",
    activities: [],
    revision: 0,
    reviewedRevision: null,
  };
}
export function emptyNativeActivity(id: string): NativeActivity {
  return {
    id,
    activity: "",
    startLocal: "",
    endLocal: "",
    startOffset: "",
    endOffset: "",
    node: "",
    context: "",
    proof: "",
    sourceQuote: "",
    sleepRest: false,
    community: "",
    lane: "",
    direction: "",
    intensity: "",
    confidence: "",
  };
}
export function changeDraft(
  draft: NativeDraft,
  changes: Partial<Pick<NativeDraft, "transcript" | "activities" | "date">>,
): NativeDraft {
  return {
    ...draft,
    ...changes,
    revision: draft.revision + 1,
    reviewedRevision: null,
  };
}
export function activityInstants(item: NativeActivity, timezone: string) {
  return {
    start: resolveWallTime(item.startLocal, timezone, item.startOffset),
    end: resolveWallTime(item.endLocal, timezone, item.endOffset),
  };
}
export function draftQuestions(
  draft: NativeDraft,
  now = new Date(),
): DraftQuestion[] {
  const questions: DraftQuestion[] = [];
  let recordCount = 0;
  for (const [index, item] of draft.activities.entries()) {
    const name = item.activity.trim() || `Activity ${index + 1}`;
    const add = (
      field: DraftQuestion["field"],
      title: string,
      detail: string,
    ) =>
      questions.push({
        key: `${item.id}:${field}`,
        activityId: item.id,
        field,
        title,
        detail,
      });
    if (!item.activity.trim())
      add(
        "activity",
        "What did you do?",
        "Use your own words for this activity.",
      );
    const { start, end } = activityInstants(item, draft.timezone);
    if (!start || !end) {
      const ambiguous =
        timeCandidates(item.startLocal, draft.timezone).length > 1 ||
        timeCandidates(item.endLocal, draft.timezone).length > 1;
      add(
        "time",
        start && !end
          ? `What time did ${name} finish?`
          : end && !start
            ? `What time did ${name} start?`
            : `When did ${name} happen?`,
        ambiguous
          ? "The clock changes around this time. Choose the correct UTC offset for each repeated time."
          : `Use ${draft.timezone}; include morning or evening when needed. The times already supplied are kept.`,
      );
    } else if (end <= start)
      add(
        "time",
        `Check the times for ${name}.`,
        "The finish must be after the start. For an overnight activity, choose the following date.",
      );
    else if (Date.parse(end) > now.getTime())
      add(
        "time",
        `Has ${name} finished?`,
        "Log completed activities. Keep future intentions in your plan.",
      );
    else if (Date.parse(end) - Date.parse(start) > 31 * 86400000)
      add(
        "time",
        `Check the dates for ${name}.`,
        "Use a separate log for each part of an activity spanning more than a month.",
      );
    if (
      start &&
      end &&
      end > start &&
      Date.parse(end) - Date.parse(start) <= 31 * 86400000
    ) {
      try {
        recordCount += sleepSegments(
          start,
          end,
          draft.timezone,
          item.sleepRest,
        ).length;
      } catch {
        add(
          "time",
          `Check the dates for ${name}.`,
          "Choose a shorter interval or review the timezone at midnight.",
        );
      }
    }
    if (
      draft.mode === "pilot" &&
      [
        item.context,
        item.proof,
        item.sleepRest
          ? "Segment 30 of 30 of one reported sleep/rest episode."
          : "",
      ]
        .filter(Boolean)
        .join("\n").length > 2000
    )
      add(
        "proof",
        `Shorten the supporting notes for ${name}.`,
        "Keep the combined context and evidence under 1,950 characters so the complete record fits.",
      );
    if (!item.node)
      add(
        "node",
        `What was the main purpose of ${name}?`,
        "Describe it in your words. We will propose a primary Wellbecoming node for you to check.",
      );
    if (item.node === "Performance" && !item.context.trim())
      add(
        "context",
        `What was the context for ${name}?`,
        "Name the project, work or community involved.",
      );
    if (
      draft.mode === "pilot" &&
      item.node === "Performance" &&
      (!["iov", "gfe"].includes(item.community) || !item.lane)
    )
      add(
        "route",
        `Which community and route fit ${name}?`,
        "Choose the work's community and Learning, Earning or OrgBuilding route. Recognition is checked from existing sources when you confirm.",
      );
    if (
      draft.mode === "pilot" &&
      item.node &&
      item.node !== "Performance" &&
      (!item.direction || !item.intensity || !item.confidence)
    )
      add(
        "effect",
        `What did you notice during ${name}?`,
        "Check the reported direction, intensity and confidence. This observation still needs community-role review.",
      );
    if (
      draft.cohort &&
      item.node === "Performance" &&
      (!item.lane ||
        !draft.cohort.workCommunities.some((c) => c.id === item.community))
    )
      add(
        "route",
        `Which project or community was ${name} for?`,
        "Describe the work and whether you were learning, earning or building the organisation.",
      );
    if (
      draft.cohort &&
      (!item.direction ||
        (item.direction !== "neutral" && !item.intensity) ||
        item.confidence !== "observed")
    )
      add(
        "effect",
        `What effect did ${name} have on you?`,
        "Describe what you directly noticed, including how strong it felt. It is fine to report no change.",
      );
  }
  if (recordCount > 30 && draft.activities[0])
    questions.push({
      key: "record-count",
      activityId: draft.activities[0].id,
      field: "count",
      title: "Keep up to thirty records in one log.",
      detail:
        "Sleep across midnight creates a record for each date. Return to all activities and remove some activities; save them in another log.",
    });
  const timed = draft.activities
    .map((item) => ({ ...item, ...activityInstants(item, draft.timezone) }))
    .filter((item) => item.start && item.end && item.end > item.start)
    .toSorted((a, b) => a.start!.localeCompare(b.start!));
  for (let index = 0; index < timed.length; index++) {
    for (
      let other = index + 1;
      other < timed.length && timed[other].start! < timed[index].end!;
      other++
    )
      questions.push({
        key: `${timed[index].id}:${timed[other].id}:overlap`,
        activityId: timed[other].id,
        field: "overlap",
        title: "Two activities overlap.",
        detail: `Check “${timed[index].activity || "Activity"}” and “${timed[other].activity || "Activity"}”. Keep one account of the same time.`,
      });
  }
  return questions;
}
export function canReviewDraft(draft: NativeDraft, now = new Date()) {
  return Boolean(
    draft.transcript.trim() &&
      draft.activities.length &&
      draftQuestions(draft, now).length === 0,
  );
}
/** Missing assessment facts may go to Review; invalid known intervals cannot be approved. */
export function captureQuestions(draft: NativeDraft, now = new Date()) {
  return draftQuestions(draft, now).filter((q) => {
    if (["activity", "overlap", "count", "proof"].includes(q.field))
      return true;
    if (q.field !== "time") return false;
    const a = draft.activities.find((a) => a.id === q.activityId);
    return (
      Boolean(a?.startLocal && a.endLocal) ||
      Boolean(
        a?.endLocal &&
          activityInstants(a, draft.timezone).end &&
          Date.parse(activityInstants(a, draft.timezone).end!) > now.getTime(),
      )
    );
  });
}
export function canSubmitCapture(draft: NativeDraft, now = new Date()) {
  return Boolean(
    draft.transcript.trim() &&
      draft.activities.length &&
      !captureQuestions(draft, now).length,
  );
}
/** Empty embedded recorders must never intercept navigation. Audio is volatile even beside saved writing. */
export function hasUnsavedNativeContent(
  draft: NativeDraft,
  savedRevision: number,
  volatileAudio: boolean,
) {
  return (
    volatileAudio ||
    Boolean(
      (draft.transcript.trim() ||
        draft.activities.length ||
        draft.conversation?.length) &&
        draft.revision !== savedRevision,
    )
  );
}
