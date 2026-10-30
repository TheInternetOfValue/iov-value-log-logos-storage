import { describe, expect, it } from "vitest";
import { resolveTrendQuery } from "./trends-query";

const range = { startDate: "2026-07-12", endDate: "2026-07-18" };

describe("Insight query selection", () => {
  it("preserves an explicit in-range ISO date", () => {
    expect(resolveTrendQuery({ ...range, range: "7", date: "2026-07-14", node: "Feeling" })).toMatchObject({ range: 7, selectedDate: "2026-07-14", selectedNode: "Feeling", selectedIsExplicit: true });
  });

  it("returns to the period overview when the selected date is outside the active range", () => {
    expect(resolveTrendQuery({ ...range, range: "7", date: "2026-06-10" })).toMatchObject({ selectedDate: undefined, selectedIsExplicit: false });
  });

  it("normalizes invalid values to the default unpinned overview", () => {
    expect(resolveTrendQuery({ ...range, range: "90", date: "2026-07-14", node: "Feeling" })).toMatchObject({ range: 7, selectedDate: undefined, selectedNode: undefined, selectedIsExplicit: false });
    expect(resolveTrendQuery({ ...range, range: "7", date: "2026-02-31", node: "Unknown" })).toMatchObject({ range: 7, selectedDate: undefined, selectedNode: undefined, selectedIsExplicit: false });
  });

  it("keeps the first view unpinned and accepts Performance as a separate node", () => {
    expect(resolveTrendQuery({ ...range, range: "7" })).toMatchObject({ selectedDate: undefined, selectedNode: undefined, selectedIsExplicit: false });
    expect(resolveTrendQuery({ ...range, range: "7", node: "Performance" })).toMatchObject({ selectedNode: "Performance" });
  });
});
