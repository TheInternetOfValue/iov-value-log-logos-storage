import { describe, expect, it } from "vitest";
import { dayNavigation } from "@/lib/day-navigation";

describe("seven day navigation", () => {
  it("exposes the next two days and today near the current boundary", () => {
    expect(dayNavigation("2026-07-31", "2026-08-02")).toEqual({
      dates: ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"],
      previous: "2026-07-30",
      next: "2026-08-01",
      today: "2026-08-02",
      isToday: false,
      isFuture: false,
    });
  });

  it("ends on today and disables the next-day destination", () => {
    expect(dayNavigation("2027-01-02", "2027-01-02")).toEqual({
      dates: ["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
      previous: "2027-01-01",
      next: null,
      today: "2027-01-02",
      isToday: true,
      isFuture: false,
    });
  });

  it("centres older days where possible", () => {
    expect(dayNavigation("2026-07-20", "2026-08-02").dates).toEqual([
      "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23",
    ]);
  });

  it("preserves intentional future-day planning", () => {
    expect(dayNavigation("2026-08-05", "2026-08-02")).toEqual({
      dates: ["2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"],
      previous: "2026-08-04",
      next: "2026-08-06",
      today: "2026-08-02",
      isToday: false,
      isFuture: true,
    });
  });
});
