import { describe, expect, it } from "vitest";
import { campaignEventInputSchema, cinematicDayReelInputSchema, cinematicReelTemporalError, dailyPlanInputSchema, dailyPlanTemporalError } from "@/lib/operating-protocol";

const approval = { confirmed: true, confirmation_text: "Yes, save it." };

describe("daily operating protocol schemas", () => {
  it("accepts an approved plan for a future part of today or tomorrow", () => {
    expect(dailyPlanInputSchema.safeParse({
      idempotency_key: "plan-2026-07-22-abcdef",
      plan_date: "2026-07-22",
      expected_plan_id: null,
      daily_focus: "Lock Volume 1.",
      blocks: [{ start_at: "2026-07-22T09:00:00+05:30", end_at: "2026-07-22T11:00:00+05:30", timezone: "Asia/Kolkata", founder_activity: "Edit Volume 1", intended_outcome: "Finish Chapter 2" }],
      approval,
    }).success).toBe(true);
  });

  it("accepts a separately approved saved cinematic day reel", () => {
    expect(cinematicDayReelInputSchema.safeParse({
      idempotency_key: "reel-2026-07-20-abcdef",
      reel_date: "2026-07-20",
      expected_reel_id: null,
      title: "Cinematic Day Reel — July 20",
      duration_seconds: 45,
      script_markdown: "## Opening hook\nA real, grounded story of the day.",
      approval: { confirmed: true, confirmation_text: "Yes, save this reel." },
    }).success).toBe(true);
    expect(cinematicDayReelInputSchema.safeParse({
      idempotency_key: "reel-2026-07-20-abcdef",
      reel_date: "2026-07-20",
      title: "Too short",
      duration_seconds: 10,
      script_markdown: "No.",
      approval,
    }).success).toBe(false);
  });

  it("allows a current-day reel through a non-future IST evidence cutoff", () => {
    const now = new Date("2026-07-27T16:30:00Z"); // 10:00 PM IST
    expect(cinematicReelTemporalError({ reel_date: "2026-07-27", evidence_cutoff_at: "2026-07-27T22:00:00+05:30" }, now)).toBeNull();
    expect(cinematicReelTemporalError({ reel_date: "2026-07-27", evidence_cutoff_at: "2026-07-27T12:00:00+05:30" }, now)).toBeNull();
    expect(cinematicReelTemporalError({ reel_date: "2026-07-26" }, now)).toBeNull();
  });

  it("rejects invalid reel dates and current-day evidence boundaries", () => {
    const now = new Date("2026-07-27T08:30:00Z"); // 2:00 PM IST
    expect(cinematicReelTemporalError({ reel_date: "2026-07-28" }, now)).toBe("future_reel_date");
    expect(cinematicReelTemporalError({ reel_date: "2026-07-27" }, now)).toBe("evidence_cutoff_required");
    expect(cinematicReelTemporalError({ reel_date: "2026-07-27", evidence_cutoff_at: "2026-07-26T23:00:00+05:30" }, now)).toBe("evidence_cutoff_date_mismatch");
    expect(cinematicReelTemporalError({ reel_date: "2026-07-27", evidence_cutoff_at: "2026-07-27T14:01:00+05:30" }, now)).toBe("evidence_cutoff_in_future");
  });

  it("keeps the 2 PM boundary between completed life and future plans", () => {
    const now = new Date("2026-07-27T08:30:00Z"); // 2:00 PM IST
    const base = {
      plan_date: "2026-07-27",
      status: "planned" as const,
      blocks: [{ start_at: "2026-07-27T14:01:00+05:30", end_at: "2026-07-27T15:00:00+05:30", timezone: "Asia/Kolkata" as const, responsible_party: "founder" as const, founder_activity: "Write", status: "planned" as const }],
    };
    expect(dailyPlanTemporalError(base, now)).toBeNull();
    expect(dailyPlanTemporalError({ ...base, blocks: [{ ...base.blocks[0], start_at: "2026-07-27T14:00:00+05:30" }] }, now)).toBe("plan_must_start_in_future");
  });

  it("rejects overlapping, cross-day, and completed plan blocks", () => {
    const base = { idempotency_key: "plan-2026-07-22-abcdef", plan_date: "2026-07-22", blocks: [
      { start_at: "2026-07-22T09:00:00+05:30", end_at: "2026-07-22T11:00:00+05:30", timezone: "Asia/Kolkata", founder_activity: "Write" },
      { start_at: "2026-07-22T10:00:00+05:30", end_at: "2026-07-22T12:00:00+05:30", timezone: "Asia/Kolkata", founder_activity: "Call" },
    ], approval };
    expect(dailyPlanInputSchema.safeParse(base).success).toBe(false);
    expect(dailyPlanInputSchema.safeParse({ ...base, blocks: [{ ...base.blocks[0], end_at: "2026-07-23T01:00:00+05:30" }] }).success).toBe(false);
    expect(dailyPlanInputSchema.safeParse({ ...base, blocks: [{ ...base.blocks[0], status: "completed" }] }).success).toBe(false);
  });

  it("requires separate approved campaign movements and correction provenance", () => {
    const base = { idempotency_key: "campaign-2026-07-21-abcdef", campaign_id: "5f247798-4c8d-47aa-9f79-509b97bfd6f4", occurred_at: "2026-07-21T20:00:00+05:30", summary: "Two paid orders", movements: [{ campaign_metric_id: "a7ea34b8-e1ff-4657-a64b-bb1e508c1b58", delta: 2000 }], approval };
    expect(campaignEventInputSchema.safeParse(base).success).toBe(true);
    expect(campaignEventInputSchema.safeParse({ ...base, approval: { confirmed: false, confirmation_text: "yes" } }).success).toBe(false);
    expect(campaignEventInputSchema.safeParse({ ...base, event_kind: "correction" }).success).toBe(false);
  });
});
