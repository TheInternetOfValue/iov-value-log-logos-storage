// Pure presentation rules for the multi-screen logging flow. No I/O.
import { activityInstants, type NativeActivity, type NativeDraft } from "@/lib/native-log/draft";
import type { NativeReceipt } from "@/lib/native-log/storage-core";

export type FlowScreen = "start" | "recording" | "processing" | "failed" | "check" | "done";
export type FailureKind =
  | "offline" | "speech_service" | "no_words" | "partial_capture" | "table_step" | "no_activities"
  | "allowance" | "signin" | "paused" | "unknown";
export type Failure = { kind: FailureKind; stage: "sending" | "table" | "submit"; part?: { failed: number; total: number }; message?: string };

export function flowScreen(state: {
  receipt: NativeReceipt | null; capturing: boolean; busy: boolean; failure: Failure | null;
  activities: number; transcript: boolean;
}): FlowScreen {
  if (state.receipt) return "done";
  if (state.capturing) return "recording";
  if (state.busy) return "processing";
  if (state.failure && state.failure.stage !== "submit") return "failed";
  if (state.activities) return "check";
  if (state.transcript) return "failed";
  return "start";
}

/** Classify an error by its server code, HTTP status or network failure. The person always sees the real cause. */
export function failureFrom(error: unknown, stage: Failure["stage"], online = true): Failure {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : 0;
  const message = error instanceof Error ? error.message : undefined;
  // A request that hit its own deadline: a lost connection while sending, the table step otherwise.
  const timedOut = typeof error === "object" && error !== null && "name" in error && (error as { name: unknown }).name === "TimeoutError";
  const kind: FailureKind =
    !online || error instanceof TypeError || code === "NETWORK_TIMEOUT" || (timedOut && stage === "sending") ? "offline"
    : status === 401 || status === 403 ? "signin"
    : code === "PROVIDER_ALLOWANCE" ? "allowance"
    : code === "WRITING_PAUSED" ? "paused"
    : code === "NO_TRANSCRIBED_WORDS" ? "no_words"
    : code === "INCOMPLETE_RECORDING" || code === "CAPTURE_REVIEW_REQUIRED" ? "partial_capture"
    : ["PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE"].includes(code) && stage === "sending" ? "speech_service"
    : ["PROVIDER_RESPONSE", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "OMISSION_REVIEW_REQUIRED", "COVERAGE_CHECK_STALE"].includes(code) || timedOut ? "table_step"
    : "unknown";
  return { kind, stage, ...(message ? { message } : {}) };
}

export function failureCopy(failure: Failure) {
  const part = failure.part ? `part ${failure.part.failed} of ${failure.part.total}` : "your recording";
  const sent = failure.part && failure.part.failed > 1 ? ` ${plural(failure.part.failed - 1, "part was", "parts were")} sent.` : "";
  switch (failure.kind) {
    case "offline": return { heading: "Your recording didn’t send", reason: `This phone lost its internet connection while sending ${part}.${sent}`, retry: "Retry sends what’s left, then carries on." };
    case "speech_service": return { heading: "Your recording didn’t send", reason: `Sarvam’s speech service didn’t answer while we were sending ${part}.${sent}`, retry: "Retry resends from the part that failed." };
    case "no_words": return { heading: "We couldn’t hear any words", reason: "We couldn’t find any words in this recording. The microphone may have been muted.", retry: "Record again, or retry to listen once more." };
    case "partial_capture": return { heading: "Part of your recording is missing", reason: "Not every part of this recording arrived. Your words so far are saved.", retry: "Retry sends the missing part, or use only the words that arrived." };
    case "table_step": return { heading: "Your table isn’t ready", reason: "We wrote down your words but couldn’t build the table.", retry: "Retry runs only this step. Your words are kept." };
    case "no_activities": return { heading: "No finished activities yet", reason: "We wrote down your words but didn’t find anything that has already happened. Plans for later aren’t logged.", retry: "Type what you did and roughly when. Your words so far are kept." };
    case "allowance": return { heading: "Voice processing is paused for today", reason: "Today’s voice-processing allowance is used.", retry: "Your words are saved. Come back later, or type your day." };
    case "signin": return { heading: "Please sign in again", reason: "Your sign-in expired while we were working.", retry: "Sign in in another tab, then retry here. Nothing is lost." };
    case "paused": return { heading: "Logging is paused", reason: "Saving is temporarily paused for everyone.", retry: "Your saved drafts remain available." };
    default: return { heading: "Something went wrong", reason: failure.message ?? "Value Log couldn’t finish this step.", retry: "Retry, or close for now — nothing is lost." };
  }
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const hasTime = (activity: NativeActivity, timezone: string) => {
  const { start, end } = activityInstants(activity, timezone);
  return Boolean(start && end);
};
export function missingTimes(draft: NativeDraft) {
  return draft.activities.filter((activity) => !hasTime(activity, draft.timezone));
}

const rough = (activity: NativeActivity) => activity.timePrecision === "approximate" || activity.timePrecision === "period_inferred" || Boolean(activity.timeNote);
const twelve = (local: string) => {
  const hour = Number(local.slice(11, 13)), minute = local.slice(14, 16);
  return { text: `${hour % 12 || 12}:${minute}`, half: hour < 12 ? "am" : "pm" };
};
/** "7:00–7:45 am", "10:00 am–1:00 pm", "~8:30 am", or null when no clock was stated. */
export function timeText(activity: NativeActivity) {
  if (!activity.startLocal) return null;
  const start = twelve(activity.startLocal), end = activity.endLocal ? twelve(activity.endLocal) : null;
  const range = !end ? `${start.text} ${start.half}`
    : start.half === end.half ? `${start.text}–${end.text} ${end.half}` : `${start.text} ${start.half}–${end.text} ${end.half}`;
  return `${rough(activity) ? "~" : ""}${range}`;
}
/** Plain words for the receipt: "around 8:30 am" rather than a symbol. */
export function spokenTimeText(activity: NativeActivity) {
  const text = timeText(activity);
  return text ? text.replace(/^~/, "around ") : activity.timeLabel ?? null;
}

export function checkSummary(draft: NativeDraft) {
  const total = draft.activities.length, missing = missingTimes(draft).length;
  return `${plural(total, "activity", "activities")} · ${missing ? `${missing} ${missing === 1 ? "needs" : "need"} a time` : "all have a time"}`;
}

export type DoneSummary = { heading: string; line: string; href: string; hrefLabel: string; highlight: string };
/** Truthful receipt: it says where this log actually went. */
export function doneSummary(receipt: NativeReceipt, draft: NativeDraft, draftId: string): DoneSummary {
  const date = receipt.dates[0] ?? draft.date;
  const saved = plural(receipt.count, "activity saved", "activities saved");
  if (receipt.dayIndexVersion === 1 || receipt.kind === "cohort_review_pending" && receipt.sourceReferenced) {
    const timed = draft.activities.length - missingTimes(draft).length, notes = receipt.count - Math.min(timed, receipt.count);
    const parts = [saved, timed ? `${Math.min(timed, receipt.count)} on your day` : "", notes ? plural(notes, "untimed note", "untimed notes") : ""].filter(Boolean);
    return { heading: "Saved to your day", line: parts.join(" · "), href: `/day?date=${date}&added=${draftId}`, hrefLabel: "See my day", highlight: "New activities are highlighted on your day." };
  }
  if (receipt.kind === "capture_review_pending")
    return { heading: "Saved — waiting in Insights", line: `${saved} · times or details still needed`, href: "/review", hrefLabel: "Open Insights", highlight: "Add the missing details in Insights whenever you’re ready." };
  if (receipt.kind === "validation_pending")
    return { heading: "Saved for review", line: `${saved} · awaiting confirmation`, href: "/review", hrefLabel: "Open Insights", highlight: "Confirmation comes before calculation." };
  return { heading: "Saved to your private log", line: `${saved} · private and unassessed`, href: `/day?date=${date}`, hrefLabel: "See my day", highlight: "Your activities are private and unassessed." };
}

/** Recollection cues while speaking: place, next step, people, time, then feeling. Never evaluative. */
export const RECORDING_PROMPTS = ["Then what?", "Where did you go next?", "Roughly what time was that?", "Who were you with?", "How did it leave you feeling?"];

export function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function speechLength(seconds: number) {
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return minutes ? `${minutes} min${rest ? ` ${rest} s` : ""}` : `${rest} s`;
}
export function longDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
