import { describe, expect, it } from "vitest";
import { buildIdentityReplay } from "./identity-replay";

const overnightSlice = {
  id: "overnight-slice", start_at: "2026-07-16T23:00:00+05:30", end_at: "2026-07-17T01:00:00+05:30", timezone: "Asia/Kolkata",
  activity: "Overnight bus", wellbeing_node: "Feeling", slice_type: "non_performance", community: "house_of_bros" as const,
};

describe("IdentityReplay", () => {
  it("uses settlement time, retains the midnight opening state, and excludes reversals", () => {
    const replay = buildIdentityReplay({
      date: "2026-07-17",
      wEvents: [
        { id: "later", canonical_slice_id: "later-slice", pre_slice_w: 845.7, post_slice_w: 845.8, applied_change: 0.1, canonical_slices: { ...overnightSlice, id: "later-slice", start_at: "2026-07-17T08:00:00+05:30", end_at: "2026-07-17T09:00:00+05:30" } },
        { id: "overnight", canonical_slice_id: "overnight-slice", pre_slice_w: 845.6, post_slice_w: 845.7, applied_change: 0.1, canonical_slices: overnightSlice },
        { id: "reversed", canonical_slice_id: "reversed-slice", pre_slice_w: 845.8, post_slice_w: 999, applied_change: 153.2, canonical_slices: { ...overnightSlice, id: "reversed-slice", start_at: "2026-07-17T11:00:00+05:30", end_at: "2026-07-17T12:00:00+05:30" } },
      ],
      wReversalIds: ["reversed"], creditEvents: [],
    });
    expect(replay.opening_w).toBe(845.6);
    expect(replay.closing_w).toBe(845.8);
    expect(replay.transitions.map((item) => item.id)).toEqual(["overnight", "later"]);
    expect(replay.transitions[0].begins_at).toContain("2026-07-16");
    expect(replay.transitions[0].settles_at).toContain("2026-07-17");
  });

  it("attaches Performance only to its source slice and never to W", () => {
    const replay = buildIdentityReplay({
      date: "2026-07-17",
      wEvents: [{ id: "w", canonical_slice_id: "performance-slice", pre_slice_w: 845.6, post_slice_w: 845.6, applied_change: 0, canonical_slices: { ...overnightSlice, id: "performance-slice", slice_type: "performance", community: "iov" } }],
      creditEvents: [
        { id: "credit", canonical_slice_id: "performance-slice", formula_result: 507, canonical_slices: { ...overnightSlice, id: "performance-slice", slice_type: "performance", community: "iov" } },
        { id: "reversed-credit", canonical_slice_id: "performance-slice", formula_result: 100, canonical_slices: { ...overnightSlice, id: "performance-slice", slice_type: "performance", community: "iov" } },
      ],
      creditReversalIds: ["reversed-credit"],
    });
    expect(replay.transitions[0].applied_w).toBe(0);
    expect(replay.transitions[0].performance).toEqual({ credits: 507, community: "iov" });
    expect(replay.contribution_totals).toEqual({ iov: 507, gfe: 0 });
  });

  it("has no opening state when no completed W transition settled that day", () => {
    const replay = buildIdentityReplay({ date: "2026-07-17", wEvents: [], creditEvents: [] });
    expect(replay.opening_w).toBeNull();
    expect(replay.transitions).toEqual([]);
  });

  it("keeps a credits-only Performance slice in settlement order without changing W", () => {
    const performanceSlice = { ...overnightSlice, id: "performance-only", start_at: "2026-07-17T15:30:00+05:30", end_at: "2026-07-17T18:30:00+05:30", activity: "Reworked product UX", slice_type: "performance", community: "iov" as const };
    const replay = buildIdentityReplay({
      date: "2026-07-17",
      wEvents: [{ id: "morning-w", canonical_slice_id: "morning", pre_slice_w: 845.6, post_slice_w: 845.7, applied_change: .1, canonical_slices: { ...overnightSlice, id: "morning", start_at: "2026-07-17T08:00:00+05:30", end_at: "2026-07-17T09:00:00+05:30" } }],
      creditEvents: [{ id: "performance-credit", canonical_slice_id: "performance-only", formula_result: 1015, canonical_slices: performanceSlice }],
    });
    expect(replay.transitions.map((item) => item.kind)).toEqual(["wellbeing", "performance"]);
    expect(replay.transitions[1]).toMatchObject({ canonical_slice_id: "performance-only", applied_w: null, resulting_w: 845.7, performance: { credits: 1015, community: "iov" } });
  });

  it("offers a contribution replay for a Performance-only day", () => {
    const replay = buildIdentityReplay({ date: "2026-07-17", wEvents: [], creditEvents: [{ id: "credit-only", canonical_slice_id: "performance-only", formula_result: 507, canonical_slices: { ...overnightSlice, id: "performance-only", slice_type: "performance", community: "iov" } }] });
    expect(replay.opening_w).toBeNull();
    expect(replay.transitions).toHaveLength(1);
    expect(replay.transitions[0]).toMatchObject({ kind: "performance", resulting_w: null });
  });
});
