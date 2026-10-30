import { describe, expect, it } from "vitest";
import { displayScoreForDate, founderEventsAsReplayRows, scoreBranchForOccurrence, scoreRegimeForDate } from "./score-cutover";

const boundary = "2026-07-28T15:30:00.000Z";

describe("Genesis score cutover", () => {
  it("keeps Pilot W historical before Genesis and canonical state from the Genesis day", () => {
    expect(scoreRegimeForDate("2026-07-27", boundary)).toBe("historical_pilot");
    expect(scoreRegimeForDate("2026-07-28", boundary)).toBe("genesis_day");
    expect(scoreRegimeForDate("2026-07-29", boundary)).toBe("canonical_founder");
    expect(displayScoreForDate({ date: "2026-07-27", genesisBoundaryAt: boundary, historicalPilotW: 847, canonicalFounderW: 771 }).value).toBe(847);
    expect(displayScoreForDate({ date: "2026-07-28", genesisBoundaryAt: boundary, historicalPilotW: 847, canonicalFounderW: 771 }).value).toBe(771);
  });

  it("routes occurrences without overlap and keeps the exact timestamp historical", () => {
    expect(scoreBranchForOccurrence(boundary, boundary)).toBe("historical_pilot");
    expect(scoreBranchForOccurrence("2026-07-28T15:30:00.001Z", boundary)).toBe("canonical_founder");
  });

  it("maps canonical founder movement and Performance value without changing records", () => {
    const canonical_slices = { id: "slice", start_at: "2026-07-28T16:00:00Z", end_at: "2026-07-28T17:00:00Z", activity: "Work", slice_type: "performance", community: "iov" as const };
    const rows = founderEventsAsReplayRows([{ id: "event", canonical_slice_id: "slice", event_kind: "performance", vcperformance_event_amount: 8673.75, w_before: 771, w_after: 771.021, delta_w: .021, protocol_finality_status: "final", payability_status: "non_payable", canonical_slices }]);
    expect(rows.wEvents[0]).toMatchObject({ pre_slice_w: 771, post_slice_w: 771.021, applied_change: .021 });
    expect(rows.creditEvents[0].formula_result).toBe(8673.75);
  });
});
