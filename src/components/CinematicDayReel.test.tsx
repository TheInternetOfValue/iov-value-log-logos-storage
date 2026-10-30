import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CinematicDayReel } from "@/components/CinematicDayReel";

describe("CinematicDayReel", () => {
  it("labels the immutable evidence boundary for a current-day save", () => {
    const html = renderToStaticMarkup(<CinematicDayReel
      title="The day so far"
      durationSeconds={45}
      script="A grounded current-day script."
      evidenceCutoffAt="2026-07-27T22:00:00+05:30"
    />);
    expect(html).toContain("Evidence through 10:00 pm IST");
  });

  it("keeps historical reels without a cutoff valid", () => {
    const html = renderToStaticMarkup(<CinematicDayReel title="A completed day" durationSeconds={45} script="A grounded historical script." />);
    expect(html).not.toContain("Evidence through");
  });
});
