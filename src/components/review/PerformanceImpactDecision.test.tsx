import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerformanceImpactDecision } from "./PerformanceImpactDecision";

const render = (props: Partial<React.ComponentProps<typeof PerformanceImpactDecision>> = {}) => renderToStaticMarkup(
  <PerformanceImpactDecision id="slice-1" {...props} />,
);

describe("PerformanceImpactDecision", () => {
  it.each([undefined, null, "pending"])("defaults unresolved status %s to one visible No transition decision", (status) => {
    const html = render({ status });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<option value="no_transition" selected="">No transition</option>');
    expect(html).not.toContain("founder_performance_impact_direction:slice-1");
    expect(html).not.toContain('name="founder_performance_impact:slice-1"');
  });

  it("reveals Positive and Low defaults for an applied transition", () => {
    const html = render({ status: "applied" });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('<option value="positive" selected="">Positive</option>');
    expect(html).toContain('<option value="low" selected="">Low</option>');
    expect(html).toContain("founder_performance_impact_direction:slice-1");
    expect(html).toContain('name="founder_performance_impact:slice-1"');
  });

  it("preserves a saved applied direction and intensity", () => {
    const html = render({ direction: "negative", intensity: "high", status: "applied" });
    expect(html).toContain('<option value="negative" selected="">Negative</option>');
    expect(html).toContain('<option value="high" selected="">High</option>');
  });

  it("excludes stale subordinate values when No transition is saved", () => {
    const html = render({ direction: "negative", intensity: "high", status: "no_transition" });
    expect(html).toContain('<option value="no_transition" selected="">No transition</option>');
    expect(html).not.toContain("founder_performance_impact_direction:slice-1");
    expect(html).not.toContain('name="founder_performance_impact:slice-1"');
  });
});
