import { describe, expect, it } from "vitest";
import { buildWeeklyReviewEvidence, expectedWeeklyPlanDates, weeklyReviewInputSchema, weeklyReviewPacketForGpt, weeklyReviewWindows, type WeeklySlice } from "./weekly-review";

const calculated = (overrides: Partial<WeeklySlice> = {}): WeeklySlice => ({
  id: "slice-1", protocol_link_id: "link-1", revision_number: 1,
  start_at: "2026-07-27T04:30:00.000Z", end_at: "2026-07-27T05:30:00.000Z", timezone: "Asia/Kolkata",
  status: "calculated", activity: "Synthetic focus block", proof: "Synthetic artifact",
  wellbeing_node: "Performance", community: "iov", sao_lane: "OrgBuilding", skill_level: "L2",
  ...overrides,
});

describe("Sunday weekly review windows", () => {
  it("covers the completed Monday-Saturday IST week and prior comparison", () => {
    expect(weeklyReviewWindows(new Date("2026-08-02T01:30:00.000Z"))).toEqual({
      week_start: "2026-07-27", week_end: "2026-08-01",
      previous_start: "2026-07-20", previous_end: "2026-07-25",
      next_monday: "2026-08-03", next_friday: "2026-08-07",
      query_start: "2026-07-20", query_end_exclusive: "2026-08-02",
    });
    expect(expectedWeeklyPlanDates("2026-08-01")).toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]);
  });

  it("uses IST rather than the UTC calendar date", () => {
    expect(weeklyReviewWindows(new Date("2026-08-01T19:00:00.000Z")).week_end).toBe("2026-08-01");
  });
});

describe("weekly review evidence", () => {
  const windows = weeklyReviewWindows(new Date("2026-08-02T01:30:00.000Z"));

  it("attributes an overnight Saturday activity to its start date and W to actual Sunday settlement", () => {
    const slice = calculated({ id: "overnight", protocol_link_id: "overnight-link", start_at: "2026-08-01T17:30:00.000Z", end_at: "2026-08-01T19:30:00.000Z" });
    const evidence = buildWeeklyReviewEvidence({ slices: [slice], w_events: [{ id: "w-1", canonical_slice_id: slice.id, pre_slice_w: 500, post_slice_w: 501, applied_change: 1, cap_limited: false, event_kind: "calculation", end_at: slice.end_at, replay_status: "completed" }], credit_events: [], campaign_outcomes: [] }, windows);
    expect(evidence.periods.current.summary.recorded_minutes).toBe(120);
    expect(evidence.periods.current.days.at(-1)?.activities[0]?.id).toBe("overnight");
    expect(evidence.periods.current.summary.pilot_w.net).toBe(0);
  });

  it("excludes superseded revisions, reversals, and incomplete replay calculations", () => {
    const old = calculated({ id: "old", protocol_link_id: "same", revision_number: 1 });
    const replacement = calculated({ id: "replacement", protocol_link_id: "same", revision_number: 2, activity: "Corrected synthetic block" });
    const pending = calculated({ id: "pending", protocol_link_id: "pending", status: "validation_pending", start_at: "2026-07-28T04:30:00.000Z", end_at: "2026-07-28T05:00:00.000Z" });
    const evidence = buildWeeklyReviewEvidence({
      slices: [old, replacement, pending],
      w_events: [
        { id: "w-active", canonical_slice_id: replacement.id, pre_slice_w: 500, post_slice_w: 502, applied_change: 2, cap_limited: true, event_kind: "calculation", end_at: replacement.end_at, replay_status: "completed" },
        { id: "w-reversal", canonical_slice_id: replacement.id, pre_slice_w: 502, post_slice_w: 500, applied_change: -2, cap_limited: false, event_kind: "reversal", reversal_of: "w-active", end_at: replacement.end_at, replay_status: "completed" },
        { id: "w-running", canonical_slice_id: replacement.id, pre_slice_w: 500, post_slice_w: 510, applied_change: 10, cap_limited: false, event_kind: "calculation", end_at: replacement.end_at, replay_status: "running" },
      ],
      credit_events: [
        { id: "credit-active", canonical_slice_id: replacement.id, formula_result: 4, event_kind: "calculation", start_at: replacement.start_at, community: "iov", sao_lane: "OrgBuilding", replay_status: "completed" },
        { id: "credit-reversal", canonical_slice_id: replacement.id, formula_result: -4, event_kind: "reversal", reversal_of: "credit-active", start_at: replacement.start_at, community: "iov", sao_lane: "OrgBuilding", replay_status: "completed" },
      ],
      campaign_outcomes: [],
    }, windows);
    expect(evidence.periods.current.summary.activity_count).toBe(1);
    expect(evidence.periods.current.days[0].activities.map((activity) => activity.id)).toEqual(["replacement"]);
    expect(evidence.periods.current.summary.pending_statuses).toEqual({ validation_pending: 1 });
    expect(evidence.periods.current.summary.pilot_w.net).toBe(0);
    expect(evidence.periods.current.summary.performance_credits).toBe(0);
  });

  it("keeps activity, W, credits, and campaign outcomes separate and handles zero-data comparison", () => {
    const slice = calculated();
    const evidence = buildWeeklyReviewEvidence({
      slices: [slice],
      w_events: [{ id: "w", canonical_slice_id: slice.id, pre_slice_w: 500, post_slice_w: 501, applied_change: 1, cap_limited: false, event_kind: "calculation", end_at: slice.end_at, replay_status: "completed" }],
      credit_events: [{ id: "credit", canonical_slice_id: slice.id, formula_result: 3, event_kind: "calculation", start_at: slice.start_at, community: "iov", sao_lane: "OrgBuilding", replay_status: "completed" }],
      campaign_outcomes: [{ occurred_at: slice.start_at, summary: "Synthetic confirmed registration", movements: [{ label: "Registrations", unit: "count", delta: 1 }] }],
    }, windows);
    expect(evidence.periods.current.summary).toMatchObject({ activity_count: 1, pilot_w: { net: 1 }, performance_credits: 3 });
    expect(evidence.campaign_outcomes.current[0].movements[0].delta).toBe(1);
    expect(evidence.periods.previous.summary).toMatchObject({ activity_count: 0, performance_credits: 0 });
    expect(evidence.data_quality.comparison_sufficient).toBe(false);
    expect(evidence.campaign_context).toBeNull();
  });

  it("returns a bounded qualitative digest while exact aggregates still cover every activity", () => {
    const dates = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01"];
    const slices = dates.flatMap((date, dayIndex) => Array.from({ length: 12 }, (_, activityIndex) => {
      const start = new Date(`${date}T00:00:00+05:30`);
      start.setUTCMinutes(start.getUTCMinutes() + activityIndex * 30);
      const end = new Date(start.getTime() + 25 * 60_000);
      return calculated({
        id: `slice-${dayIndex}-${activityIndex}`,
        protocol_link_id: `link-${dayIndex}-${activityIndex}`,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        activity: `Synthetic activity ${activityIndex} ${"detail ".repeat(80)}`,
        proof: `Synthetic observation ${"context ".repeat(80)}`,
        wellbeing_node: activityIndex % 3 === 0 ? "Performance" : "Thought",
        impact_direction: activityIndex % 4 === 0 ? "negative" : "positive",
        impact_intensity: activityIndex % 2 === 0 ? "high" : "medium",
      });
    }));
    const evidence = buildWeeklyReviewEvidence({ slices, w_events: [], credit_events: [], campaign_outcomes: [] }, windows);
    const packet = weeklyReviewPacketForGpt({
      id: "11111111-1111-4111-8111-111111111111",
      week_start: windows.week_start,
      week_end: windows.week_end,
      version: 1,
      timezone: "Asia/Kolkata",
      evidence,
      prepared_at: "2026-08-02T01:30:00.000Z",
      generator_version: "weekly-review-evidence-v1",
    });

    expect(packet.evidence.periods.current.summary.activity_count).toBe(72);
    expect(packet.evidence.periods.previous.summary.activity_count).toBe(72);
    expect(packet.evidence.periods.current.days.every((day) => day.included_activity_count === 6 && day.omitted_activity_count === 6)).toBe(true);
    expect(packet.evidence.periods.previous.days.every((day) => day.included_activity_count === 3 && day.omitted_activity_count === 9)).toBe(true);
    expect(packet.selection_note).toContain("never describe the examples as a complete activity list");
    expect(JSON.stringify(packet)).not.toContain("protocol_link_id");
    expect(Buffer.byteLength(JSON.stringify({ ok: true, packet }), "utf8")).toBeLessThan(60_000);
  });
});

describe("weekly review approval", () => {
  const base = {
    idempotency_key: "weekly-review-2026-08-02",
    packet_id: "11111111-1111-4111-8111-111111111111",
    review_markdown: "Synthetic observation.",
    monday_friday_plan: expectedWeeklyPlanDates("2026-08-01").map((date) => ({ date, founder_critical_outcome: "Outcome", ai_support: "Support", recovery_protection: "Recovery", low_energy_fallback: "Fallback" })),
    owner_reflection: "Synthetic reflection.",
    approval: { confirmed: true as const, confirmation_text: "Yes, save this review." },
  };
  it("requires reflection and explicit confirmation", () => {
    expect(weeklyReviewInputSchema.safeParse(base).success).toBe(true);
    expect(weeklyReviewInputSchema.safeParse({ ...base, owner_reflection: "" }).success).toBe(false);
    expect(weeklyReviewInputSchema.safeParse({ ...base, approval: { confirmed: false, confirmation_text: "No" } }).success).toBe(false);
  });
});
