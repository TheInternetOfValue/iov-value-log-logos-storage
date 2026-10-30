import { describe, expect, it } from "vitest";
import { analysisWindows, buildValueLogAnalysis, validateProductionBinding, type AnalysisInput } from "./value-log-analysis";
import { renderValueLogAnalysis } from "./value-log-analysis-format";
import { buildValueLogAnalysisQuery } from "./value-log-analysis-query";

const verified = { canonical_did_count: 1, member_count: 1 };

function fixture(): AnalysisInput {
  return {
    schema_version: "value-log-analysis-input-v1",
    verification: verified,
    slices: [
      { id: "prior", start_at: "2026-07-19T10:00:00+05:30", end_at: "2026-07-19T11:00:00+05:30", timezone: "Asia/Kolkata", status: "calculated", activity: "Synthetic prior work", wellbeing_node: "Performance", community: "iov", sao_lane: "Learning", skill_level: "L2" },
      { id: "overnight", start_at: "2026-07-19T23:00:00+05:30", end_at: "2026-07-20T06:00:00+05:30", timezone: "Asia/Kolkata", status: "calculated", activity: "Synthetic overnight rest", wellbeing_node: "Physiology", community: "house_of_bros" },
      { id: "week-positive", start_at: "2026-07-20T08:00:00+05:30", end_at: "2026-07-20T09:30:00+05:30", timezone: "Asia/Kolkata", status: "calculated", activity: "Synthetic focused work", wellbeing_node: "Performance", community: "gfe", sao_lane: "Earning", skill_level: "L3" },
      { id: "week-negative", start_at: "2026-07-21T18:00:00+05:30", end_at: "2026-07-21T19:00:00+05:30", timezone: "Asia/Kolkata", status: "calculated", activity: "Synthetic difficult hour", wellbeing_node: "Emotion", community: "house_of_bros" },
      { id: "pending", start_at: "2026-07-22T10:00:00+05:30", end_at: "2026-07-22T11:00:00+05:30", timezone: "Asia/Kolkata", status: "validation_pending", activity: "Synthetic pending work", wellbeing_node: "Performance", community: "iov" },
    ],
    w_events: [
      { id: "overnight-w", canonical_slice_id: "overnight", pre_slice_w: "800", post_slice_w: "800.1", applied_change: "0.1", cap_limited: false, start_at: "2026-07-19T23:00:00+05:30", end_at: "2026-07-20T06:00:00+05:30", timezone: "Asia/Kolkata", activity: "Synthetic overnight rest", wellbeing_node: "Physiology", community: "house_of_bros" },
      { id: "negative-w", canonical_slice_id: "week-negative", pre_slice_w: 800.1, post_slice_w: 800.05, applied_change: -0.05, cap_limited: true, start_at: "2026-07-21T18:00:00+05:30", end_at: "2026-07-21T19:00:00+05:30", timezone: "Asia/Kolkata", activity: "Synthetic difficult hour", wellbeing_node: "Emotion", community: "house_of_bros" },
    ],
    credit_events: [
      { id: "prior-credit", canonical_slice_id: "prior", formula_result: 100, start_at: "2026-07-19T10:00:00+05:30", end_at: "2026-07-19T11:00:00+05:30", timezone: "Asia/Kolkata", activity: "Synthetic prior work", wellbeing_node: "Performance", community: "iov", sao_lane: "Learning", skill_level: "L2" },
      { id: "week-credit", canonical_slice_id: "week-positive", formula_result: "450", start_at: "2026-07-20T08:00:00+05:30", end_at: "2026-07-20T09:30:00+05:30", timezone: "Asia/Kolkata", activity: "Synthetic focused work", wellbeing_node: "Performance", community: "gfe", sao_lane: "Earning", skill_level: "L3" },
    ],
  };
}

describe("analysis windows", () => {
  it("uses inclusive IST calendar windows at month start and month end", () => {
    expect(analysisWindows("2026-07-26")).toMatchObject({
      week: { start_date: "2026-07-20", end_date: "2026-07-26", day_count: 7 },
      previous_week: { start_date: "2026-07-13", end_date: "2026-07-19", day_count: 7 },
      month: { start_date: "2026-07-01", end_date: "2026-07-26", day_count: 26 },
    });
    expect(analysisWindows("2026-07-01")).toMatchObject({ month: { start_date: "2026-07-01", end_date: "2026-07-01", day_count: 1 } });
  });

  it("rejects invalid dates", () => expect(() => analysisWindows("2026-02-31")).toThrow("Invalid --as-of date"));
});

describe("read-only extraction", () => {
  const query = buildValueLogAnalysisQuery("2026-07-26");
  it("starts a read-only transaction and never contains mutation commands", () => {
    expect(query).toContain("begin transaction read only");
    expect(query).not.toMatch(/\b(insert|update|delete|truncate|drop|alter)\b/i);
  });
  it("selects latest active canonical revisions and excludes reversals and incomplete replay runs", () => {
    expect(query).toContain("distinct on (protocol_link_id)");
    expect(query).toContain("status not in ('reversed', 'superseded')");
    expect(query).toContain("rr.status = 'completed'");
    expect(query).toContain("reversal.reversal_of = w.id");
    expect(query).toContain("reversal.reversal_of = c.id");
    expect(query).toContain("public.member_identity_bindings");
  });
});

describe("private Value Log analysis", () => {
  it("fails closed when the linked project does not match the canonical single-member binding", () => {
    expect(() => validateProductionBinding({ ...fixture(), verification: { canonical_did_count: 0, member_count: 1 } })).toThrow("analysis stopped");
  });

  it("attributes activity to start date, W to settlement date, and excludes pending work from totals", () => {
    const analysis = buildValueLogAnalysis(fixture(), "2026-07-26", "2026-07-26T12:00:00Z");
    expect(analysis.periods.week.activity).toMatchObject({ count: 2, minutes: 150 });
    expect(analysis.periods.week.pilot_w).toMatchObject({ start: 800, end: 800.05, net: 0.05, positive_days: 1, negative_days: 1, cap_limited_events: 1 });
    expect(analysis.periods.week.performance).toMatchObject({ total_credits: 450 });
    expect(analysis.periods.week.data_quality).toEqual({ non_calculated_slices: 1, status_counts: { validation_pending: 1 } });
    expect(analysis.periods.week.drilldown.some((row) => row.reason === "longest_recorded_time" && row.slice_id === "overnight")).toBe(false);
    expect(analysis.periods.previous_week.activity.count).toBe(2);
    expect(analysis.periods.previous_week.pilot_w.start).toBeNull();
  });

  it("keeps Pilot W, Performance credits, and recorded time as separate report fields", () => {
    const analysis = buildValueLogAnalysis(fixture(), "2026-07-26");
    expect(analysis.periods.week).toHaveProperty("pilot_w.net", 0.05);
    expect(analysis.periods.week).toHaveProperty("performance.total_credits", 450);
    expect(analysis.periods.week).toHaveProperty("activity.minutes", 150);
    expect(analysis).not.toHaveProperty("score");
    expect(renderValueLogAnalysis(analysis)).toContain("These measures remain separate");
    expect(renderValueLogAnalysis(analysis)).toContain("20 Jul 2026");
  });

  it("keeps zero-data periods explicit", () => {
    const empty = buildValueLogAnalysis({ ...fixture(), slices: [], w_events: [], credit_events: [] }, "2026-07-26");
    expect(empty.periods.week.activity.count).toBe(0);
    expect(empty.periods.week.pilot_w.start).toBeNull();
    expect(empty.periods.week.performance.total_credits).toBe(0);
    expect(empty.periods.week.coverage.missing_dates).toHaveLength(7);
  });
});
