import { describe, expect, it } from "vitest";
import {
  activityInstants,
  canReviewDraft,
  changeDraft,
  draftQuestions,
  emptyNativeActivity,
  newNativeDraft,
} from "./draft";
import {
  resolveWallTime,
  sleepSegments,
  timeCandidates,
  wallTime,
} from "./time";
const now = new Date("2026-10-25T18:00:00Z");
const activity = () => ({
  ...emptyNativeActivity("11111111-1111-4111-8111-111111111111"),
  activity: "Walked",
  startLocal: "2026-10-24T08:00",
  endLocal: "2026-10-24T08:30",
  node: "Physiology" as const,
});
const draft = () => ({
  ...newNativeDraft("a".repeat(64), "2026-10-24", "Asia/Kolkata", "personal"),
  transcript: "I walked from 8am to 8:30am",
  activities: [activity()],
});
describe("native timeline review", () => {
  it("accepts completed personal activities without conferring assessment", () => {
    expect(canReviewDraft(draft(), now)).toBe(true);
    expect(activityInstants(activity(), "Asia/Kolkata").start).toBe(
      "2026-10-24T02:30:00.000Z",
    );
  });
  it("requires missing times and rejects future, backwards and overlapping activities", () => {
    const d = draft();
    d.activities[0].startLocal = "";
    expect(draftQuestions(d, now).map((q) => q.field)).toContain("time");
    d.activities[0] = { ...activity(), endLocal: "2026-10-26T08:30" };
    expect(canReviewDraft(d, now)).toBe(false);
    d.activities = [{ ...activity(), startLocal: "2026-10-24T09:00" }];
    expect(canReviewDraft(d, now)).toBe(false);
    d.activities = [
      activity(),
      {
        ...activity(),
        id: "22222222-2222-4222-8222-222222222222",
        startLocal: "2026-10-24T08:15",
      },
    ];
    expect(draftQuestions(d, now).some((q) => q.field === "overlap")).toBe(
      true,
    );
    d.activities[1].startLocal = "2026-10-24T08:30";
    d.activities[1].endLocal = "2026-10-24T09:00";
    expect(canReviewDraft(d, now)).toBe(true);
  });
  it("asks pilot effects and performance recognition context, never personal community membership", () => {
    const d = { ...draft(), mode: "pilot" as const };
    expect(draftQuestions(d, now).map((q) => q.field)).toContain("effect");
    d.activities[0] = { ...activity(), node: "Performance" } as never;
    expect(draftQuestions(d, now).map((q) => q.field)).toEqual(
      expect.arrayContaining(["context", "route"]),
    );
  });
  it("invalidates review on every edit and caps expanded record count", () => {
    const d = draft();
    d.reviewedRevision = 2;
    expect(
      changeDraft(d, { transcript: "Changed" }).reviewedRevision,
    ).toBeNull();
    d.activities = Array.from({ length: 16 }, (_, i) => ({
      ...activity(),
      id: String(i),
      startLocal: "2026-10-23T23:00",
      endLocal: "2026-10-24T01:00",
      sleepRest: true,
    }));
    expect(draftQuestions(d, now).some((q) => q.field === "count")).toBe(true);
  });
});
describe("local times and explicit sleep episodes", () => {
  it("asks for an offset during repeated clocks and rejects nonexistent local times", () => {
    expect(
      timeCandidates("2026-11-01T01:30", "America/New_York").map(
        (t) => t.offset,
      ),
    ).toEqual(["-04:00", "-05:00"]);
    expect(resolveWallTime("2026-11-01T01:30", "America/New_York")).toBeNull();
    expect(
      resolveWallTime("2026-11-01T01:30", "America/New_York", "-05:00"),
    ).toBe("2026-11-01T06:30:00.000Z");
    expect(timeCandidates("2026-03-08T02:30", "America/New_York")).toEqual([]);
    expect(timeCandidates("2026-02-30T12:00", "Asia/Kolkata")).toEqual([]);
  });
  it("splits only explicit sleep at local midnight, never a generic overnight activity", () => {
    const start = resolveWallTime("2026-10-23T23:00", "Asia/Kolkata")!,
      end = resolveWallTime("2026-10-24T07:00", "Asia/Kolkata")!;
    const split = sleepSegments(start, end, "Asia/Kolkata", true);
    expect(split).toHaveLength(2);
    expect(wallTime(Date.parse(split[0].end), "Asia/Kolkata")).toBe(
      "2026-10-24T00:00",
    );
    expect(sleepSegments(start, end, "Asia/Kolkata", false)).toEqual([
      { start, end },
    ]);
  });
});

it("does not trap an empty embedded recorder but protects actual unsaved writing and volatile audio", async () => {
  const { hasUnsavedNativeContent, newNativeDraft } = await import("./draft");
  const empty = newNativeDraft(
    "a".repeat(64),
    "2026-10-26",
    "Asia/Kolkata",
    "personal",
  );
  expect(hasUnsavedNativeContent(empty, -1, false)).toBe(false);
  expect(hasUnsavedNativeContent({ ...empty, revision: 2 }, -1, false)).toBe(
    false,
  );
  const words = { ...empty, transcript: "Synthetic words", revision: 1 };
  expect(hasUnsavedNativeContent(words, 0, false)).toBe(true);
  expect(hasUnsavedNativeContent(words, 1, false)).toBe(false);
  expect(hasUnsavedNativeContent(empty, 0, true)).toBe(true);
  expect(hasUnsavedNativeContent(words, 1, true)).toBe(true);
  expect(
    hasUnsavedNativeContent(
      {
        ...empty,
        revision: 1,
        conversation: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            activityId: null,
            text: "Synthetic reply",
          },
        ],
      },
      0,
      false,
    ),
  ).toBe(true);
});
