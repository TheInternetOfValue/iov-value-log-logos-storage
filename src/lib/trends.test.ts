import { describe, expect, it } from "vitest";
import { buildInsightWeaveSeries, buildIntraDayWSeries, buildTrendSeries, deterministicInsightSummary, INSIGHT_NODE_ORDER, normalizeTrendRange, trendStartDate } from "./trends";

describe("becoming weave projection", () => {
  it("keeps five inner nodes in fixed order and Performance in its own final lane", () => {
    const weave = buildInsightWeaveSeries({
      endDate: "2026-07-08", rangeDays: 7,
      slices: [
        { id: "feeling", activity: "Quiet walk", wellbeing_node: "Feeling", start_at: "2026-07-08T08:00:00+05:30", end_at: "2026-07-08T09:00:00+05:30", timezone: "Asia/Kolkata", status: "calculated", slice_type: "non_performance", community: "house_of_bros" },
        { id: "performance", activity: "Synthetic research task", wellbeing_node: "Performance", sao_lane: "Learning", skill_level: "L2", start_at: "2026-07-08T10:00:00+05:30", end_at: "2026-07-08T11:30:00+05:30", timezone: "Asia/Kolkata", status: "calculated", slice_type: "performance", community: "iov" },
      ],
      wEvents: [{ id: "w", canonical_slice_id: "feeling", pre_slice_w: 800, post_slice_w: 800.02, applied_change: .02, canonical_slices: { id: "feeling", activity: "Quiet walk", wellbeing_node: "Feeling", start_at: "2026-07-08T08:00:00+05:30", end_at: "2026-07-08T09:00:00+05:30", timezone: "Asia/Kolkata", community: "house_of_bros" } }],
      creditEvents: [{ id: "credit", canonical_slice_id: "performance", formula_result: 120, canonical_slices: { id: "performance", activity: "Synthetic research task", wellbeing_node: "Performance", sao_lane: "Learning", skill_level: "L2", start_at: "2026-07-08T10:00:00+05:30", end_at: "2026-07-08T11:30:00+05:30", timezone: "Asia/Kolkata", community: "iov" } }],
    });
    expect(weave.lanes.map((lane) => lane.node)).toEqual(INSIGHT_NODE_ORDER);
    expect(weave.lanes.find((lane) => lane.node === "Feeling")).toMatchObject({ activity_count: 1, logged_minutes: 60, w_net: .02, credits: 0 });
    expect(weave.lanes.find((lane) => lane.node === "Performance")).toMatchObject({ activity_count: 1, logged_minutes: 90, w_net: 0, credits: 120 });
    expect(weave.lanes.find((lane) => lane.node === "Performance")?.stitches[0]).toMatchObject({ sao_lane: "Learning", skill_level: "L2" });
  });

  it("keeps overnight presence on its start date, settlement on its end date, and excludes reversed movement", () => {
    const relation = { id: "overnight", activity: "Overnight rest", wellbeing_node: "Physiology", start_at: "2026-07-01T23:00:00+05:30", end_at: "2026-07-02T06:00:00+05:30", timezone: "Asia/Kolkata", community: "house_of_bros" as const };
    const weave = buildInsightWeaveSeries({
      endDate: "2026-07-08", rangeDays: 7, slices: [],
      wEvents: [
        { id: "active", canonical_slice_id: "overnight", pre_slice_w: 800, post_slice_w: 800.1, applied_change: .1, canonical_slices: relation },
        { id: "reversed", canonical_slice_id: "overnight", pre_slice_w: 800.1, post_slice_w: 801, applied_change: .9, canonical_slices: relation },
      ],
      wReversalIds: ["reversed"], creditEvents: [],
    });
    const stitch = weave.lanes[0].stitches[0];
    expect(stitch).toMatchObject({ start_date: "2026-07-01", settlement_date: "2026-07-02", w_change: .1 });
    expect(weave.lanes[0]).toMatchObject({ activity_count: 0, logged_minutes: 0, w_net: .1 });
  });

  it("keeps negative, missing-W, Performance-only, and empty ranges truthful", () => {
    const relation = { id: "negative", activity: "Difficult hour", wellbeing_node: "Emotion", start_at: "2026-07-08T12:00:00+05:30", end_at: "2026-07-08T13:00:00+05:30", timezone: "Asia/Kolkata", community: "house_of_bros" as const };
    const performance = { id: "performance-only", activity: "Build a model", wellbeing_node: "Performance", start_at: "2026-07-08T14:00:00+05:30", end_at: "2026-07-08T15:00:00+05:30", timezone: "Asia/Kolkata", community: "iov" as const, sao_lane: "Learning", skill_level: "L3" };
    const weave = buildInsightWeaveSeries({
      endDate: "2026-07-08", rangeDays: 7,
      slices: [relation as never, performance as never],
      wEvents: [{ id: "negative-w", canonical_slice_id: relation.id, pre_slice_w: 800, post_slice_w: 799.98, applied_change: -.02, canonical_slices: relation }],
      creditEvents: [{ id: "performance-credit", canonical_slice_id: performance.id, formula_result: 240, canonical_slices: performance }],
    });
    expect(weave.lanes.find((lane) => lane.node === "Emotion")?.stitches[0]).toMatchObject({ w_change: -.02, credits: null });
    expect(weave.lanes.find((lane) => lane.node === "Performance")?.stitches[0]).toMatchObject({ w_change: null, credits: 240 });

    const empty = buildInsightWeaveSeries({ endDate: "2026-07-08", rangeDays: 7, slices: [], wEvents: [], creditEvents: [] });
    expect(empty.lanes).toHaveLength(6);
    expect(empty.lanes.every((lane) => lane.stitches.length === 0 && lane.activity_count === 0 && lane.w_net === 0 && lane.credits === 0)).toBe(true);
  });
});

describe("trend aggregation", () => {
  it("normalizes supported ranges and defaults to 7 days", () => {
    expect(normalizeTrendRange("14")).toBe(14);
    expect(normalizeTrendRange("30")).toBe(30);
    expect(normalizeTrendRange("90")).toBe(7);
    expect(trendStartDate("2026-07-08", 7)).toBe("2026-07-02");
  });

  it("groups activities by start date and W transitions by IST settlement date", () => {
    const series = buildTrendSeries({
      endDate: "2026-07-08",
      rangeDays: 7,
      slices: [
        {
          id: "slice-early-ist",
          start_at: "2026-07-05T00:15:00+05:30",
          end_at: "2026-07-05T00:45:00+05:30",
          timezone: "Asia/Kolkata",
          status: "calculated",
          slice_type: "non_performance",
          community: "house_of_bros",
        },
        {
          id: "slice-negative",
          start_at: "2026-07-05T20:00:00+05:30",
          end_at: "2026-07-05T21:00:00+05:30",
          timezone: "Asia/Kolkata",
          status: "calculated",
          slice_type: "non_performance",
          community: "house_of_bros",
        },
      ],
      wEvents: [
        {
          id: "w-positive",
          pre_slice_w: 843,
          post_slice_w: 843.025,
          applied_change: 0.025,
          canonical_slices: {
            start_at: "2026-07-05T00:15:00+05:30",
            end_at: "2026-07-05T00:45:00+05:30",
            timezone: "Asia/Kolkata",
            community: "house_of_bros",
          },
        },
        {
          id: "w-negative",
          pre_slice_w: 843.025,
          post_slice_w: 843.015,
          applied_change: -0.01,
          canonical_slices: {
            start_at: "2026-07-05T20:00:00+05:30",
            end_at: "2026-07-05T21:00:00+05:30",
            timezone: "Asia/Kolkata",
            community: "house_of_bros",
          },
        },
      ],
      creditEvents: [],
    });

    expect(series.rows).toHaveLength(7);
    expect(series.rows[0].date).toBe("2026-07-02");

    const july5 = series.rows.find((row) => row.date === "2026-07-05");
    expect(july5?.activity_count).toBe(2);
    expect(july5?.logged_minutes).toBe(90);
    expect(july5?.w_start).toBe(843);
    expect(july5?.w_end).toBe(843.015);
    expect(july5?.w_positive).toBeCloseTo(0.025);
    expect(july5?.w_negative).toBeCloseTo(-0.01);
    expect(july5?.w_net).toBeCloseTo(0.015);
    expect(july5?.house_of_bros_w_net).toBeCloseTo(0.015);

    const emptyDay = series.rows.find((row) => row.date === "2026-07-04");
    expect(emptyDay?.activity_count).toBe(0);
    expect(emptyDay?.w_net).toBe(0);
  });

  it("keeps HouseOfBros W and IoV/GFE credits separate and excludes reversals", () => {
    const series = buildTrendSeries({
      endDate: "2026-07-08",
      rangeDays: 7,
      slices: [
        {
          id: "iov-performance",
          start_at: "2026-07-06T22:00:00+05:30",
          end_at: "2026-07-06T23:30:00+05:30",
          timezone: "Asia/Kolkata",
          status: "calculated",
          slice_type: "performance",
          community: "iov",
        },
        {
          id: "pending",
          start_at: "2026-07-07T09:00:00+05:30",
          end_at: "2026-07-07T10:00:00+05:30",
          timezone: "Asia/Kolkata",
          status: "validation_pending",
          slice_type: "performance",
          community: "gfe",
        },
      ],
      wEvents: [
        {
          id: "reversed-w",
          pre_slice_w: 843,
          post_slice_w: 844,
          applied_change: 1,
          canonical_slices: {
            start_at: "2026-07-06T07:00:00+05:30",
            end_at: "2026-07-06T08:00:00+05:30",
            timezone: "Asia/Kolkata",
            community: "house_of_bros",
          },
        },
      ],
      wReversalIds: ["reversed-w"],
      creditEvents: [
        {
          id: "iov-credit",
          formula_result: 632.32,
          canonical_slices: {
            start_at: "2026-07-06T22:00:00+05:30",
            end_at: "2026-07-06T23:30:00+05:30",
            timezone: "Asia/Kolkata",
            community: "iov",
          },
        },
        {
          id: "reversed-credit",
          formula_result: 500,
          canonical_slices: {
            start_at: "2026-07-07T11:00:00+05:30",
            end_at: "2026-07-07T12:00:00+05:30",
            timezone: "Asia/Kolkata",
            community: "gfe",
          },
        },
      ],
      creditReversalIds: ["reversed-credit"],
    });

    expect(series.totals.w_net).toBe(0);
    expect(series.totals.iov_credits).toBeCloseTo(632.32);
    expect(series.totals.iov_minutes).toBe(90);
    expect(series.totals.gfe_credits).toBe(0);
    expect(series.totals.pending_count).toBe(1);
    expect(series.totals.needs_attention_count).toBe(1);
  });
});

describe("deterministic insight summary", () => {
  const series = buildTrendSeries({ endDate: "2026-07-08", rangeDays: 7, slices: [], wEvents: [], creditEvents: [] });
  it("uses explicit zero language", () => expect(deterministicInsightSummary(series)).toContain("No calculated Performance contribution"));
  it("omits Wellbeing movement when no completed W exists", () => expect(deterministicInsightSummary(series)).not.toContain("Wellbeing movement"));
  it("states zero and negative completed W without subjective wording", () => {
    const zero = { ...series, totals: { ...series.totals, w_start: 843, w_end: 843, w_net: 0 } };
    const negative = { ...series, totals: { ...series.totals, w_start: 843, w_end: 842.75, w_net: -0.25 } };
    expect(deterministicInsightSummary(zero)).toContain("Wellbeing movement was 0.0000 W");
    expect(deterministicInsightSummary(negative)).toContain("Wellbeing movement was -0.2500 W");
  });
  it("names the leading Performance Commons without causal language", () => {
    const withCredits = { ...series, totals: { ...series.totals, iov_credits: 100, gfe_credits: 20 } };
    expect(deterministicInsightSummary(withCredits)).toContain("routed to IoV: 100 credits");
  });
  it("handles ties explicitly", () => {
    const tied = { ...series, totals: { ...series.totals, iov_credits: 50, gfe_credits: 50 } };
    expect(deterministicInsightSummary(tied)).toContain("split evenly");
  });
});

describe("within-day W series", () => {
  it("plots the opening state and calculated transitions in activity-time order", () => {
    const series = buildIntraDayWSeries({
      date: "2026-07-05",
      wEvents: [
        {
          id: "later", pre_slice_w: 843.1, post_slice_w: 843.05, applied_change: -0.05,
          canonical_slices: { start_at: "2026-07-05T16:00:00+05:30", end_at: "2026-07-05T17:00:00+05:30", timezone: "Asia/Kolkata", community: "house_of_bros" },
        },
        {
          id: "earlier", pre_slice_w: 843, post_slice_w: 843.1, applied_change: 0.1,
          canonical_slices: { start_at: "2026-07-05T08:00:00+05:30", end_at: "2026-07-05T09:00:00+05:30", timezone: "Asia/Kolkata", community: "house_of_bros" },
        },
        {
          id: "reversed", pre_slice_w: 843.05, post_slice_w: 900, applied_change: 56.95,
          canonical_slices: { start_at: "2026-07-05T18:00:00+05:30", end_at: "2026-07-05T19:00:00+05:30", timezone: "Asia/Kolkata", community: "house_of_bros" },
        },
      ],
      wReversalIds: ["reversed"],
    });

    expect(series.opening_w).toBe(843);
    expect(series.closing_w).toBe(843.05);
    expect(series.positive_w).toBeCloseTo(0.1);
    expect(series.negative_w).toBeCloseTo(-0.05);
    expect(series.points.map((point) => point.value)).toEqual([843, 843.1, 843.05]);
    expect(series.projection.openingW).toBe(843);
    expect(series.projection.netW).toBe("0.050000000000");
    expect(series.projection.events.map((item) => item.id)).toEqual(["earlier", "later"]);
  });

  it("moves an overnight W settlement to the day it ended and keeps x-values chronological", () => {
    const overnight = {
      id: "overnight",
      pre_slice_w: 845.6,
      post_slice_w: 845.844,
      applied_change: 0.244,
      canonical_slices: { start_at: "2026-07-16T19:45:00+05:30", end_at: "2026-07-17T06:30:00+05:30", timezone: "Asia/Kolkata", community: "house_of_bros" as const },
    };
    const series = buildTrendSeries({
      endDate: "2026-07-17", rangeDays: 7, slices: [], wEvents: [overnight], creditEvents: [],
    });
    expect(series.rows.find((row) => row.date === "2026-07-16")?.w_start).toBeNull();
    expect(series.rows.find((row) => row.date === "2026-07-17")?.w_net).toBeCloseTo(0.244);

    const july16 = buildIntraDayWSeries({ date: "2026-07-16", wEvents: [overnight] });
    const july17 = buildIntraDayWSeries({ date: "2026-07-17", wEvents: [overnight] });
    expect(july16.points).toEqual([]);
    expect(july17.points.map((point) => point.timestamp)).toEqual(["2026-07-17T06:30:00+05:30", "2026-07-17T06:30:00+05:30"]);
  });
});
