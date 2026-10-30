import { afterEach, expect, it, vi } from "vitest";
import {
  checkedCoverage,
  assertNarrationCoverage,
  narrationCoverageStatus,
} from "@/lib/native-log/coverage";
import { newNativeDraft, emptyNativeActivity } from "@/lib/native-log/draft";
import { fixtureId } from "./fixtures";
import { nativeDocumentSchema } from "@/lib/native-log/schema";
afterEach(() => vi.unstubAllEnvs());
function scenario() {
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-coverage-key-more-than-thirty-two-characters",
  );
  const words = [
    "I walked from seven thirty to eight thirty.",
    "I ate breakfast from nine to nine thirty.",
    "I worked on a fictional website from ten to twelve.",
  ];
  const activities = words.map((sourceQuote, index) => ({
    ...emptyNativeActivity(fixtureId(index + 1)),
    activity: ["Walk", "Breakfast", "Website work"][index],
    node: index === 2 ? ("Performance" as const) : ("Physiology" as const),
    sourceQuote,
  }));
  const draft = {
    ...newNativeDraft("a".repeat(64), "2026-10-26", "Asia/Kolkata", "personal"),
    transcript: words.join(" "),
    activities,
  };
  const actions = words.map((quote, index) => ({
    quote,
    summary: activities[index].activity,
    node: activities[index].node,
    kind: "activity" as const,
    activityId: activities[index].id,
  }));
  return { draft, actions };
}
it("U15: an independent source inventory detects a multi-activity narration collapsed into one row", () => {
  const { draft, actions } = scenario();
  const proof = checkedCoverage(
    {
      actions: actions.map((a) => ({
        ...a,
        activityId: draft.activities[0].id,
      })),
    },
    { ...draft, activities: [draft.activities[0]] },
  );
  expect(proof.complete).toBe(false);
  expect(proof.missing).toBeGreaterThan(0);
  expect(checkedCoverage({ actions }, draft).complete).toBe(true);
});
it("U15/U16: source-supported coverage is bound to the exact words and rows; stale approval cannot reuse it", () => {
  const { draft, actions } = scenario();
  vi.stubEnv("VALUE_LOG_OMISSION_CHECK", "open");
  const proof = checkedCoverage({ actions }, draft);
  expect(() => assertNarrationCoverage(draft, proof)).not.toThrow();
  expect(() =>
    assertNarrationCoverage(
      { ...draft, transcript: draft.transcript + " This is a correction." },
      proof,
    ),
  ).toThrow("OMISSION_REVIEW_REQUIRED");
  expect(() =>
    assertNarrationCoverage(
      { ...draft, activities: draft.activities.slice(0, 1) },
      proof,
    ),
  ).toThrow("OMISSION_REVIEW_REQUIRED");
  expect(() =>
    checkedCoverage(
      { actions: [{ ...actions[0], quote: "Invented source" }] },
      draft,
    ),
  ).toThrow("PROVIDER_RESPONSE");
});

it("U15: separately timed activities require independent anchors; episode details cannot cover a whole table", () => {
  const { draft, actions } = scenario();
  const proof = checkedCoverage(
    { actions: actions.map((a) => ({ ...a, kind: "episode_detail" })) },
    draft,
  );
  expect(proof.complete).toBe(false);
  expect(proof.diagnostics?.orphanedDetail).toBe(3);
});

it("keeps the same completeness proof after schema storage reorders optional correction fields", () => {
  const { draft, actions } = scenario();
  vi.stubEnv("VALUE_LOG_OMISSION_CHECK", "open");
  const reply = fixtureId(20);
  const corrected = {
    ...draft,
    conversation: [{ id: reply, text: "The walk finished at 8:45. Keep the website work unchanged.", activityId: null }],
    activities: draft.activities.map((a, i) => i ? a : {
      ...a, sourceReplyIds: [reply], timeNote: "Times were reported approximately.", manualFields: ["endLocal" as const],
    }),
  };
  const proof = checkedCoverage({ actions }, corrected);
  const restored = nativeDocumentSchema.parse(JSON.parse(JSON.stringify(corrected)));
  expect(restored).toEqual(corrected);
  expect(() => assertNarrationCoverage(restored, proof)).not.toThrow();
});

it("distinguishes an outdated check from an actually incomplete table without accepting either", () => {
  const { draft, actions } = scenario();
  vi.stubEnv("VALUE_LOG_OMISSION_CHECK", "open");
  const proof = checkedCoverage({ actions }, draft);
  expect(narrationCoverageStatus(draft, undefined)).toBe("missing");
  expect(narrationCoverageStatus(draft, { ...proof, complete: false })).toBe("incomplete");
  expect(narrationCoverageStatus({ ...draft, transcript: draft.transcript + " New words." }, proof)).toBe("changed");
  expect(() => assertNarrationCoverage(draft, { ...proof, complete: false })).toThrow("OMISSION_REVIEW_REQUIRED");
  expect(narrationCoverageStatus(draft, proof)).toBe("complete");
});
