import { describe, expect, it } from "vitest";
import { findTimelineOverlaps } from "@/lib/timeline-integrity";

const slice = (id: string, start_at: string, end_at: string, community = "iov") => ({ id, start_at, end_at, community, status: "validation_pending" });

describe("global timeline integrity", () => {
  it("accepts endpoint-touching intervals", () => {
    expect(findTimelineOverlaps([slice("a", "2026-07-16T00:30:00.000Z", "2026-07-16T01:00:00.000Z"), slice("b", "2026-07-16T01:00:00.000Z", "2026-07-16T01:30:00.000Z", "gfe")])).toEqual([]);
  });
  it("accepts endpoint-touching intervals expressed with different ISO offsets", () => {
    expect(findTimelineOverlaps([slice("a", "2026-07-15T17:00:00+05:30", "2026-07-15T18:30:00+05:30"), slice("b", "2026-07-15T13:00:00+00:00", "2026-07-15T13:30:00+00:00", "iov")])).toEqual([]);
  });
  it("finds cross-Commons nested and identical intervals", () => {
    const start = "2026-07-16T00:00:00.000Z";
    expect(findTimelineOverlaps([slice("a", start, "2026-07-16T02:30:00.000Z", "house_of_bros"), slice("b", "2026-07-16T01:30:00.000Z", "2026-07-16T02:00:00.000Z", "iov"), slice("c", start, "2026-07-16T02:30:00.000Z", "gfe")])).toHaveLength(3);
  });
  it("excludes superseded and reversed history", () => {
    expect(findTimelineOverlaps([{ ...slice("a", "2026-07-16T00:00:00.000Z", "2026-07-16T02:00:00.000Z"), status: "superseded" }, slice("b", "2026-07-16T01:00:00.000Z", "2026-07-16T01:30:00.000Z")])).toEqual([]);
  });
});
