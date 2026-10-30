import { describe, expect, it } from "vitest";
import {
  conditionLabel,
  dayPhaseFor,
  normalizeWeatherCode,
  parseDailyBriefing,
} from "./day-external-context";

const validArtifact = {
  schema_version: "value-log-daily-briefing-v1",
  date: "2026-07-24",
  timezone: "Asia/Kolkata",
  generated_at: "2026-07-24T06:00:00+05:30",
  expires_at: "2026-07-24T23:59:59+05:30",
  title: "Morning briefing",
  full_briefing_url: "https://chatgpt.com/c/example",
  signals: [1, 2, 3].map((rank) => ({
    id: `signal-${rank}`,
    rank,
    headline: `Signal ${rank}`,
    summary: "A bounded factual summary.",
    iov_reading: "A bounded IoV interpretation.",
    status: "confirmed",
    sources: [{ publisher: "Example", url: `https://example.com/${rank}` }],
  })),
};

describe("daily briefing validation", () => {
  it("accepts a valid current artifact and identifies stale artifacts", () => {
    expect(parseDailyBriefing(validArtifact, "2026-07-24", new Date("2026-07-24T06:30:00+05:30"))?.freshness).toBe("fresh");
    expect(parseDailyBriefing(validArtifact, "2026-07-24", new Date("2026-07-25T00:01:00+05:30"))?.freshness).toBe("stale");
  });

  it("rejects wrong dates, future artifacts, duplicate ranks and unsafe URLs", () => {
    expect(parseDailyBriefing(validArtifact, "2026-07-23", new Date("2026-07-24T06:30:00+05:30"))).toBeNull();
    expect(parseDailyBriefing(validArtifact, "2026-07-24", new Date("2026-07-24T05:59:00+05:30"))).toBeNull();
    expect(parseDailyBriefing({
      ...validArtifact,
      signals: validArtifact.signals.map((signal) => ({ ...signal, rank: 1 })),
    }, "2026-07-24", new Date("2026-07-24T06:30:00+05:30"))).toBeNull();
    expect(parseDailyBriefing({
      ...validArtifact,
      signals: validArtifact.signals.map((signal, index) => index ? signal : {
        ...signal,
        sources: [{ publisher: "Unsafe", url: "http://example.com" }],
      }),
    }, "2026-07-24", new Date("2026-07-24T06:30:00+05:30"))).toBeNull();
  });

  it("rejects oversized briefing copy rather than partially rendering it", () => {
    expect(parseDailyBriefing({
      ...validArtifact,
      signals: validArtifact.signals.map((signal, index) => index ? signal : {
        ...signal,
        summary: "x".repeat(501),
      }),
    }, "2026-07-24", new Date("2026-07-24T06:30:00+05:30"))).toBeNull();
  });
});

describe("ambient weather mapping", () => {
  it("normalizes WMO weather codes and unknown values", () => {
    expect(normalizeWeatherCode(0)).toBe("clear");
    expect(normalizeWeatherCode(3)).toBe("cloud");
    expect(normalizeWeatherCode(45)).toBe("fog");
    expect(normalizeWeatherCode(61)).toBe("rain");
    expect(normalizeWeatherCode(75)).toBe("snow");
    expect(normalizeWeatherCode(96)).toBe("storm");
    expect(normalizeWeatherCode(500)).toBe("neutral");
    expect(conditionLabel("rain", 0.8)).toBe("light rain");
  });

  it("derives dawn, day, dusk and night without treating weather as a score", () => {
    expect(dayPhaseFor({ isDay: false, observedAt: "2026-07-24T22:00", sunrise: "2026-07-24T06:00", sunset: "2026-07-24T18:45" })).toBe("night");
    expect(dayPhaseFor({ isDay: true, observedAt: "2026-07-24T06:30", sunrise: "2026-07-24T06:00", sunset: "2026-07-24T18:45" })).toBe("dawn");
    expect(dayPhaseFor({ isDay: true, observedAt: "2026-07-24T12:00", sunrise: "2026-07-24T06:00", sunset: "2026-07-24T18:45" })).toBe("day");
    expect(dayPhaseFor({ isDay: true, observedAt: "2026-07-24T18:15", sunrise: "2026-07-24T06:00", sunset: "2026-07-24T18:45" })).toBe("dusk");
  });
});
