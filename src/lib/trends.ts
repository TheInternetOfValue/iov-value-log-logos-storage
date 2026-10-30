import { localDateFor } from "./format";
import type { CommunityCode } from "./community-value";
import type { WellbeingNode } from "./domain";
import { buildDailyMovementProjection, type DailyMovementProjection } from "./day-movement";
import { formatWMovement } from "./w-presentation";

export const TREND_RANGES = [7, 14, 30] as const;

export type TrendRange = (typeof TREND_RANGES)[number];

export const INSIGHT_NODE_ORDER = [
  "Physiology", "Emotion", "Feeling", "Thought", "Habit", "Performance",
] as const satisfies readonly WellbeingNode[];

export type InsightNode = (typeof INSIGHT_NODE_ORDER)[number];

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type TrendSlice = {
  id: string;
  start_at: string;
  end_at: string;
  timezone?: string | null;
  status: string;
  slice_type: string;
  community: CommunityCode;
  activity?: string | null;
  wellbeing_node?: InsightNode | string | null;
  sao_lane?: string | null;
  skill_level?: string | null;
};

type TrendSliceRelation = {
  id?: string | null;
  start_at: string;
  end_at: string;
  timezone?: string | null;
  community: CommunityCode;
  activity?: string | null;
  wellbeing_node?: InsightNode | string | null;
  sao_lane?: string | null;
  skill_level?: string | null;
};

export type TrendWEvent = {
  id: string;
  canonical_slice_id?: string | null;
  pre_slice_w: number | string;
  post_slice_w: number | string;
  applied_change: number | string;
  canonical_slices: TrendSliceRelation | TrendSliceRelation[] | null;
};

export type TrendCreditEvent = {
  id: string;
  canonical_slice_id?: string | null;
  formula_result: number | string;
  canonical_slices: TrendSliceRelation | TrendSliceRelation[] | null;
};

export type TrendDailyRow = {
  date: string;
  logged_minutes: number;
  activity_count: number;
  w_start: number | null;
  w_end: number | null;
  w_net: number;
  w_positive: number;
  w_negative: number;
  house_of_bros_w_net: number;
  house_of_bros_minutes: number;
  iov_credits: number;
  iov_minutes: number;
  gfe_credits: number;
  gfe_minutes: number;
  pending_count: number;
  needs_attention_count: number;
};

export type TrendSeries = {
  range_days: TrendRange;
  start_date: string;
  end_date: string;
  rows: TrendDailyRow[];
  totals: {
    logged_days: number;
    logged_minutes: number;
    activity_count: number;
    pending_count: number;
    needs_attention_count: number;
    w_start: number | null;
    w_end: number | null;
    w_net: number;
    w_positive: number;
    w_negative: number;
    house_of_bros_w_net: number;
    house_of_bros_minutes: number;
    iov_credits: number;
    iov_minutes: number;
    gfe_credits: number;
    gfe_minutes: number;
  };
};

export type InsightWeaveStitch = {
  id: string;
  activity: string;
  node: InsightNode;
  community: CommunityCode;
  start_at: string;
  end_at: string;
  timezone: string;
  start_date: string;
  settlement_date: string;
  minutes: number;
  w_change: number | null;
  credits: number | null;
  sao_lane: string | null;
  skill_level: string | null;
};

export type InsightWeaveLane = {
  node: InsightNode;
  stitches: InsightWeaveStitch[];
  activity_count: number;
  logged_minutes: number;
  w_net: number;
  credits: number;
};

export type InsightWeaveSeries = {
  start_date: string;
  end_date: string;
  range_days: TrendRange;
  lanes: InsightWeaveLane[];
};

export type IntraDayWPoint = {
  timestamp: string;
  value: number;
  change: number;
  label: "opening" | "transition";
};

export type IntraDayWSeries = {
  date: string;
  projection: DailyMovementProjection;
  opening_w: number | null;
  closing_w: number | null;
  positive_w: number;
  negative_w: number;
  points: IntraDayWPoint[];
};

export function deterministicInsightSummary(series: TrendSeries) {
  const totals = series.totals;
  const totalCredits = totals.iov_credits + totals.gfe_credits;
  const sentences = [`${totals.logged_days} of ${series.range_days} days were recorded, covering ${totals.activity_count} ${totals.activity_count === 1 ? "activity" : "activities"} and ${durationText(totals.logged_minutes)}.`];
  if (totals.w_start !== null && totals.w_end !== null) sentences.push(`Wellbeing movement was ${formatWMovement(totals.w_net)}.`);
  if (totalCredits > 0) {
    if (Math.abs(totals.iov_credits - totals.gfe_credits) < 0.000001) sentences.push(`Performance contribution was split evenly between IoV and GFE at ${wholeNumber(totalCredits)} credits in total.`);
    else {
      const leader = totals.iov_credits > totals.gfe_credits ? "IoV" : "GFE";
      const value = Math.max(totals.iov_credits, totals.gfe_credits);
      sentences.push(`Most Performance contribution was routed to ${leader}: ${wholeNumber(value)} credits.`);
    }
  } else sentences.push("No calculated Performance contribution appears in this period.");
  return sentences.join(" ");
}

function wholeNumber(value: number) {
  return Math.round(value).toLocaleString("en-IN");
}

function durationText(totalMinutes: number) {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (!hours) return `${minutes} min recorded`;
  return `${hours} hr${minutes ? ` ${minutes} min` : ""} recorded`;
}

export function normalizeTrendRange(value: string | number | null | undefined): TrendRange {
  const numeric = Number(value);
  if (TREND_RANGES.includes(numeric as TrendRange)) {
    return numeric as TrendRange;
  }
  return 7;
}

export function trendStartDate(endDate: string, rangeDays: TrendRange): string {
  return dateKey(addDays(parseDate(endDate), -(rangeDays - 1)));
}

export function buildTrendSeries(input: {
  endDate: string;
  rangeDays: TrendRange;
  slices: TrendSlice[];
  wEvents: TrendWEvent[];
  wReversalIds?: Set<string> | string[];
  creditEvents: TrendCreditEvent[];
  creditReversalIds?: Set<string> | string[];
}): TrendSeries {
  const startDate = trendStartDate(input.endDate, input.rangeDays);
  const dates = dateRange(startDate, input.endDate);
  const rows = new Map<string, TrendDailyRow>();
  const wReversals = toSet(input.wReversalIds);
  const creditReversals = toSet(input.creditReversalIds);

  for (const date of dates) {
    rows.set(date, emptyRow(date));
  }

  for (const slice of input.slices) {
    const date = localDateFor(slice.start_at, slice.timezone ?? DEFAULT_TIMEZONE);
    const row = rows.get(date);
    if (!row) continue;

    row.logged_minutes += durationMinutes(slice.start_at, slice.end_at);
    row.activity_count += 1;

    if (slice.status !== "calculated") {
      row.needs_attention_count += 1;
    }

    if (["drafted", "observer_approved", "validation_pending"].includes(slice.status)) {
      row.pending_count += 1;
    }
  }

  const activeWEvents = input.wEvents
    .filter((event) => !wReversals.has(event.id))
    .map((event) => ({ event, relation: firstRelation(event.canonical_slices) }))
    .filter((item): item is { event: TrendWEvent; relation: TrendSliceRelation } => Boolean(item.relation))
    .sort((a, b) => a.relation.end_at.localeCompare(b.relation.end_at));

  for (const { event, relation } of activeWEvents) {
    const date = localDateFor(relation.end_at, relation.timezone ?? DEFAULT_TIMEZONE);
    const row = rows.get(date);
    if (!row) continue;

    const change = toNumber(event.applied_change);
    if (row.w_start === null) {
      row.w_start = toNumber(event.pre_slice_w);
    }
    row.w_end = toNumber(event.post_slice_w);
    row.w_net += change;
    if (change > 0) row.w_positive += change;
    if (change < 0) row.w_negative += change;

    if (relation.community === "house_of_bros") {
      row.house_of_bros_w_net += change;
      row.house_of_bros_minutes += durationMinutes(relation.start_at, relation.end_at);
    }
  }

  const activeCreditEvents = input.creditEvents
    .filter((event) => !creditReversals.has(event.id))
    .map((event) => ({ event, relation: firstRelation(event.canonical_slices) }))
    .filter((item): item is { event: TrendCreditEvent; relation: TrendSliceRelation } => Boolean(item.relation));

  for (const { event, relation } of activeCreditEvents) {
    const date = localDateFor(relation.start_at, relation.timezone ?? DEFAULT_TIMEZONE);
    const row = rows.get(date);
    if (!row) continue;

    const credits = toNumber(event.formula_result);
    const minutes = durationMinutes(relation.start_at, relation.end_at);

    if (relation.community === "iov") {
      row.iov_credits += credits;
      row.iov_minutes += minutes;
    }

    if (relation.community === "gfe") {
      row.gfe_credits += credits;
      row.gfe_minutes += minutes;
    }
  }

  const orderedRows = Array.from(rows.values());
  const firstWRow = orderedRows.find((row) => row.w_start !== null);
  const lastWRow = [...orderedRows].reverse().find((row) => row.w_end !== null);

  return {
    range_days: input.rangeDays,
    start_date: startDate,
    end_date: input.endDate,
    rows: orderedRows,
    totals: {
      logged_days: orderedRows.filter((row) => row.activity_count > 0).length,
      logged_minutes: sum(orderedRows, "logged_minutes"),
      activity_count: sum(orderedRows, "activity_count"),
      pending_count: sum(orderedRows, "pending_count"),
      needs_attention_count: sum(orderedRows, "needs_attention_count"),
      w_start: firstWRow?.w_start ?? null,
      w_end: lastWRow?.w_end ?? null,
      w_net: sum(orderedRows, "w_net"),
      w_positive: sum(orderedRows, "w_positive"),
      w_negative: sum(orderedRows, "w_negative"),
      house_of_bros_w_net: sum(orderedRows, "house_of_bros_w_net"),
      house_of_bros_minutes: sum(orderedRows, "house_of_bros_minutes"),
      iov_credits: sum(orderedRows, "iov_credits"),
      iov_minutes: sum(orderedRows, "iov_minutes"),
      gfe_credits: sum(orderedRows, "gfe_credits"),
      gfe_minutes: sum(orderedRows, "gfe_minutes"),
    },
  };
}

export function buildInsightWeaveSeries(input: {
  endDate: string;
  rangeDays: TrendRange;
  slices: TrendSlice[];
  wEvents: TrendWEvent[];
  wReversalIds?: Set<string> | string[];
  creditEvents: TrendCreditEvent[];
  creditReversalIds?: Set<string> | string[];
}): InsightWeaveSeries {
  const startDate = trendStartDate(input.endDate, input.rangeDays);
  const wReversals = toSet(input.wReversalIds);
  const creditReversals = toSet(input.creditReversalIds);
  const stitches = new Map<string, InsightWeaveStitch>();

  const addRelation = (relation: TrendSlice | TrendSliceRelation, fallbackId?: string | null) => {
    const id = "id" in relation ? relation.id ?? fallbackId : fallbackId;
    const node = insightNode(relation.wellbeing_node);
    if (!id || !node) return null;
    const timezone = relation.timezone ?? DEFAULT_TIMEZONE;
    const startDateForSlice = localDateFor(relation.start_at, timezone);
    const settlementDate = localDateFor(relation.end_at, timezone);
    const existing = stitches.get(id);
    if (existing) return existing;
    const stitch: InsightWeaveStitch = {
      id,
      activity: relation.activity?.trim() || "Recorded activity",
      node,
      community: relation.community,
      start_at: relation.start_at,
      end_at: relation.end_at,
      timezone,
      start_date: startDateForSlice,
      settlement_date: settlementDate,
      minutes: durationMinutes(relation.start_at, relation.end_at),
      w_change: null,
      credits: null,
      sao_lane: relation.sao_lane ?? null,
      skill_level: relation.skill_level ?? null,
    };
    stitches.set(id, stitch);
    return stitch;
  };

  input.slices.forEach((slice) => addRelation(slice, slice.id));

  input.wEvents
    .filter((event) => !wReversals.has(event.id))
    .forEach((event) => {
      const relation = firstRelation(event.canonical_slices);
      if (!relation) return;
      const stitch = addRelation(relation, event.canonical_slice_id);
      if (stitch) stitch.w_change = toNumber(event.applied_change);
    });

  input.creditEvents
    .filter((event) => !creditReversals.has(event.id))
    .forEach((event) => {
      const relation = firstRelation(event.canonical_slices);
      if (!relation) return;
      const stitch = addRelation(relation, event.canonical_slice_id);
      if (stitch) stitch.credits = toNumber(event.formula_result);
    });

  return {
    start_date: startDate,
    end_date: input.endDate,
    range_days: input.rangeDays,
    lanes: INSIGHT_NODE_ORDER.map((node) => {
      const nodeStitches = [...stitches.values()]
        .filter((stitch) => stitch.node === node && stitch.settlement_date >= startDate && stitch.start_date <= input.endDate)
        .sort((a, b) => a.start_at.localeCompare(b.start_at));
      const startedInRange = nodeStitches.filter((stitch) => stitch.start_date >= startDate && stitch.start_date <= input.endDate);
      return {
        node,
        stitches: nodeStitches,
        activity_count: startedInRange.length,
        logged_minutes: startedInRange.reduce((total, stitch) => total + stitch.minutes, 0),
        w_net: nodeStitches.reduce((total, stitch) => total + (stitch.w_change ?? 0), 0),
        credits: startedInRange.reduce((total, stitch) => total + (stitch.credits ?? 0), 0),
      };
    }),
  };
}

export function buildIntraDayWSeries(input: {
  date: string;
  wEvents: TrendWEvent[];
  wReversalIds?: Set<string> | string[];
}): IntraDayWSeries {
  const reversals = toSet(input.wReversalIds);
  const events = input.wEvents
    .filter((event) => !reversals.has(event.id))
    .map((event) => ({ event, relation: firstRelation(event.canonical_slices) }))
    .filter((item): item is { event: TrendWEvent; relation: TrendSliceRelation } => {
      if (!item.relation) return false;
      return localDateFor(item.relation.end_at, item.relation.timezone ?? DEFAULT_TIMEZONE) === input.date;
    })
    .sort((a, b) => a.relation.end_at.localeCompare(b.relation.end_at));

  if (!events.length) {
    return { date: input.date, projection: buildDailyMovementProjection({ events: [] }), opening_w: null, closing_w: null, positive_w: 0, negative_w: 0, points: [] };
  }

  const projection = buildDailyMovementProjection({ events: events.map(({ event, relation }) => ({
    id: event.id,
    settledAt: relation.end_at,
    preW: event.pre_slice_w,
    change: event.applied_change,
    postW: event.post_slice_w,
  })) });
  const first = events[0];
  const points: IntraDayWPoint[] = [{
    timestamp: first.relation.end_at,
    value: toNumber(first.event.pre_slice_w),
    change: 0,
    label: "opening",
  }];
  let positive_w = 0;
  let negative_w = 0;
  for (const { event, relation } of events) {
    const change = toNumber(event.applied_change);
    if (change > 0) positive_w += change;
    if (change < 0) negative_w += change;
    points.push({ timestamp: relation.end_at, value: toNumber(event.post_slice_w), change, label: "transition" });
  }

  return {
    date: input.date,
    projection,
    opening_w: points[0].value,
    closing_w: points.at(-1)?.value ?? null,
    positive_w,
    negative_w,
    points,
  };
}

function emptyRow(date: string): TrendDailyRow {
  return {
    date,
    logged_minutes: 0,
    activity_count: 0,
    w_start: null,
    w_end: null,
    w_net: 0,
    w_positive: 0,
    w_negative: 0,
    house_of_bros_w_net: 0,
    house_of_bros_minutes: 0,
    iov_credits: 0,
    iov_minutes: 0,
    gfe_credits: 0,
    gfe_minutes: 0,
    pending_count: 0,
    needs_attention_count: 0,
  };
}

function firstRelation(
  relation: TrendSliceRelation | TrendSliceRelation[] | null,
): TrendSliceRelation | null {
  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }
  return relation;
}

function toSet(value: Set<string> | string[] | undefined): Set<string> {
  if (value instanceof Set) return value;
  return new Set(value ?? []);
}

function toNumber(value: number | string): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function insightNode(value: string | null | undefined): InsightNode | null {
  return INSIGHT_NODE_ORDER.includes(value as InsightNode) ? value as InsightNode : null;
}

function durationMinutes(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  return Math.round((endMs - startMs) / 60000);
}

function sum<K extends keyof TrendDailyRow>(rows: TrendDailyRow[], key: K): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function dateRange(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(dateKey(cursor));
  }

  return dates;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
