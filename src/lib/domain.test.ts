import { describe, expect, it } from "vitest";
import { completedActivityTemporalError, expectedValidationRole, ingestionSchema } from "@/lib/domain";

const nonPerformance = {
  start_at: "2026-07-03T08:00:00+05:30",
  end_at: "2026-07-03T08:30:00+05:30",
  timezone: "Asia/Kolkata",
  activity: "Morning walk",
  wellbeing_node: "Physiology",
  slice_type: "non_performance",
  community: "house_of_bros",
  impact_direction: "positive",
  impact_intensity: "medium",
  confidence: "observed",
};

describe("GPT draft schema", () => {
  it("rejects intake that the person did not confirm in the private Custom GPT", () => {
    expect(ingestionSchema.safeParse({
      idempotency_key: "day-2026-07-03-abcdef",
      timezone: "Asia/Kolkata",
      raw_narrative: "I walked.",
      slices: [nonPerformance],
    }).success).toBe(false);
  });

  it("accepts explicit observer confirmation from the private GPT pilot", () => {
    expect(ingestionSchema.safeParse({
      idempotency_key: "day-2026-07-04-confirmed",
      timezone: "Asia/Kolkata",
      raw_narrative: "I reviewed this summary and confirmed it.",
      slices: [nonPerformance],
      observer_confirmation: {
        confirmed: true,
        channel: "private_custom_gpt",
        confirmation_text: "Yes, this day summary is accurate. Send it.",
      },
    }).success).toBe(true);
  });

  it("rejects inverted time and invalid routing", () => {
    expect(ingestionSchema.safeParse({
      idempotency_key: "day-2026-07-03-abcdef",
      timezone: "Asia/Kolkata",
      raw_narrative: "I walked.",
      slices: [{ ...nonPerformance, end_at: nonPerformance.start_at, community: "iov" }],
    }).success).toBe(false);
  });

  it("routes validator roles without claiming independent reviewers", () => {
    expect(expectedValidationRole("Physiology", "house_of_bros")).toBe("house_of_bros_validator");
    expect(expectedValidationRole("Performance", "iov")).toBe("iov_validator");
    expect(expectedValidationRole("Performance", "gfe")).toBe("gfe_validator");
  });

  it("accepts adjacent midnight-split sleep segments as two completed records", () => {
    const sleepSegments = [
      { ...nonPerformance, start_at: "2026-07-27T22:00:00+05:30", end_at: "2026-07-28T00:00:00+05:30", activity: "Sleep — segment 1 of one reported sleep episode", proof: "10 PM–midnight segment of one reported sleep episode." },
      { ...nonPerformance, start_at: "2026-07-28T00:00:00+05:30", end_at: "2026-07-28T06:00:00+05:30", activity: "Sleep — segment 2 of one reported sleep episode", proof: "Midnight–6 AM segment of one reported sleep episode." },
    ];
    const parsed = ingestionSchema.safeParse({
      idempotency_key: "sleep-2026-07-27-abcdef",
      timezone: "Asia/Kolkata",
      raw_narrative: "I slept from 10 PM until 6 AM.",
      slices: sleepSegments,
      observer_confirmation: { confirmed: true, channel: "private_custom_gpt", confirmation_text: "Yes, log both sleep segments." },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.slices).toHaveLength(2);
    expect(completedActivityTemporalError(sleepSegments, new Date("2026-07-28T01:00:00Z"))).toBeNull();
  });

  it("keeps non-sleep overnight activity as one interval and rejects ongoing activity", () => {
    const overnightWork = { ...nonPerformance, start_at: "2026-07-27T23:00:00+05:30", end_at: "2026-07-28T01:00:00+05:30", activity: "Overnight travel" };
    expect(ingestionSchema.safeParse({
      idempotency_key: "travel-2026-07-27-abcdef",
      timezone: "Asia/Kolkata",
      raw_narrative: "I travelled from 11 PM to 1 AM.",
      slices: [overnightWork],
      observer_confirmation: { confirmed: true, channel: "private_custom_gpt", confirmation_text: "Yes, log the travel." },
    }).success).toBe(true);
    expect(completedActivityTemporalError([overnightWork], new Date("2026-07-27T18:30:00Z"))).toBe("activity_not_completed");
    expect(completedActivityTemporalError([overnightWork], new Date("2026-07-27T19:30:00Z"))).toBeNull();
  });
});
