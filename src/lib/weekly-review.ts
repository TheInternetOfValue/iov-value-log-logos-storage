import { z } from "zod";
import type { CampaignMap } from "./campaign-direction";

export const WEEKLY_REVIEW_TIMEZONE = "Asia/Kolkata" as const;
export const WEEKLY_REVIEW_GENERATOR_VERSION = "weekly-review-evidence-v1";

export type WeeklyReviewWindows = {
  week_start: string;
  week_end: string;
  previous_start: string;
  previous_end: string;
  next_monday: string;
  next_friday: string;
  query_start: string;
  query_end_exclusive: string;
};

export type WeeklySlice = {
  id: string; protocol_link_id: string; revision_number: number;
  start_at: string; end_at: string; timezone?: string | null; status: string;
  activity: string; proof?: string | null; wellbeing_node: string; community: string;
  sao_lane?: string | null; skill_level?: string | null;
  impact_direction?: string | null; impact_intensity?: string | null; confidence?: string | null;
};
export type WeeklyWEvent = {
  id: string; canonical_slice_id: string; pre_slice_w: number | string; post_slice_w: number | string;
  applied_change: number | string; cap_limited: boolean; event_kind: string; reversal_of?: string | null;
  end_at: string; replay_status: string;
};
export type WeeklyCreditEvent = {
  id: string; canonical_slice_id: string; formula_result: number | string; event_kind: string;
  reversal_of?: string | null; start_at: string; community: string; sao_lane?: string | null; replay_status: string;
};
export type WeeklyCampaignOutcome = { occurred_at: string; summary: string; movements: Array<{ label: string; unit: string; delta: number }> };

type EvidenceInput = {
  slices: WeeklySlice[];
  w_events: WeeklyWEvent[];
  credit_events: WeeklyCreditEvent[];
  campaign_outcomes: WeeklyCampaignOutcome[];
  campaign_map?: { map: CampaignMap; commit_sha: string; committed_at: string | null } | null;
};

const approvalSchema = z.object({ confirmed: z.literal(true), confirmation_text: z.string().trim().min(1).max(500) }).strict();
export const weeklyPlanDaySchema = z.object({
  date: z.string().date(),
  founder_critical_outcome: z.string().trim().min(1).max(700),
  ai_support: z.string().trim().min(1).max(700),
  recovery_protection: z.string().trim().min(1).max(500),
  low_energy_fallback: z.string().trim().min(1).max(700),
}).strict();
export const weeklyReviewInputSchema = z.object({
  idempotency_key: z.string().trim().min(12).max(200),
  packet_id: z.string().uuid(),
  review_markdown: z.string().trim().min(1).max(16000),
  monday_friday_plan: z.array(weeklyPlanDaySchema).length(5),
  owner_reflection: z.string().trim().min(1).max(4000),
  approval: approvalSchema,
}).strict().superRefine((review, context) => {
  const dates = review.monday_friday_plan.map((day) => day.date);
  if (new Set(dates).size !== 5 || dates.some((date, index) => index > 0 && date <= dates[index - 1])) {
    context.addIssue({ code: "custom", path: ["monday_friday_plan"], message: "plan dates must be five unique ascending dates" });
  }
});

export function weeklyReviewWindows(now = new Date()): WeeklyReviewWindows {
  const today = localDate(now);
  const weekday = parseDate(today).getUTCDay();
  const daysSinceSaturday = (weekday + 1) % 7;
  const weekEnd = addDays(today, -daysSinceSaturday);
  const weekStart = addDays(weekEnd, -5);
  return {
    week_start: weekStart,
    week_end: weekEnd,
    previous_start: addDays(weekStart, -7),
    previous_end: addDays(weekEnd, -7),
    next_monday: addDays(weekEnd, 2),
    next_friday: addDays(weekEnd, 6),
    query_start: addDays(weekStart, -7),
    query_end_exclusive: addDays(weekEnd, 1),
  };
}

export function expectedWeeklyPlanDates(weekEnd: string) {
  return Array.from({ length: 5 }, (_, index) => addDays(weekEnd, index + 2));
}

export function buildWeeklyReviewEvidence(input: EvidenceInput, windows: WeeklyReviewWindows) {
  const latest = latestActiveSlices(input.slices);
  const reversedW = new Set(input.w_events.filter((event) => event.event_kind === "reversal" && event.reversal_of).map((event) => event.reversal_of!));
  const reversedCredits = new Set(input.credit_events.filter((event) => event.event_kind === "reversal" && event.reversal_of).map((event) => event.reversal_of!));
  const activeIds = new Set(latest.map((slice) => slice.id));
  const w = input.w_events.filter((event) => event.event_kind === "calculation" && event.replay_status === "completed" && !reversedW.has(event.id) && activeIds.has(event.canonical_slice_id));
  const credits = input.credit_events.filter((event) => event.event_kind === "calculation" && event.replay_status === "completed" && !reversedCredits.has(event.id) && activeIds.has(event.canonical_slice_id));
  const current = period(latest, w, credits, windows.week_start, windows.week_end);
  const previous = period(latest, w, credits, windows.previous_start, windows.previous_end);
  const cards = input.campaign_map?.map.mission_cards.filter((card) => card.date >= windows.next_monday && card.date <= windows.next_friday) ?? [];
  return {
    schema_version: "weekly-review-evidence-v1",
    timezone: WEEKLY_REVIEW_TIMEZONE,
    window: { start: windows.week_start, end: windows.week_end },
    previous_window: { start: windows.previous_start, end: windows.previous_end },
    periods: { current, previous },
    comparison: {
      activity_count_change: current.summary.activity_count - previous.summary.activity_count,
      recorded_minutes_change: round(current.summary.recorded_minutes - previous.summary.recorded_minutes),
      pilot_w_net_change: round(current.summary.pilot_w.net - previous.summary.pilot_w.net, 6),
      performance_credits_change: round(current.summary.performance_credits - previous.summary.performance_credits, 6),
    },
    campaign_outcomes: {
      current: input.campaign_outcomes.filter((event) => inWindow(localDate(new Date(event.occurred_at)), windows.week_start, windows.week_end)),
      previous: input.campaign_outcomes.filter((event) => inWindow(localDate(new Date(event.occurred_at)), windows.previous_start, windows.previous_end)),
    },
    data_quality: {
      current_missing_dates: current.summary.missing_dates,
      current_pending_statuses: current.summary.pending_statuses,
      previous_missing_dates: previous.summary.missing_dates,
      previous_pending_statuses: previous.summary.pending_statuses,
      comparison_sufficient: previous.summary.recorded_days > 0,
      comparison_note: previous.summary.recorded_days > 0 ? null : "The preceding Monday-Saturday period has no completed recorded days; treat changes as context-limited.",
    },
    interpretation_boundaries: [
      "Activity volume, Pilot W, Performance credits, and campaign outcomes are separate measures.",
      "Describe patterns as observations, not causes, predictions, diagnoses, or clinical conclusions.",
      "Missing or pending records must remain visible as data-quality limitations.",
    ],
    campaign_context: cards.length ? {
      campaign_id: input.campaign_map!.map.campaign.id,
      campaign_name: input.campaign_map!.map.campaign.name,
      commit_sha: input.campaign_map!.commit_sha,
      committed_at: input.campaign_map!.committed_at,
      next_monday: windows.next_monday,
      next_friday: windows.next_friday,
      mission_cards: cards,
    } : null,
  };
}

type BuiltEvidence = ReturnType<typeof buildWeeklyReviewEvidence>;
type BuiltPeriod = BuiltEvidence["periods"]["current"];
type BuiltActivity = BuiltPeriod["days"][number]["activities"][number];

const GPT_CURRENT_EXAMPLES_PER_DAY = 6;
const GPT_PREVIOUS_EXAMPLES_PER_DAY = 3;

/**
 * Keeps the immutable stored packet complete while returning a bounded Action
 * response. Exact aggregates cover every eligible record; activity rows are a
 * deterministic, chronological drilldown selected for qualitative relevance.
 */
export function weeklyReviewPacketForGpt(packet: {
  id: string; week_start: string; week_end: string; version: number;
  timezone: string; evidence: unknown; prepared_at: string; generator_version: string;
}) {
  const evidence = packet.evidence as BuiltEvidence;
  if (!evidence?.periods?.current?.days || !evidence?.periods?.previous?.days) {
    throw new Error("invalid_weekly_review_packet");
  }
  return {
    id: packet.id,
    week_start: packet.week_start,
    week_end: packet.week_end,
    version: packet.version,
    timezone: packet.timezone,
    prepared_at: packet.prepared_at,
    generator_version: packet.generator_version,
    transport_schema_version: "weekly-review-gpt-v1",
    selection_note: "Exact summaries cover every eligible record. Daily activity arrays are selected examples; use omitted_activity_count and never describe the examples as a complete activity list.",
    evidence: {
      schema_version: evidence.schema_version,
      timezone: evidence.timezone,
      window: evidence.window,
      previous_window: evidence.previous_window,
      periods: {
        current: compactPeriod(evidence.periods.current, GPT_CURRENT_EXAMPLES_PER_DAY),
        previous: compactPeriod(evidence.periods.previous, GPT_PREVIOUS_EXAMPLES_PER_DAY),
      },
      comparison: evidence.comparison,
      campaign_outcomes: evidence.campaign_outcomes,
      data_quality: evidence.data_quality,
      interpretation_boundaries: evidence.interpretation_boundaries,
      campaign_context: evidence.campaign_context,
    },
  };
}

function compactPeriod(periodValue: BuiltPeriod, limitPerDay: number) {
  return {
    summary: periodValue.summary,
    days: periodValue.days.map((day) => {
      const selected = selectMaterialActivities(day.activities, limitPerDay);
      return {
        date: day.date,
        activity_count: day.activities.length,
        included_activity_count: selected.length,
        omitted_activity_count: day.activities.length - selected.length,
        activities: selected.map((activity) => ({
          start_at: activity.start_at,
          end_at: activity.end_at,
          activity: excerpt(activity.activity, 220),
          ...(activity.proof ? { observation: excerpt(activity.proof, 160) } : {}),
          status: activity.status,
          wellbeing_node: activity.wellbeing_node,
          community: activity.community,
          ...(activity.sao_lane ? { sao_lane: activity.sao_lane } : {}),
          ...(activity.skill_level ? { skill_level: activity.skill_level } : {}),
          ...(activity.impact_direction ? { impact_direction: activity.impact_direction } : {}),
          ...(activity.impact_intensity ? { impact_intensity: activity.impact_intensity } : {}),
          ...(activity.confidence ? { confidence: activity.confidence } : {}),
        })),
      };
    }),
  };
}

function selectMaterialActivities(activities: BuiltActivity[], limit: number) {
  if (activities.length <= limit) return activities;
  const selected = new Set<BuiltActivity>([activities[0], activities.at(-1)!]);
  const ranked = [...activities].sort((left, right) => materialScore(right) - materialScore(left) || left.start_at.localeCompare(right.start_at));
  for (const activity of ranked) {
    if (selected.size >= limit) break;
    selected.add(activity);
  }
  return [...selected].sort((left, right) => left.start_at.localeCompare(right.start_at));
}

function materialScore(activity: BuiltActivity) {
  const duration = Math.max(0, Date.parse(activity.end_at) - Date.parse(activity.start_at)) / 60_000;
  return (activity.impact_direction === "negative" ? 100_000 : 0)
    + (activity.wellbeing_node === "Performance" ? 50_000 : 0)
    + (activity.impact_intensity === "high" ? 20_000 : 0)
    + Math.min(duration, 10_000)
    + (activity.proof ? 100 : 0);
}

function excerpt(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function period(slices: WeeklySlice[], w: WeeklyWEvent[], credits: WeeklyCreditEvent[], start: string, end: string) {
  const selected = slices.filter((slice) => inWindow(localDate(new Date(slice.start_at)), start, end));
  const calculated = selected.filter((slice) => slice.status === "calculated");
  const selectedW = w.filter((event) => inWindow(localDate(new Date(event.end_at)), start, end));
  const selectedCredits = credits.filter((event) => inWindow(localDate(new Date(event.start_at)), start, end));
  const recordedDates = new Set(calculated.map((slice) => localDate(new Date(slice.start_at))));
  const days = dateRange(start, end).map((date) => ({
    date,
    activities: selected.filter((slice) => localDate(new Date(slice.start_at)) === date).sort((a, b) => a.start_at.localeCompare(b.start_at)).map((slice) => ({
      id: slice.id, start_at: slice.start_at, end_at: slice.end_at, activity: slice.activity, proof: slice.proof ?? null,
      status: slice.status, wellbeing_node: slice.wellbeing_node, community: slice.community,
      sao_lane: slice.sao_lane ?? null, skill_level: slice.skill_level ?? null,
      impact_direction: slice.impact_direction ?? null, impact_intensity: slice.impact_intensity ?? null, confidence: slice.confidence ?? null,
    })),
  }));
  const statusCounts = selected.filter((slice) => slice.status !== "calculated").reduce<Record<string, number>>((result, slice) => {
    result[slice.status] = (result[slice.status] ?? 0) + 1; return result;
  }, {});
  const nodeMinutes = distribution(calculated, (slice) => slice.wellbeing_node);
  const communityMinutes = distribution(calculated, (slice) => slice.community);
  const creditsByRoute = selectedCredits.reduce<Record<string, number>>((result, event) => {
    const key = `${event.community}:${event.sao_lane ?? "unassigned"}`;
    result[key] = round((result[key] ?? 0) + Number(event.formula_result), 6);
    return result;
  }, {});
  const wByDay = dateRange(start, end).map((date) => ({
    date,
    net: round(selectedW.filter((event) => localDate(new Date(event.end_at)) === date).reduce((sum, event) => sum + Number(event.applied_change), 0), 6),
  }));
  const sortedW = [...selectedW].sort((a, b) => a.end_at.localeCompare(b.end_at));
  return {
    summary: {
      recorded_days: recordedDates.size,
      missing_dates: dateRange(start, end).filter((date) => !recordedDates.has(date)),
      activity_count: calculated.length,
      recorded_minutes: round(calculated.reduce((sum, slice) => sum + duration(slice), 0)),
      minutes_by_wellbecoming_node: nodeMinutes,
      minutes_by_community: communityMinutes,
      pilot_w: {
        start: sortedW.length ? Number(sortedW[0].pre_slice_w) : null,
        end: sortedW.length ? Number(sortedW.at(-1)!.post_slice_w) : null,
        net: round(selectedW.reduce((sum, event) => sum + Number(event.applied_change), 0), 6),
        positive_days: wByDay.filter((day) => day.net > 0).length,
        negative_days: wByDay.filter((day) => day.net < 0).length,
        neutral_or_unrecorded_days: wByDay.filter((day) => day.net === 0).length,
        by_day: wByDay,
        cap_limited_events: selectedW.filter((event) => event.cap_limited).length,
      },
      performance_credits: round(selectedCredits.reduce((sum, event) => sum + Number(event.formula_result), 0), 6),
      performance_credits_by_community_and_lane: creditsByRoute,
      pending_statuses: statusCounts,
    },
    days,
  };
}

function distribution(slices: WeeklySlice[], keyFor: (slice: WeeklySlice) => string) {
  return slices.reduce<Record<string, number>>((result, slice) => {
    const key = keyFor(slice);
    result[key] = round((result[key] ?? 0) + duration(slice));
    return result;
  }, {});
}

function latestActiveSlices(slices: WeeklySlice[]) {
  const latest = new Map<string, WeeklySlice>();
  for (const slice of slices) {
    const prior = latest.get(slice.protocol_link_id);
    if (!prior || slice.revision_number > prior.revision_number) latest.set(slice.protocol_link_id, slice);
  }
  return [...latest.values()].filter((slice) => !["reversed", "superseded"].includes(slice.status));
}
function duration(slice: WeeklySlice) { return Math.max(0, (Date.parse(slice.end_at) - Date.parse(slice.start_at)) / 60_000); }
function localDate(date: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: WEEKLY_REVIEW_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function parseDate(value: string) { return new Date(`${value}T12:00:00Z`); }
function addDays(value: string, days: number) { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function inWindow(value: string, start: string, end: string) { return value >= start && value <= end; }
function dateRange(start: string, end: string) { const dates: string[] = []; for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date); return dates; }
function round(value: number, digits = 2) { return Number(value.toFixed(digits)); }

export type WeeklyReviewInput = z.infer<typeof weeklyReviewInputSchema>;
