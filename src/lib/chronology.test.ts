import { describe, expect, it } from "vitest";
import { earliestOpenDate, isChronologicallyEligible } from "@/lib/chronology";

const now = Date.parse("2026-07-15T09:00:00+05:30");

describe("chronological review eligibility", () => {
  it("selects the oldest unresolved IST day", () => {
    const items = [
      { start_at: "2026-07-14T23:30:00+05:30", timezone: "Asia/Kolkata" },
      { start_at: "2026-07-04T08:00:00+05:30", timezone: "Asia/Kolkata" },
    ];
    expect(earliestOpenDate(items, now)).toBe("2026-07-04");
    expect(isChronologicallyEligible(items[0], "2026-07-04", now)).toBe(false);
    expect(isChronologicallyEligible(items[1], "2026-07-04", now)).toBe(true);
  });

  it("does not let a future Tom Me item block current work", () => {
    const future = { start_at: "2026-07-16T08:00:00+05:30", timezone: "Asia/Kolkata" };
    expect(earliestOpenDate([future], now)).toBeNull();
    expect(isChronologicallyEligible(future, null, now)).toBe(false);
  });
});
