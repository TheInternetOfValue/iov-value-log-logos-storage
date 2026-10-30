import { describe, expect, it } from "vitest";
import { AATHICHUDI_ITEMS, dailyBharathiForDate } from "@/lib/daily-bharathi";

function dateAtOffset(offset: number) {
  return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
}

describe("daily Bharathi", () => {
  it("uses the 110 approved source entries directly", () => {
    expect(AATHICHUDI_ITEMS).toHaveLength(110);
    expect(new Set(AATHICHUDI_ITEMS.map((item) => item.number)).size).toBe(110);
  });

  it("returns the same reading for the same displayed calendar date", () => {
    expect(dailyBharathiForDate("2026-07-22")).toEqual(dailyBharathiForDate("2026-07-22"));
  });

  it("uses every entry exactly once within a 110-day cycle", () => {
    const readings = Array.from({ length: 110 }, (_, index) => dailyBharathiForDate(dateAtOffset(index)));
    expect(new Set(readings.map((item) => item.number)).size).toBe(110);
    expect(readings.map((item) => item.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 110 }, (_, index) => index + 1));
  });

  it("changes by calendar date, including historical dates", () => {
    expect(dailyBharathiForDate("2026-07-20").number).not.toBe(dailyBharathiForDate("2026-07-21").number);
  });
});
