import Link from "next/link";
import { redirect } from "next/navigation";
import { BecomingWeave, type WeaveScorePoint } from "@/components/BecomingWeave";
import { PageIntro } from "@/components/PageIntro";
import { SetupRequired } from "@/components/SetupRequired";
import { WeeklyReviewArchive } from "@/components/WeeklyReviewArchive";
import { isConfigured } from "@/lib/env";
import { logosDemoEnabled } from "@/lib/logos-demo";
import { pageSession } from "@/lib/page-auth";
import { buildInsightWeaveSeries, buildIntraDayWSeries, buildTrendSeries, normalizeTrendRange, trendStartDate, TREND_RANGES, type TrendCreditEvent, type TrendSlice, type TrendWEvent } from "@/lib/trends";
import { resolveTrendQuery } from "@/lib/trends-query";
import { founderEventsAsReplayRows, scoreBranchForOccurrence, type FounderViewEvent } from "@/lib/score-cutover";
import { formatWMovement } from "@/lib/w-presentation";

export const dynamic = "force-dynamic";
const DISPLAY_TIMEZONE = "Asia/Kolkata";

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function readableDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}
function durationLabel(totalMinutes: number) {
  const rounded = Math.round(totalMinutes); const hours = Math.floor(rounded / 60); const minutes = rounded % 60;
  if (!hours) return `${minutes} min`; return `${hours} hr${minutes ? ` ${minutes} min` : ""}`;
}
function whole(value: number) { return Math.round(value).toLocaleString("en-IN"); }
/**
 * End-of-day W is a running score: a day without completed movement keeps the last closing value, and days
 * before the first movement in the range hold the period's opening score.
 */
function wellbeingScorePoints(rows: { date: string; w_start: number | null; w_end: number | null; w_net: number }[], opening: number | null): WeaveScorePoint[] {
  const points: WeaveScorePoint[] = [];
  for (const row of rows) {
    const moved = row.w_start !== null && row.w_end !== null;
    const previous = points.length ? points[points.length - 1].w : opening;
    points.push({ date: row.date, w: moved ? Number(row.w_end) : previous, moved, net: moved ? Number(row.w_net) : null });
  }
  return points;
}

export default async function TrendsPage({ searchParams }: { searchParams: Promise<{ range?: string; date?: string; node?: string }> }) {
  if (!isConfigured() && !logosDemoEnabled()) return <SetupRequired />;
  const { client } = await pageSession();
  const query = await searchParams;
  const rangeDays = normalizeTrendRange(query.range);
  const endDate = todayInIndia();
  const startDate = trendStartDate(endDate, rangeDays);
  const start = `${startDate}T00:00:00+05:30`;
  const end = `${endDate}T23:59:59.999+05:30`;
  const { data: founderRun } = await client.from("current_promoted_founder_replay")
    .select("replay_run_id,baseline_effective_at,baseline_wellbeing_score")
    .eq("mode", "founder_v0_1_live").maybeSingle();
  const founderBaseline = founderRun ? {
    effective_at: founderRun.baseline_effective_at,
    wellbeing_score: founderRun.baseline_wellbeing_score,
  } : null;
  const [{ data: slices }, { data: wEvents }, { data: wReversals }, { data: creditEvents }, { data: creditReversals }, { data: weeklyReviews }, { data: founderValues }] = await Promise.all([
    client.from("current_time_slices").select("id,start_at,end_at,timezone,status,slice_type,community,activity,wellbeing_node,sao_lane,skill_level").eq("status", "calculated").lte("start_at", end).gte("end_at", start).order("start_at"),
    client.from("w_transitions").select("id,canonical_slice_id,pre_slice_w,post_slice_w,applied_change,canonical_slices!inner(id,community,start_at,end_at,timezone,activity,wellbeing_node,sao_lane,skill_level),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end),
    client.from("w_transitions").select("reversal_of,canonical_slices!inner(end_at),replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end),
    client.from("credit_events").select("id,canonical_slice_id,formula_result,canonical_slices!inner(id,community,start_at,end_at,timezone,activity,wellbeing_node,sao_lane,skill_level),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").lte("canonical_slices.start_at", end).gte("canonical_slices.end_at", start),
    client.from("credit_events").select("reversal_of,canonical_slices!inner(start_at,end_at),replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").lte("canonical_slices.start_at", end).gte("canonical_slices.end_at", start),
    client.from("current_weekly_reviews").select("id,packet_id,week_start,week_end,version,review_markdown,monday_friday_plan,owner_reflection,approved_at").order("week_start", { ascending: false }).limit(12),
    founderRun ? client.from("founder_wellbeing_value_events")
      .select("id,canonical_slice_id,event_kind,vcperformance_event_amount,w_before,w_after,delta_w,protocol_finality_status,payability_status,canonical_slices!inner(id,community,start_at,end_at,timezone,activity,wellbeing_node,sao_lane,skill_level,slice_type)")
      .eq("replay_run_id", founderRun.replay_run_id).gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end) : Promise.resolve({ data: [] }),
  ]);
  const packetIds = (weeklyReviews ?? []).map((review) => review.packet_id);
  const { data: weeklyPackets } = packetIds.length ? await client.from("weekly_review_packets").select("id,version,evidence,prepared_at").in("id", packetIds) : { data: [] };
  const typedSlices = (slices ?? []) as TrendSlice[];
  const historicalWEvents = (wEvents ?? []).filter((event) => {
    if (!founderBaseline) return true;
    const relation = Array.isArray(event.canonical_slices) ? event.canonical_slices[0] : event.canonical_slices;
    return relation && scoreBranchForOccurrence(relation.start_at, founderBaseline.effective_at) === "historical_pilot";
  }) as TrendWEvent[];
  const historicalCreditEvents = (creditEvents ?? []).filter((event) => {
    if (!founderBaseline) return true;
    const relation = Array.isArray(event.canonical_slices) ? event.canonical_slices[0] : event.canonical_slices;
    return relation && scoreBranchForOccurrence(relation.start_at, founderBaseline.effective_at) === "historical_pilot";
  }) as TrendCreditEvent[];
  const founderRows = founderEventsAsReplayRows((founderValues ?? []) as FounderViewEvent[]);
  const typedWEvents = founderBaseline ? founderRows.wEvents as TrendWEvent[] : historicalWEvents;
  const typedCreditEvents = founderBaseline ? founderRows.creditEvents as TrendCreditEvent[] : historicalCreditEvents;
  const wReversalIds = (wReversals ?? []).map((row) => row.reversal_of).filter(Boolean) as string[];
  const creditReversalIds = (creditReversals ?? []).map((row) => row.reversal_of).filter(Boolean) as string[];
  const series = buildTrendSeries({ endDate, rangeDays, slices: typedSlices, wEvents: typedWEvents, wReversalIds, creditEvents: typedCreditEvents, creditReversalIds });
  const historicalSeries = founderBaseline ? buildTrendSeries({
    endDate, rangeDays,
    slices: typedSlices.filter((slice) => scoreBranchForOccurrence(slice.start_at, founderBaseline.effective_at) === "historical_pilot"),
    wEvents: historicalWEvents, wReversalIds,
    creditEvents: historicalCreditEvents, creditReversalIds,
  }) : null;
  const weave = buildInsightWeaveSeries({ endDate, rangeDays, slices: typedSlices, wEvents: typedWEvents, wReversalIds, creditEvents: typedCreditEvents, creditReversalIds });
  const resolvedQuery = resolveTrendQuery({ range: query.range, date: query.date, node: query.node, startDate: series.start_date, endDate: series.end_date });
  const { selectedDate, selectedNode } = resolvedQuery;
  const canonicalSearch = new URLSearchParams({ range: String(rangeDays) });
  if (selectedNode) canonicalSearch.set("node", selectedNode);
  if (selectedDate) canonicalSearch.set("date", selectedDate);
  if (query.range !== String(rangeDays) || query.date !== selectedDate || query.node !== selectedNode) redirect(`/trends?${canonicalSearch.toString()}`);
  const selectedSeries = selectedDate ? buildIntraDayWSeries({ date: selectedDate, wEvents: typedWEvents, wReversalIds }) : null;
  const totalCredits = series.totals.iov_credits + series.totals.gfe_credits;
  const movementSummary = series.totals.w_start !== null && series.totals.w_end !== null ? formatWMovement(series.totals.w_net) : "—";
  const evidence = {
    periodMovement: series.rows.map((row) => ({ id: row.date, date: row.date, label: readableDate(row.date), value: row.w_start !== null && row.w_end !== null ? row.w_net : null })),
    selectedSeries,
    days: series.rows.map((row) => ({ date: row.date, label: readableDate(row.date), activityCount: row.activity_count, wValue: row.w_start !== null && row.w_end !== null ? row.w_net : null, credits: row.iov_credits + row.gfe_credits })),
    houseOfBrosW: series.totals.house_of_bros_w_net,
    houseOfBrosMinutes: series.totals.house_of_bros_minutes,
    iovCredits: series.totals.iov_credits,
    iovMinutes: series.totals.iov_minutes,
    gfeCredits: series.totals.gfe_credits,
    gfeMinutes: series.totals.gfe_minutes,
  };

  const scorePoints = wellbeingScorePoints(series.rows, series.totals.w_start === null ? null : Number(series.totals.w_start));

  return <section className="insights-page becoming-insights">
    <div className="trend-heading"><PageIntro title="Insights">Across time, where has my life been gathering, and what movement completed?</PageIntro><div className="trend-range" aria-label="Insight range">{TREND_RANGES.map((range) => {
      const keepDate = selectedDate && selectedDate >= trendStartDate(endDate, range) && selectedDate <= endDate ? selectedDate : undefined;
      const search = new URLSearchParams({ range: String(range) });
      if (selectedNode) search.set("node", selectedNode);
      if (keepDate) search.set("date", keepDate);
      return <Link aria-current={range === rangeDays ? "page" : undefined} className={range === rangeDays ? "active" : undefined} href={`/trends?${search.toString()}`} key={range}>{range} days</Link>;
    })}</div></div>

    <section className="period-ledger" aria-label="Completed period summary">
      <p className="meta">Completed records only</p>
      <dl>
        <div><dt>Days recorded</dt><dd><strong>{series.totals.logged_days}</strong><span>of {rangeDays}</span></dd></div>
        <div><dt>Recorded life</dt><dd><strong>{whole(series.totals.activity_count)}</strong><span>{series.totals.activity_count === 1 ? "activity" : "activities"}</span></dd></div>
        <div><dt>Recorded time</dt><dd><strong>{durationLabel(series.totals.logged_minutes)}</strong></dd></div>
        <div><dt>Completed movement</dt><dd><strong>{movementSummary}</strong></dd></div>
        <div><dt>Performance outward</dt><dd><strong>{whole(totalCredits)}</strong><span>credits</span></dd></div>
      </dl>
    </section>

    {founderBaseline && historicalSeries?.rows.some((row) => row.w_start !== null) ? <section className="card score-regime-history"><p className="meta">Historical measurement · ends at Genesis</p><h2>Pilot W before 28 July</h2><p>This preserved series is historical only. It is not joined to or subtracted from the canonical score.</p><ol>{historicalSeries.rows.filter((row) => row.w_start !== null).map((row) => <li key={row.date}><time>{readableDate(row.date)}</time><span>{Number(row.w_end).toFixed(3)} W</span></li>)}</ol><div className="genesis-divider"><strong>Genesis constituted</strong><span>{Number(founderBaseline.wellbeing_score).toFixed(2)} / 1000</span></div></section> : null}

    <WeeklyReviewArchive reviews={weeklyReviews ?? []} packets={weeklyPackets ?? []} />
    <BecomingWeave evidence={evidence} key={rangeDays} series={weave} selectedNode={selectedNode} selectedDate={selectedDate} scorePoints={scorePoints} />
  </section>;
}
