import { describe, expect, it } from "vitest";
import { approvedPerformanceImpact } from "./approve-founder-backlog";

describe("explicit backlog approval impact", () => {
  it("retains a declared and complete transition", () => {
    expect(approvedPerformanceImpact({ founder_performance_impact_status: "applied", founder_performance_impact: "low", impact_direction: "negative" }))
      .toEqual({ status: "applied", impact: "low", direction: "negative" });
  });
  it("does not infer a wellbeing transition from a positive activity direction", () => {
    expect(approvedPerformanceImpact({ founder_performance_impact_status: null, founder_performance_impact: null, impact_direction: "positive" }))
      .toEqual({ status: "no_transition", impact: null, direction: null });
  });
  it("refuses an incomplete applied impact", () => {
    expect(() => approvedPerformanceImpact({ founder_performance_impact_status: "applied", founder_performance_impact: null, impact_direction: "positive" })).toThrow();
  });
});
