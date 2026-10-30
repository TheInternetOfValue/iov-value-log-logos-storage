import { describe, expect, it } from "vitest";
import {
  aggregateCommunityValue,
  communityValueProjectionSchema,
  type ActiveCreditEvent,
  type ActiveWEvent,
} from "@/lib/community-value";

const slice = (community: "house_of_bros" | "gfe" | "iov", start_at: string, end_at: string) => ({ community, start_at, end_at });

describe("community value aggregates", () => {
  it("keeps wellbeing movement separate from community credits", () => {
    const w: ActiveWEvent[] = [
      { id: "w1", applied_change: 0.25, input_hash: "a".repeat(64), created_at: "2026-07-05T00:00:00.000Z", canonical_slices: slice("house_of_bros", "2026-07-05T08:00:00.000Z", "2026-07-05T09:00:00.000Z") },
      { id: "w2", applied_change: -0.1, input_hash: "b".repeat(64), created_at: "2026-06-01T00:00:00.000Z", canonical_slices: slice("house_of_bros", "2026-06-01T08:00:00.000Z", "2026-06-01T08:30:00.000Z") },
    ];
    const credits: ActiveCreditEvent[] = [
      { id: "c1", formula_result: 400, input_hash: "c".repeat(64), created_at: "2026-07-05T00:00:00.000Z", canonical_slices: slice("iov", "2026-07-05T10:00:00.000Z", "2026-07-05T12:00:00.000Z") },
    ];
    const [house, gfe, iov] = aggregateCommunityValue(w, credits, new Date("2026-07-06T00:00:00.000Z"));
    expect(house.last_30_days).toEqual({ calculated_minutes: 60, positive_w: 0.25, negative_w: 0, net_w: 0.25 });
    expect(house.lifetime).toEqual({ calculated_minutes: 90, positive_w: 0.25, negative_w: -0.1, net_w: 0.15 });
    expect(gfe.lifetime).toEqual({ calculated_minutes: 0, credits: 0 });
    expect(iov.lifetime).toEqual({ calculated_minutes: 120, credits: 400 });
  });

  it("rejects private record-level fields from public projections", () => {
    const projection = {
      did: "did:iov:member:10000000-0000-4000-8000-000000000001",
      public_profile_slug: "moses-sam-paul-johnraj",
      communities: aggregateCommunityValue([], [], new Date("2026-07-06T00:00:00.000Z")),
      input_window: { last_30_days_start: "2026-06-06T00:00:00.000Z", end: "2026-07-06T00:00:00.000Z", lifetime_start: null },
      projection_version: "community-value-v1",
      aggregate_provenance_hash: "a".repeat(64),
      source_application: "iov-value-log",
      updated_at: "2026-07-06T00:00:00.000Z",
      experimental: true,
      limitations: ["Distinct measures."],
    };
    expect(communityValueProjectionSchema.safeParse(projection).success).toBe(true);
    expect(communityValueProjectionSchema.safeParse({ ...projection, activity: "private" }).success).toBe(false);
  });
});
