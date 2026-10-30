import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { DayClock, type DayClockActivity } from "./DayClock";
import type { DailyBriefingReading, DayWeather } from "@/lib/day-external-context";

const baseActivity: DayClockActivity = {
  id: "slice-1",
  activity: "Rested",
  detail: "A canonical recorded activity.",
  start: "8:00 am",
  end: "9:00 am",
  result: "",
  needsReview: false,
  calculating: false,
  type: "wellbeing",
  node: "Physiology",
  startMinute: 480,
  endMinute: 540,
  conflict: false,
};

function render(activities: DayClockActivity[], calculationActive = false, conflictHref?: string, external?: {
  briefing?: DailyBriefingReading;
  isToday?: boolean;
  weather?: DayWeather;
}) {
  return renderToStaticMarkup(
    <DayClock
      activities={activities}
      assistantUrl="https://example.test/assistant"
      briefing={external?.briefing}
      calculationActive={calculationActive}
      conflictHref={conflictHref}
      isToday={external?.isToday ?? false}
      plans={[]}
      weather={external?.weather}
    />,
  );
}

describe("DayClock shared contextual reading", () => {
  it("preserves the empty and recorded-day readings inside ContextualReading", () => {
    const empty = render([]);
    const recorded = render([{ ...baseActivity, result: "+0.03 W" }]);
    expect(empty).toContain('aria-label="Living Day reading"');
    expect(empty).toContain("An open day");
    expect(recorded).toContain("1 recorded activity");
    expect(recorded).toContain("Inner marks are completed W movement");
  });

  it("preserves pending, active calculation and conflict states", () => {
    const pending = render([{ ...baseActivity, calculating: true }]);
    const active = render([{ ...baseActivity, calculating: true }], true);
    const conflict = render([{ ...baseActivity, conflict: true }], false, "/slices/canonical/slice-1");
    expect(pending).toContain("Awaiting calculation");
    expect(pending).toContain('class="living-day calculation-pending"');
    expect(pending).toContain('class="day-clock calculation-pending"');
    expect(pending).toContain('class="clock-calculation-halo"');
    expect(active).toContain("Calculating completed movement");
    expect(active).toContain('class="day-clock calculating"');
    expect(active).toContain('aria-busy="true"');
    expect(conflict).toContain("Two activities occupy the same time");
    expect(conflict).toContain("Correct time conflict");
  });

  it("adds weather and briefing as read-only contextual entries without replacing the clock", () => {
    const weather: DayWeather = {
      location: "Bengaluru",
      timezone: "Asia/Kolkata",
      temperatureC: 24.2,
      apparentTemperatureC: 25.1,
      cloudCover: 88,
      precipitationMm: 0.8,
      weatherCode: 61,
      isDay: true,
      condition: "rain",
      conditionLabel: "light rain",
      phase: "dawn",
      observedAt: "2026-07-24T06:30",
      sunrise: "2026-07-24T06:00",
      sunset: "2026-07-24T18:45",
    };
    const briefing: DailyBriefingReading = {
      freshness: "fresh",
      provenance: { path: "briefings/2026-07-24/example.json", blob_sha: "abc123" },
      artifact: {
        schema_version: "value-log-daily-briefing-v1",
        date: "2026-07-24",
        timezone: "Asia/Kolkata",
        generated_at: "2026-07-24T06:00:00+05:30",
        expires_at: "2026-07-24T23:59:59+05:30",
        title: "Morning briefing",
        signals: [1, 2, 3].map((rank) => ({
          id: `signal-${rank}`,
          rank,
          headline: `Signal ${rank}`,
          summary: "Summary",
          status: "confirmed",
          sources: [{ publisher: "Source", url: `https://example.com/${rank}` }],
        })),
      },
    };
    const markup = render([{ ...baseActivity, result: "+0.03 W" }], false, undefined, { isToday: true, weather, briefing });
    expect(markup).toContain("Outside now");
    expect(markup).toContain("Bengaluru · 24°C · light rain");
    expect(markup).toContain("Morning briefing");
    expect(markup).toContain("3 signals");
    expect(markup).toContain("clock-atmosphere atmosphere-rain phase-dawn");
    expect(markup).toContain("24-hour view of planned and recorded activity");
  });

  it("keeps a time-based ambient field available before weather is configured", () => {
    const markup = render([], false, undefined, { isToday: true });
    expect(markup).toContain("Ambient day");
    expect(markup).toContain("Time-based · On");
    expect(markup).toContain("ambient-enabled ambient-neutral phase-day");
    expect(markup).toContain("clock-atmosphere atmosphere-neutral phase-day");
    expect(markup).toContain("atmosphere-sun");
  });
});
