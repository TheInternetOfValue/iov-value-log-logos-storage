import { describe, expect, it } from "vitest";
import { futureSliceCount, newestReviewSessionsFirst, sessionReviewLens } from "@/lib/review";

const now = Date.parse("2026-07-14T08:00:00+05:30");

describe("sessionReviewLens", () => {
  it("keeps a past session addressed from Previous Leon to Now Lan", () => {
    expect(sessionReviewLens([{ start_at: "2026-07-14T01:00:00+05:30" }], now)).toBe("previous-to-now");
  });

  it("addresses a fully future-dated session from Now Lan to Tom Me", () => {
    expect(sessionReviewLens([{ start_at: "2026-07-14T10:00:00+05:30" }], now)).toBe("now-to-tom");
  });

  it("keeps a mixed session factual while counting future items", () => {
    const slices = [
      { start_at: "2026-07-14T01:00:00+05:30" },
      { start_at: "2026-07-14T10:00:00+05:30" },
    ];
    expect(sessionReviewLens(slices, now)).toBe("mixed");
    expect(futureSliceCount(slices, now)).toBe(1);
  });
});

describe("newestReviewSessionsFirst", () => {
  it("reads session history like an inbox while leaving each session intact", () => {
    const sessions = [
      { id: "old", received_at: "2026-07-03T10:00:00Z", draft_slices: [{ start_at: "2026-07-03T07:30:00+05:30" }] },
      { id: "new", received_at: "2026-07-15T18:00:00Z", draft_slices: [{ start_at: "2026-07-15T20:00:00+05:30" }] },
    ];

    expect(newestReviewSessionsFirst(sessions).map((session) => session.id)).toEqual(["new", "old"]);
    expect(sessions.map((session) => session.id)).toEqual(["old", "new"]);
  });

  it("uses received time to order sessions on the same activity date", () => {
    const sessions = [
      { id: "first", received_at: "2026-07-15T10:00:00Z", draft_slices: [{ start_at: "2026-07-15T08:00:00+05:30" }] },
      { id: "second", received_at: "2026-07-15T11:00:00Z", draft_slices: [{ start_at: "2026-07-15T08:00:00+05:30" }] },
    ];

    expect(newestReviewSessionsFirst(sessions).map((session) => session.id)).toEqual(["second", "first"]);
  });
});
