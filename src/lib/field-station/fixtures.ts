/** Fictional accounts and narratives only. Never seed these into a live policy. */
import type { CohortActivity, ReviewedActivity } from "@/lib/cohort/policy";

export const QA_POLICY = "field-station-oct26-28-qa-v1";
export const DAY = "2026-10-26";
export const BOUNDARY = "2026-10-25T18:30:00.000Z";
export const WINDOW_END = "2026-10-28T18:30:00.000Z";
export const NOW = "2026-10-27T12:00:00.000Z";
export const fixtureId = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const accounts = {
  brosA: { owner: fixtureId(1), did: `did:iov:member:${fixtureId(1)}`, house: "house_of_bros", admittedAt: BOUNDARY },
  brosB: { owner: fixtureId(2), did: `did:iov:member:${fixtureId(2)}`, house: "house_of_bros", admittedAt: "2026-10-26T12:00:00.000Z" },
  sis: { owner: fixtureId(3), did: `did:iov:member:${fixtureId(3)}`, house: "house_of_sis", admittedAt: "2026-10-27T12:00:00.000Z" },
  outside: { owner: fixtureId(4), did: `did:iov:member:${fixtureId(4)}`, house: null, admittedAt: WINDOW_END },
  founder: { owner: fixtureId(5), did: `did:iov:member:${fixtureId(5)}`, house: null, admittedAt: "2026-01-01T00:00:00.000Z", founder: true },
} as const;

export function activity(n = 1, patch: Partial<CohortActivity> = {}): CohortActivity {
  return {
    id: fixtureId(100 + n), occurrenceId: fixtureId(200 + n),
    start: `${DAY}T07:30:00+05:30`, end: `${DAY}T08:30:00+05:30`,
    activity: "Walked around the fictional farm", node: "Physiology",
    quote: "I started at 7:15—actually 7:30; returned at 8:30. It had a small positive physical effect.",
    context: "Synthetic acceptance scenario", proof: "Participant-reported",
    workCommunity: null, lane: null, direction: "positive", intensity: "low",
    confidence: "observed", sleepRest: false, ...patch,
  };
}
export const reviewed = (item = activity()): ReviewedActivity => ({
  recordId: fixtureId(301), reviewId: fixtureId(401), activity: item, rate: null,
});
export const completeDay = [
  activity(1, { activity: "Sleep", quote: "I slept from 10pm on October 25 to 6am on October 26 and noticed no change.", start: "2026-10-25T22:00:00+05:30", end: `${DAY}T06:00:00+05:30`, sleepRest: true, direction: "neutral", intensity: null }),
  activity(2),
  activity(3, { activity: "Breakfast", quote: "I ate breakfast from 9am to 9:30am and noticed no change.", start: `${DAY}T09:00:00+05:30`, end: `${DAY}T09:30:00+05:30`, direction: "neutral", intensity: null }),
  activity(4, { activity: "Worked on a fictional website", quote: "I worked on a paid fictional website project from 10am to noon.", start: `${DAY}T10:00:00+05:30`, end: `${DAY}T12:00:00+05:30`, node: "Performance", direction: null, intensity: null, confidence: null }),
  activity(5, { activity: "Talked with a friend", quote: "I talked with a friend about my emotions from 6pm to 7pm. I did not report an effect.", start: `${DAY}T18:00:00+05:30`, end: `${DAY}T19:00:00+05:30`, node: "Emotion", direction: null, intensity: null, confidence: null }),
  activity(6, { activity: "Sleep", quote: "I slept from 10pm on October 26 to 6am on October 27 and noticed no change.", start: `${DAY}T22:00:00+05:30`, end: "2026-10-27T06:00:00+05:30", sleepRest: true, direction: "neutral", intensity: null }),
];
export const longCorrection = "This is a synthetic follow-up preserving my earlier activities. ".repeat(200) + "The walk ended at 8:30, and I explicitly report no physical effect.";
export const longNarration = Array.from({ length: 18 }, (_, i) => `At ${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"} I began synthetic activity ${i + 1}; it ended thirty minutes later. No effect was supplied.`).join(" ");
export const expected = {
  initialComponents: { Physiology: 700, Emotion: 700, Feeling: 700, Thought: 700, Habit: 700, Performance: 700 },
  initialScore: 700, positiveLowPhysiologyScore: 700.007, correctedNeutralScore: 700,
  completeDayOccurrences: 6, workOccurrences: 1, missingEffectOccurrences: 1,
  // A gap is intentionally present between breakfast and work, and after work.
  inventedGapOccurrences: 0, narratedActivities: 18,
} as const;
