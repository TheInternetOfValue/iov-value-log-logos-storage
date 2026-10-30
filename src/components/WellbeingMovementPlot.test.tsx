import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WellbeingMovementPlot } from "./WellbeingMovementPlot";

describe("WellbeingMovementPlot", () => {
  it("keeps positive, negative, zero, and missing period values exact and accessible", () => {
    const html = renderToStaticMarkup(<WellbeingMovementPlot variant="period" values={[
      { id: "one", date: "2026-07-20", label: "20 Jul", value: .12 },
      { id: "two", date: "2026-07-21", label: "21 Jul", value: -.04 },
      { id: "three", date: "2026-07-22", label: "22 Jul", value: 0 },
      { id: "four", date: "2026-07-23", label: "23 Jul", value: null },
    ]} />);
    expect(html).toContain("20 Jul. +0.1200 W completed movement.");
    expect(html).toContain("21 Jul. -0.0400 W completed movement.");
    expect(html).toContain("22 Jul. 0.0000 W completed movement.");
    expect(html).toContain("23 Jul. No completed W movement.");
    expect(html).toContain("movement-period-point missing");
  });

  it("renders settlement truth as pre-W, signed movement, and post-W", () => {
    const html = renderToStaticMarkup(<WellbeingMovementPlot
      closingW={846.53}
      openingW={846.5}
      values={[{ id: "transition", label: "8:30 am", settledAt: "2026-07-22T08:30:00+05:30", preW: 846.5, change: .03, postW: 846.53 }]}
      variant="settlement"
    />);
    expect(html).toContain("Opening 846.5000 W");
    expect(html).toContain("Closing 846.5300 W");
    expect(html).toContain("8:30 am. 846.5000 W before, +0.0300 W movement, 846.5300 W after.");
    expect(html).toContain("+0.0300 W → 846.5300 W");
  });
});
