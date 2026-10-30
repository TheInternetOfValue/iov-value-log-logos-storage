import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeeklyReviewArchive } from "./WeeklyReviewArchive";

describe("WeeklyReviewArchive", () => {
  it("renders interpretation, five-day plan, reflection, evidence, and quality notes", () => {
    const plan = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"].map((date) => ({
      date, founder_critical_outcome: `Synthetic outcome ${date}`, ai_support: "Synthetic AI support",
      recovery_protection: "Synthetic recovery", low_energy_fallback: "Synthetic fallback",
    }));
    const html = renderToStaticMarkup(<WeeklyReviewArchive reviews={[{
      id: "review", packet_id: "packet", week_start: "2026-07-27", week_end: "2026-08-01", version: 1,
      review_markdown: "Synthetic observation", monday_friday_plan: plan, owner_reflection: "Synthetic reflection", approved_at: "2026-08-02T03:00:00Z",
    }]} packets={[{
      id: "packet", version: 1, prepared_at: "2026-08-02T01:30:00Z", evidence: { periods: { current: { summary: { recorded_days: 1, activity_count: 1, recorded_minutes: 60, missing_dates: ["2026-07-28"], pending_statuses: { validation_pending: 1 } }, days: [{ date: "2026-07-27", activities: [{ id: "activity", activity: "Synthetic focus block", wellbeing_node: "Performance", community: "iov" }] }] } } },
    }]} />);
    expect(html).toContain("Weekly Reviews");
    expect(html).toContain("Synthetic observation");
    expect(html).toContain("Synthetic reflection");
    expect(html.match(/Founder-critical outcome/g)).toHaveLength(5);
    expect(html).toContain("Synthetic focus block");
    expect(html).toContain("validation_pending 1");
  });
});
