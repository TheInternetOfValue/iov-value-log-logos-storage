import { describe, expect, it } from "vitest";
import { reviewDecisionSummary, type ReviewDecisionSlice } from "@/lib/review-decisions";

const now = new Date("2026-07-17T12:00:00+05:30").getTime();
const slice = (id: string, date: string, community: "house_of_bros" | "iov" | "gfe", node: "Feeling" | "Performance" = community === "house_of_bros" ? "Feeling" : "Performance"): ReviewDecisionSlice => ({
  id, start_at: `${date}T09:00:00+05:30`, end_at: `${date}T10:00:00+05:30`, timezone: "Asia/Kolkata", community, wellbeing_node: node,
});

describe("review decision summary", () => {
  it("counts authority/date batches rather than records", () => {
    const summary = reviewDecisionSummary({ pending: [slice("a", "2026-07-15", "house_of_bros"), slice("b", "2026-07-15", "house_of_bros"), slice("c", "2026-07-15", "iov")], now });
    expect(summary.approvalBatchCount).toBe(2);
    expect(summary.approvalRecordCount).toBe(3);
    expect(summary.availableBatches).toHaveLength(2);
    expect(summary.navCount).toBe(2);
  });

  it("counts later dates while keeping only the oldest date available", () => {
    const summary = reviewDecisionSummary({ pending: [slice("a", "2026-07-15", "iov"), slice("b", "2026-07-16", "iov")], now });
    expect(summary.availableBatches.map((batch) => batch.date)).toEqual(["2026-07-15"]);
    expect(summary.queuedBatches.map((batch) => batch.date)).toEqual(["2026-07-16"]);
    expect(summary.navCount).toBe(2);
  });

  it("excludes future records and counts legacy decisions", () => {
    const summary = reviewDecisionSummary({
      pending: [slice("past", "2026-07-16", "iov"), slice("future", "2026-07-18", "gfe")],
      drafts: [{ id: "draft", start_at: "2026-07-15T09:00:00+05:30", timezone: "Asia/Kolkata" }],
      now,
    });
    expect(summary.approvalRecordCount).toBe(1);
    expect(summary.legacyDecisionCount).toBe(1);
    expect(summary.oldestEligibleDate).toBe("2026-07-15");
    expect(summary.availableBatches).toHaveLength(0);
    expect(summary.navCount).toBe(2);
  });

  it("makes conflicts and retry failures blocker indicators", () => {
    expect(reviewDecisionSummary({ pending: [slice("a", "2026-07-15", "iov")], hasConflict: true, now })).toMatchObject({ navBlocked: true, availableBatches: [], blockedBatches: [{ date: "2026-07-15" }], queuedBatches: [] });
    expect(reviewDecisionSummary({ pending: [], hasRetryBlocker: true, now })).toMatchObject({ navBlocked: true, navCount: 0 });
  });

  it("has a quiet empty state", () => expect(reviewDecisionSummary({ pending: [], now })).toMatchObject({ navCount: 0, navBlocked: false, approvalBatchCount: 0 }));
});
