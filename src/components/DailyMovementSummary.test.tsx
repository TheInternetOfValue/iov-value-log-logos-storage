import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailyMovementSummary } from "./DailyMovementSummary";

describe("DailyMovementSummary", () => {
  it("shows exact daily movement and an Insights destination", () => {
    const html = renderToStaticMarkup(<DailyMovementSummary date="2026-08-01" readings={[{
      id: "canonical",
      label: "Canonical founder W",
      projection: {
        status: "completed",
        openingW: "771.110000000000",
        closingW: "771.110400000000",
        netW: "0.000400000000",
        calculatedEventCount: 1,
        events: [{ id: "one", settledAt: "2026-08-01T08:00:00+05:30", preW: "771.110000000000", change: "0.000400000000", postW: "771.110400000000" }],
        settlements: [{ id: "one", settledAt: "2026-08-01T08:00:00+05:30", preW: "771.110000000000", change: "0.000400000000", postW: "771.110400000000" }],
      },
    }]} />);
    expect(html).toContain("Day movement");
    expect(html).toContain("+0.0004 W");
    expect(html).toContain("Opening 771.1100 W");
    expect(html).toContain("/trends?range=7&amp;date=2026-08-01");
  });

  it("states calculated zero without presenting it as positive", () => {
    const html = renderToStaticMarkup(<DailyMovementSummary date="2026-08-01" readings={[{
      id: "canonical",
      label: "Canonical founder W",
      projection: { status: "zero", openingW: "771.110000000000", closingW: "771.110000000000", netW: "0.000000000000", calculatedEventCount: 1, events: [{ id: "zero", settledAt: "2026-08-01T08:00:00+05:30", preW: "771.110000000000", change: "0.000000000000", postW: "771.110000000000" }], settlements: [] },
    }]} />);
    expect(html).toContain("0.0000 W");
    expect(html).toContain("No wellbeing transition applied");
    expect(html).not.toContain("+0.0000 W");
  });

  it("keeps Genesis regimes visibly separate", () => {
    const empty = { status: "unavailable" as const, openingW: null, closingW: null, netW: null, calculatedEventCount: 0, events: [], settlements: [] };
    const html = renderToStaticMarkup(<DailyMovementSummary date="2026-07-28" readings={[
      { id: "historical", label: "Historical Pilot W before Genesis", projection: empty },
      { id: "canonical", label: "Canonical founder W after Genesis", projection: empty },
    ]} />);
    expect(html).toContain("not connected or added");
    expect(html).toContain("Historical Pilot W before Genesis");
    expect(html).toContain("Canonical founder W after Genesis");
  });
});
