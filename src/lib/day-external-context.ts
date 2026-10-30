import { z } from "zod";

export const DAILY_CONTEXT_REPOSITORY = "TheInternetOfValue/value-log-daily-context";

export type AmbientCondition = "clear" | "cloud" | "fog" | "rain" | "storm" | "snow" | "neutral";
export type DayPhase = "dawn" | "day" | "dusk" | "night";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "URL must use HTTPS");
const sourceSchema = z.object({
  publisher: z.string().min(1).max(80),
  url: httpsUrl,
  published_at: z.string().datetime({ offset: true }).optional(),
}).strict();

const signalSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  rank: z.number().int().min(1).max(5),
  headline: z.string().min(1).max(180),
  summary: z.string().min(1).max(500),
  iov_reading: z.string().min(1).max(500).optional(),
  status: z.enum(["confirmed", "developing", "unconfirmed"]),
  sources: z.array(sourceSchema).min(1).max(6),
}).strict();

export const dailyBriefingArtifactSchema = z.object({
  schema_version: z.literal("value-log-daily-briefing-v1"),
  date: z.iso.date(),
  timezone: z.literal("Asia/Kolkata"),
  generated_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  title: z.string().min(1).max(120),
  full_briefing_url: httpsUrl.optional(),
  signals: z.array(signalSchema).min(3).max(5),
}).strict().superRefine((value, context) => {
  const ids = value.signals.map((signal) => signal.id);
  const ranks = value.signals.map((signal) => signal.rank);
  const expectedRanks = Array.from({ length: value.signals.length }, (_, index) => index + 1);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["signals"], message: "signal ids must be unique" });
  }
  if (new Set(ranks).size !== ranks.length || [...ranks].sort((a, b) => a - b).join("|") !== expectedRanks.join("|")) {
    context.addIssue({ code: "custom", path: ["signals"], message: "signal ranks must be unique and sequential" });
  }
  if (new Date(value.expires_at) <= new Date(value.generated_at)) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "expires_at must follow generated_at" });
  }
});

export type DailyBriefingArtifact = z.infer<typeof dailyBriefingArtifactSchema>;

export type DailyBriefingReading = {
  artifact: DailyBriefingArtifact;
  freshness: "fresh" | "stale";
  provenance: { path: string; blob_sha: string };
};

export type DayWeather = {
  location: string;
  timezone: string;
  temperatureC: number;
  apparentTemperatureC: number;
  cloudCover: number;
  precipitationMm: number;
  weatherCode: number;
  isDay: boolean;
  condition: AmbientCondition;
  conditionLabel: string;
  phase: DayPhase;
  observedAt: string;
  sunrise: string | null;
  sunset: string | null;
};

const WEATHER_LABELS: Record<AmbientCondition, string> = {
  clear: "clear",
  cloud: "cloudy",
  fog: "foggy",
  rain: "rain",
  storm: "thunderstorms",
  snow: "snow",
  neutral: "conditions unavailable",
};

export function normalizeWeatherCode(code: number): AmbientCondition {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  return "neutral";
}

export function conditionLabel(condition: AmbientCondition, precipitationMm: number) {
  if (condition === "rain" && precipitationMm > 0 && precipitationMm < 2.5) return "light rain";
  return WEATHER_LABELS[condition];
}

function minuteForLocalIso(value: string | null) {
  if (!value) return null;
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function dayPhaseFor({
  isDay,
  observedAt,
  sunrise,
  sunset,
}: {
  isDay: boolean;
  observedAt: string;
  sunrise: string | null;
  sunset: string | null;
}): DayPhase {
  if (!isDay) return "night";
  const observed = minuteForLocalIso(observedAt);
  const dawn = minuteForLocalIso(sunrise);
  const dusk = minuteForLocalIso(sunset);
  if (observed !== null && dawn !== null && observed <= dawn + 90) return "dawn";
  if (observed !== null && dusk !== null && observed >= dusk - 90) return "dusk";
  return "day";
}

export function parseDailyBriefing(
  value: unknown,
  expectedDate: string,
  now: Date = new Date(),
): { artifact: DailyBriefingArtifact; freshness: "fresh" | "stale" } | null {
  const parsed = dailyBriefingArtifactSchema.safeParse(value);
  if (!parsed.success || parsed.data.date !== expectedDate) return null;
  if (new Date(parsed.data.generated_at) > now) return null;
  return {
    artifact: parsed.data,
    freshness: new Date(parsed.data.expires_at) > now ? "fresh" : "stale",
  };
}
