import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TodayView } from "./TodayView";

describe("member Today clock", () => {
  it("shows the supplied clock even when the shared-day notes view is unavailable", () => {
    const html = renderToStaticMarkup(<TodayView selected="2026-10-28" today="2026-10-28" timed={0} notes={null} logHref={null} circle={<div>My day clock</div>} />);
    expect(html).toContain("My day clock");
    expect(html).toContain("No timed activities on the clock.");
    expect(html).not.toContain("Nothing recorded yet today.");
  });
  it("does not report an empty day when its projection failed", () => {
    const html = renderToStaticMarkup(<TodayView selected="2026-10-28" today="2026-10-28" timed={0} notes={null} logHref={null} unavailable circle={<div>My day clock</div>} />);
    expect(html).toContain("Day details are unavailable right now.");
    expect(html).not.toContain("No timed activities on the clock.");
  });
});
