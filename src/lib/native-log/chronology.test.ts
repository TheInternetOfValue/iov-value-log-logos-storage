import { expect, it } from "vitest";
import {
  emptyNativeActivity,
  newNativeDraft,
  canSubmitCapture,
  canReviewDraft,
} from "./draft";
import { groundedLocalTime } from "./grounding";
import { reconcileNarrativeTimes, activityTimeSource } from "./chronology";
const quotes = [
  "after uh 7:15, 7:30 I met friends. Then we walked around a farm and exercised, came back around 8:30.",
  "and talked to my neighbour till like 9:30",
  "then had breakfast till 10:30",
  "then attended the daily standup, and that just got over. And now it's 11:30 a.m.",
];
const draft = () => ({
  ...newNativeDraft("a".repeat(64), "2026-10-26", "Asia/Kolkata", "pilot"),
  transcript: quotes.join(" "),
  activities: quotes.map((sourceQuote, i) => ({
    ...emptyNativeActivity(
      `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    ),
    activity: ["Walk and exercise", "Conversation", "Breakfast", "Standup"][i],
    sourceQuote,
    node: "Physiology" as const,
  })),
});
it("recognises bare spoken clock digits instead of clearing already supplied times", () => {
  expect(
    groundedLocalTime("2026-10-26T07:30", quotes[0], "2026-10-26", false),
  ).toBe("2026-10-26T07:30");
  expect(
    groundedLocalTime("2026-10-26T08:30", quotes[0], "2026-10-26", false),
  ).toBe("2026-10-26T08:30");
});
it("recovers a complete morning chronology, keeps approximations visible and does not invent effects", () => {
  const d = draft(),
    next = reconcileNarrativeTimes(d);
  expect(
    next.activities.map((a) => [a.startLocal.slice(11), a.endLocal.slice(11)]),
  ).toEqual([
    ["07:30", "08:30"],
    ["08:30", "09:30"],
    ["09:30", "10:30"],
    ["10:30", "11:30"],
  ]);
  expect(next.activities[0].timeNote).toContain("7:15–7:30");
  expect(next.activities[1].timeNote).toContain("previous activity");
  expect(
    next.activities.every(
      (a) => a.direction === "" && a.intensity === "" && a.confidence === "",
    ),
  ).toBe(true);
  expect(next.reviewedRevision).toBeNull();
  expect(d.activities[0].startLocal).toBe("");
  expect(reconcileNarrativeTimes(next)).toBe(next);
  const correction = {
    ...next,
    activities: next.activities.map((a, i) =>
      i ? a : { ...a, endLocal: "2026-10-26T09:00" },
    ),
  };
  expect(reconcileNarrativeTimes(correction).activities[1].startLocal).toBe(
    "2026-10-26T09:00",
  );
  expect(canSubmitCapture(next, new Date("2026-10-26T10:00:00Z"))).toBe(true);
  expect(canReviewDraft(next, new Date("2026-10-26T10:00:00Z"))).toBe(false);
});
it("does not fill unknown times, periods, manual answers, or explicitly mentioned gaps", () => {
  const d = draft();
  d.transcript = quotes.slice(0, 2).join(" ");
  d.activities = d.activities.slice(0, 2);
  expect(reconcileNarrativeTimes(d).activities[0].endLocal).toBe(""); // No morning anchor.
  const explicit = draft();
  explicit.activities[0].startLocal = "2026-10-26T07:00";
  explicit.activities[0].manualFields = ["startLocal"];
  expect(reconcileNarrativeTimes(explicit).activities[0].startLocal).toBe(
    "2026-10-26T07:00",
  );
  const gap = draft();
  gap.transcript = gap.transcript.replace(
    quotes[1],
    "After a break, " + quotes[1],
  );
  gap.activities[1].sourceQuote = "After a break, " + quotes[1];
  expect(reconcileNarrativeTimes(gap).activities[1].startLocal).toBe("");
});
it("grounds an adjoining stated boundary but does not use a distant unrelated time", () => {
  const source = "I finished at 8:30. Then had breakfast until 9:00.";
  expect(
    activityTimeSource(source, "Then had breakfast until 9:00."),
  ).toContain("finished at 8:30");
  const unrelated = "At 8:30 a meeting was planned. Much later I walked.";
  expect(activityTimeSource(unrelated, "I walked.")).not.toContain("8:30");
});
