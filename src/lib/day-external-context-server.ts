import "server-only";

import { unstable_cache } from "next/cache";
import {
  DAILY_CONTEXT_REPOSITORY,
  conditionLabel,
  dayPhaseFor,
  normalizeWeatherCode,
  parseDailyBriefing,
  type DailyBriefingReading,
  type DayWeather,
} from "@/lib/day-external-context";

type Fetcher = typeof fetch;
type GitHubDirectoryItem = {
  name?: string;
  path?: string;
  sha?: string;
  type?: string;
  encoding?: string;
  content?: string;
};

type WeatherResponse = {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    cloud_cover?: number;
    weather_code?: number;
    is_day?: number;
  };
  daily?: { sunrise?: string[]; sunset?: string[] };
};

const FETCH_TIMEOUT_MS = 2_000;

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "iov-value-log-daily-context",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function githubContentsUrl(path: string) {
  return `https://api.github.com/repos/${DAILY_CONTEXT_REPOSITORY}/contents/${path}`;
}

async function fetchJson(response: Response) {
  if (!response.ok) return null;
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

export async function readDailyBriefing(
  date: string,
  token: string,
  fetcher: Fetcher = fetch,
  now: Date = new Date(),
): Promise<DailyBriefingReading | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    const directoryResponse = await fetcher(githubContentsUrl(`briefings/${date}`), {
      headers: githubHeaders(token),
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const directory = await fetchJson(directoryResponse);
    if (!Array.isArray(directory)) return null;
    const candidates = (directory as GitHubDirectoryItem[])
      .filter((item) => item.type === "file" && item.name?.endsWith(".json") && item.path && item.sha)
      .sort((left, right) => (right.name ?? "").localeCompare(left.name ?? ""))
      .slice(0, 10);

    for (const candidate of candidates) {
      const contentResponse = await fetcher(githubContentsUrl(candidate.path!), {
        headers: githubHeaders(token),
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const content = await fetchJson(contentResponse) as GitHubDirectoryItem | null;
      if (!content || content.encoding !== "base64" || typeof content.content !== "string") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.from(content.content, "base64").toString("utf8"));
      } catch {
        continue;
      }
      const parsed = parseDailyBriefing(raw, date, now);
      if (!parsed) continue;
      return {
        ...parsed,
        provenance: { path: candidate.path!, blob_sha: candidate.sha!.slice(0, 12) },
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function readCurrentWeather(
  {
    latitude,
    location,
    longitude,
    timezone,
  }: {
    latitude: number;
    location: string;
    longitude: number;
    timezone: string;
  },
  fetcher: Fetcher = fetch,
): Promise<DayWeather | null> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,cloud_cover,weather_code,is_day");
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", timezone);
    const response = await fetcher(url, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const raw = await fetchJson(response) as WeatherResponse | null;
    const current = raw?.current;
    if (
      !current
      || typeof current.time !== "string"
      || typeof current.temperature_2m !== "number"
      || typeof current.apparent_temperature !== "number"
      || typeof current.precipitation !== "number"
      || typeof current.cloud_cover !== "number"
      || typeof current.weather_code !== "number"
      || typeof current.is_day !== "number"
    ) return null;
    const condition = normalizeWeatherCode(current.weather_code);
    const sunrise = raw?.daily?.sunrise?.[0] ?? null;
    const sunset = raw?.daily?.sunset?.[0] ?? null;
    const isDay = current.is_day === 1;
    return {
      location,
      timezone: raw?.timezone ?? timezone,
      temperatureC: current.temperature_2m,
      apparentTemperatureC: current.apparent_temperature,
      cloudCover: current.cloud_cover,
      precipitationMm: current.precipitation,
      weatherCode: current.weather_code,
      isDay,
      condition,
      conditionLabel: conditionLabel(condition, current.precipitation),
      phase: dayPhaseFor({ isDay, observedAt: current.time, sunrise, sunset }),
      observedAt: current.time,
      sunrise,
      sunset,
    };
  } catch {
    return null;
  }
}

const readConfiguredBriefing = unstable_cache(async (date: string) => {
  const token = process.env.VALUE_LOG_CONTEXT_GITHUB_TOKEN;
  return token ? readDailyBriefing(date, token) : null;
}, ["value-log-daily-briefing-v1"], { revalidate: 300 });

const readConfiguredWeather = unstable_cache(async () => {
  const location = process.env.DAY_CONTEXT_LOCATION_NAME;
  const latitude = Number(process.env.DAY_CONTEXT_LATITUDE);
  const longitude = Number(process.env.DAY_CONTEXT_LONGITUDE);
  const timezone = process.env.DAY_CONTEXT_TIMEZONE;
  if (!location || !timezone || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return readCurrentWeather({ latitude, location, longitude, timezone });
}, ["value-log-day-weather-v1"], { revalidate: 600 });

export function dailyBriefingForDate(date: string) {
  return readConfiguredBriefing(date);
}

export function weatherAppliesToDate(date: string, today: string) {
  return date === today;
}

export function weatherForDate(date: string, today: string) {
  return weatherAppliesToDate(date, today) ? readConfiguredWeather() : Promise.resolve(null);
}
