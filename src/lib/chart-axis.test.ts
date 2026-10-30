import { describe, expect, it } from "vitest";
import { chartTickIndices, isCanonicalTrendRange, isIsoDate } from "./chart-axis";

describe("chartTickIndices", () => {
  it("labels every day in a seven-day view", () => {
    expect([...chartTickIndices(7)]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("labels alternate days and the final day in a fourteen-day view", () => {
    expect([...chartTickIndices(14)]).toEqual([0, 2, 4, 6, 8, 10, 12, 13]);
  });

  it("labels five-day intervals and the final day in a thirty-day view", () => {
    expect([...chartTickIndices(30)]).toEqual([0, 5, 10, 15, 20, 25, 29]);
  });

  it("returns no labels for an empty series", () => {
    expect([...chartTickIndices(0)]).toEqual([]);
  });

  it("recognizes only canonical query values", () => {
    expect(isCanonicalTrendRange("7")).toBe(true);
    expect(isCanonicalTrendRange("90")).toBe(false);
    expect(isIsoDate("2026-07-18")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("18-07-2026")).toBe(false);
  });
});
