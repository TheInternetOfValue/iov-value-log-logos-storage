import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readCurrentWeather,
  readDailyBriefing,
  weatherAppliesToDate,
} from "./day-external-context-server";

const artifact = {
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
};

function response(value: unknown, ok = true) {
  return { ok, json: async () => value } as Response;
}

describe("external day context readers", () => {
  it("chooses the newest valid immutable briefing and preserves provenance", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([
        { name: "2026-07-24T05-00-00Z.json", path: "briefings/2026-07-24/2026-07-24T05-00-00Z.json", sha: "oldsha", type: "file" },
        { name: "2026-07-24T06-00-00Z.json", path: "briefings/2026-07-24/2026-07-24T06-00-00Z.json", sha: "newsha123456789", type: "file" },
      ]))
      .mockResolvedValueOnce(response({ encoding: "base64", content: Buffer.from(JSON.stringify(artifact)).toString("base64") }));
    const reading = await readDailyBriefing("2026-07-24", "token", fetcher, new Date("2026-07-24T06:30:00+05:30"));
    expect(reading?.artifact.title).toBe("Morning briefing");
    expect(reading?.provenance.path).toContain("06-00-00Z");
    expect(reading?.provenance.blob_sha).toBe("newsha123456");
  });

  it("fails closed when GitHub or artifact parsing fails", async () => {
    expect(await readDailyBriefing("2026-07-24", "token", vi.fn().mockResolvedValue(response({}, false)))).toBeNull();
  });

  it("falls back to an earlier valid immutable run when the newest artifact is invalid", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([
        { name: "2026-07-24T05-00-00Z.json", path: "briefings/2026-07-24/2026-07-24T05-00-00Z.json", sha: "oldvalidsha", type: "file" },
        { name: "2026-07-24T06-00-00Z.json", path: "briefings/2026-07-24/2026-07-24T06-00-00Z.json", sha: "newinvalidsha", type: "file" },
      ]))
      .mockResolvedValueOnce(response({ encoding: "base64", content: Buffer.from("{invalid").toString("base64") }))
      .mockResolvedValueOnce(response({ encoding: "base64", content: Buffer.from(JSON.stringify(artifact)).toString("base64") }));
    const reading = await readDailyBriefing("2026-07-24", "token", fetcher, new Date("2026-07-24T06:30:00+05:30"));
    expect(reading?.provenance.path).toContain("05-00-00Z");
    expect(reading?.provenance.blob_sha).toBe("oldvalidsha");
  });

  it("maps current Open-Meteo data into a bounded weather reading", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      timezone: "Asia/Kolkata",
      current: {
        time: "2026-07-24T06:30",
        temperature_2m: 24.2,
        apparent_temperature: 25.1,
        precipitation: 0.8,
        cloud_cover: 88,
        weather_code: 61,
        is_day: 1,
      },
      daily: { sunrise: ["2026-07-24T06:00"], sunset: ["2026-07-24T18:45"] },
    }));
    const weather = await readCurrentWeather({
      latitude: 12.97,
      longitude: 77.59,
      location: "Bengaluru",
      timezone: "Asia/Kolkata",
    }, fetcher);
    expect(weather).toMatchObject({ condition: "rain", conditionLabel: "light rain", phase: "dawn", location: "Bengaluru" });
  });

  it("allows current weather only for the selected local today", () => {
    expect(weatherAppliesToDate("2026-07-24", "2026-07-24")).toBe(true);
    expect(weatherAppliesToDate("2026-07-23", "2026-07-24")).toBe(false);
  });
});
