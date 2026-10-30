import { localDateFor } from "./format";

export const VALUE_LOG_ANALYSIS_SCHEMA = "value-log-analysis-v1" as const;
export const CANONICAL_MEMBER_DID = "did:iov:member:10000000-0000-4000-8000-000000000001";
const TIMEZONE = "Asia/Kolkata";

export type AnalysisPeriodName = "week" | "previous_week" | "month";

export type AnalysisWindow = {
  name: AnalysisPeriodName;
  start_date: string;
  end_date: string;
  day_count: number;
};

export type AnalysisSlice = {
  id: string;
  start_at: string;
  end_at: string;
  timezone?: string | null;
  status: string;
  activity: string;
  wellbeing_node: string;
  community: string;
  sao_lane?: string | null;
  skill_level?: string | null;
};

export type AnalysisWEvent = {
  id: string;
  canonical_slice_id: string;
  pre_slice_w: number | string;
  post_slice_w: number | string;
  applied_change: number | string;
  cap_limited: boolean;
  start_at: string;
  end_at: string;
  timezone?: string | null;
  activity: string;
  wellbeing_node: string;
  community: string;
};

export type AnalysisCreditEvent = {
  id: string;
  canonical_slice_id: string;
  formula_result: number | string;
  start_at: string;
  end_at: string;
  timezone?: string | null;
  activity: string;
  wellbeing_node: string;
  community: string;
  sao_lane?: string | null;
  skill_level?: string | null;
};

export type AnalysisInput = {
  schema_version: "value-log-analysis-input-v1";
  verification: { canonical_did_count: number | string; member_count: number | string };
  slices: AnalysisSlice[];
  w_events: AnalysisWEvent[];
  credit_events: AnalysisCreditEvent[];
};

type DistributionRow = { key: string; activity_count: number; minutes: number; share_of_minutes: number | null };
type CreditRow = { community: string; lane: string; credits: number };
type DrilldownRow = {
  slice_id: string;
  start_at: string;
  activity: string;
  node: string;
  community: string;
  minutes: number;
  w_change: number;
  credits: number;
  reason: "largest_positive_w" | "largest_negative_w" | "largest_credits" | "longest_recorded_time";
};

export type PeriodAnalysis = {
  window: AnalysisWindow;
  coverage: { recorded_days: number; missing_dates: string[] };
  activity: { count: number; minutes: number; average_minutes_per_recorded_day: number | null };
  wellbeing_nodes: DistributionRow[];
  communities: DistributionRow[];
  pilot_w: {
    start: number | null;
    end: number | null;
    net: number;
    positive: number;
    negative: number;
    positive_days: number;
    negative_days: number;
    cap_limited_events: number;
  };
  performance: { total_credits: number; by_community_and_lane: CreditRow[] };
  data_quality: { non_calculated_slices: number; status_counts: Record<string, number> };
  drilldown: DrilldownRow[];
};

export type ValueLogAnalysis = {
  schema_version: typeof VALUE_LOG_ANALYSIS_SCHEMA;
  as_of: string;
  timezone: typeof TIMEZONE;
  generated_at: string;
  periods: { week: PeriodAnalysis; previous_week: PeriodAnalysis; month: PeriodAnalysis };
  comparisons: {
    week_vs_previous: {
      activity_count_change: number;
      recorded_minutes_change: number;
      recorded_minutes_percent_change: number | null;
      pilot_w_net_change: number;
      performance_credits_change: number;
    };
    week_share_of_month: { activity_count_percent: number | null; recorded_minutes_percent: number | null };
  };
  notes: string[];
};

export function analysisWindows(asOf: string) {
  assertDate(asOf);
  const weekStart = addDateDays(asOf, -6);
  const previousEnd = addDateDays(weekStart, -1);
  const previousStart = addDateDays(weekStart, -7);
  const monthStart = `${asOf.slice(0, 8)}01`;
  return {
    week: window("week", weekStart, asOf),
    previous_week: window("previous_week", previousStart, previousEnd),
    month: window("month", monthStart, asOf),
    query_start: [previousStart, monthStart].sort()[0],
    query_end_exclusive: addDateDays(asOf, 1),
  };
}

export function validateProductionBinding(input: AnalysisInput) {
  if (Number(input.verification?.canonical_did_count) !== 1 || Number(input.verification?.member_count) !== 1) {
    throw new Error("Linked Supabase project did not match the single-member canonical Value Log binding; analysis stopped.");
  }
}

export function buildValueLogAnalysis(input: AnalysisInput, asOf: string, generatedAt = new Date().toISOString()): ValueLogAnalysis {
  validateProductionBinding(input);
  const windows = analysisWindows(asOf);
  const week = aggregatePeriod(input, windows.week);
  const previous = aggregatePeriod(input, windows.previous_week);
  const month = aggregatePeriod(input, windows.month);
  return {
    schema_version: VALUE_LOG_ANALYSIS_SCHEMA,
    as_of: asOf,
    timezone: TIMEZONE,
    generated_at: generatedAt,
    periods: { week, previous_week: previous, month },
    comparisons: {
      week_vs_previous: {
        activity_count_change: week.activity.count - previous.activity.count,
        recorded_minutes_change: round(week.activity.minutes - previous.activity.minutes),
        recorded_minutes_percent_change: percentChange(week.activity.minutes, previous.activity.minutes),
        pilot_w_net_change: round(week.pilot_w.net - previous.pilot_w.net, 6),
        performance_credits_change: round(week.performance.total_credits - previous.performance.total_credits, 6),
      },
      week_share_of_month: {
        activity_count_percent: share(week.activity.count, month.activity.count),
        recorded_minutes_percent: share(week.activity.minutes, month.activity.minutes),
      },
    },
    notes: [
      "Recorded activity, Pilot W movement, and Performance credits are separate measures and are not combined into a score.",
      "This report describes recorded patterns only; it does not establish causes or provide a clinical interpretation.",
      "Activity and credits use the slice start date; Pilot W uses the canonical settlement end date in Asia/Kolkata.",
    ],
  };
}

function aggregatePeriod(input: AnalysisInput, target: AnalysisWindow): PeriodAnalysis {
  const slices = input.slices.filter((slice) => dateInWindow(localDateFor(slice.start_at, slice.timezone ?? TIMEZONE), target));
  const calculated = slices.filter((slice) => slice.status === "calculated");
  const wEvents = input.w_events
    .filter((event) => dateInWindow(localDateFor(event.end_at, event.timezone ?? TIMEZONE), target))
    .sort((a, b) => a.end_at.localeCompare(b.end_at));
  const creditEvents = input.credit_events.filter((event) => dateInWindow(localDateFor(event.start_at, event.timezone ?? TIMEZONE), target));
  const recordedDates = new Set(calculated.map((slice) => localDateFor(slice.start_at, slice.timezone ?? TIMEZONE)));
  const minutes = calculated.reduce((total, slice) => total + durationMinutes(slice.start_at, slice.end_at), 0);
  const statusCounts = slices.reduce<Record<string, number>>((counts, slice) => {
    if (slice.status !== "calculated") counts[slice.status] = (counts[slice.status] ?? 0) + 1;
    return counts;
  }, {});
  const dailyW = new Map<string, number>();
  for (const event of wEvents) {
    const date = localDateFor(event.end_at, event.timezone ?? TIMEZONE);
    dailyW.set(date, (dailyW.get(date) ?? 0) + number(event.applied_change));
  }
  const activeDays = dateRange(target.start_date, target.end_date);
  return {
    window: target,
    coverage: { recorded_days: recordedDates.size, missing_dates: activeDays.filter((date) => !recordedDates.has(date)) },
    activity: {
      count: calculated.length,
      minutes: round(minutes),
      average_minutes_per_recorded_day: recordedDates.size ? round(minutes / recordedDates.size) : null,
    },
    wellbeing_nodes: distribution(calculated, minutes, (slice) => slice.wellbeing_node),
    communities: distribution(calculated, minutes, (slice) => slice.community),
    pilot_w: {
      start: wEvents.length ? number(wEvents[0].pre_slice_w) : null,
      end: wEvents.length ? number(wEvents.at(-1)!.post_slice_w) : null,
      net: round(wEvents.reduce((total, event) => total + number(event.applied_change), 0), 6),
      positive: round(wEvents.reduce((total, event) => total + Math.max(0, number(event.applied_change)), 0), 6),
      negative: round(wEvents.reduce((total, event) => total + Math.min(0, number(event.applied_change)), 0), 6),
      positive_days: [...dailyW.values()].filter((value) => value > 0).length,
      negative_days: [...dailyW.values()].filter((value) => value < 0).length,
      cap_limited_events: wEvents.filter((event) => event.cap_limited).length,
    },
    performance: {
      total_credits: round(creditEvents.reduce((total, event) => total + number(event.formula_result), 0), 6),
      by_community_and_lane: creditDistribution(creditEvents),
    },
    data_quality: { non_calculated_slices: Object.values(statusCounts).reduce((total, count) => total + count, 0), status_counts: statusCounts },
    drilldown: drilldown(calculated, wEvents, creditEvents),
  };
}

function distribution(slices: AnalysisSlice[], totalMinutes: number, keyFor: (slice: AnalysisSlice) => string): DistributionRow[] {
  const rows = new Map<string, { count: number; minutes: number }>();
  for (const slice of slices) {
    const key = keyFor(slice);
    const row = rows.get(key) ?? { count: 0, minutes: 0 };
    row.count += 1;
    row.minutes += durationMinutes(slice.start_at, slice.end_at);
    rows.set(key, row);
  }
  return [...rows.entries()].map(([key, row]) => ({
    key,
    activity_count: row.count,
    minutes: round(row.minutes),
    share_of_minutes: share(row.minutes, totalMinutes),
  })).sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key));
}

function creditDistribution(events: AnalysisCreditEvent[]): CreditRow[] {
  const rows = new Map<string, number>();
  for (const event of events) {
    const key = `${event.community}\u0000${event.sao_lane ?? "Unspecified"}`;
    rows.set(key, (rows.get(key) ?? 0) + number(event.formula_result));
  }
  return [...rows.entries()].map(([key, credits]) => {
    const [community, lane] = key.split("\u0000");
    return { community, lane, credits: round(credits, 6) };
  }).sort((a, b) => b.credits - a.credits || a.community.localeCompare(b.community));
}

function drilldown(slices: AnalysisSlice[], wEvents: AnalysisWEvent[], creditEvents: AnalysisCreditEvent[]): DrilldownRow[] {
  type Candidate = Omit<DrilldownRow, "reason"> & { activity_in_period: boolean };
  const rows = new Map<string, Candidate>();
  const ensure = (id: string, fallback: AnalysisSlice | AnalysisWEvent | AnalysisCreditEvent, activityInPeriod = false) => {
    const existing = rows.get(id);
    if (existing) {
      if (activityInPeriod) existing.activity_in_period = true;
      return existing;
    }
    const slice = slices.find((item) => item.id === id);
    const source = slice ?? fallback;
    const row = {
      slice_id: id,
      start_at: source.start_at,
      activity: source.activity,
      node: source.wellbeing_node,
      community: source.community,
      minutes: durationMinutes(source.start_at, source.end_at),
      w_change: 0,
      credits: 0,
      activity_in_period: activityInPeriod,
    };
    rows.set(id, row);
    return row;
  };
  for (const slice of slices) ensure(slice.id, slice, true);
  for (const event of wEvents) ensure(event.canonical_slice_id, event).w_change += number(event.applied_change);
  for (const event of creditEvents) ensure(event.canonical_slice_id, event).credits += number(event.formula_result);
  const values = [...rows.values()];
  const picked = new Map<string, DrilldownRow>();
  const pick = (reason: DrilldownRow["reason"], sorted: typeof values) => {
    const row = sorted.find((candidate) => !picked.has(candidate.slice_id));
    if (row) {
      picked.set(row.slice_id, {
        slice_id: row.slice_id, start_at: row.start_at, activity: row.activity,
        node: row.node, community: row.community, minutes: round(row.minutes),
        w_change: round(row.w_change, 6), credits: round(row.credits, 6), reason,
      });
    }
  };
  pick("largest_positive_w", values.filter((row) => row.w_change > 0).sort((a, b) => b.w_change - a.w_change));
  pick("largest_negative_w", values.filter((row) => row.w_change < 0).sort((a, b) => a.w_change - b.w_change));
  pick("largest_credits", values.filter((row) => row.credits > 0).sort((a, b) => b.credits - a.credits));
  pick("longest_recorded_time", values.filter((row) => row.activity_in_period).sort((a, b) => b.minutes - a.minutes));
  return [...picked.values()].sort((a, b) => a.start_at.localeCompare(b.start_at));
}

function window(name: AnalysisPeriodName, start_date: string, end_date: string): AnalysisWindow {
  return { name, start_date, end_date, day_count: dateRange(start_date, end_date).length };
}

function dateInWindow(date: string, target: AnalysisWindow) { return date >= target.start_date && date <= target.end_date; }
function durationMinutes(start: string, end: string) { return Math.max(0, (Date.parse(end) - Date.parse(start)) / 60_000); }
function number(value: number | string) { return Number(value); }
function share(part: number, total: number) { return total ? round((part / total) * 100, 2) : null; }
function percentChange(current: number, previous: number) { return previous ? round(((current - previous) / previous) * 100, 2) : null; }
function round(value: number, digits = 2) { return Number(value.toFixed(digits)); }
function assertDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || dateKey(parseDate(value)) !== value) throw new Error(`Invalid --as-of date: ${value}`);
}
function parseDate(value: string) { return new Date(`${value}T12:00:00Z`); }
function dateKey(value: Date) { return value.toISOString().slice(0, 10); }
function addDateDays(value: string, days: number) { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + days); return dateKey(date); }
function dateRange(start: string, end: string) { const dates: string[] = []; for (let date = start; date <= end; date = addDateDays(date, 1)) dates.push(date); return dates; }
