import type { PeriodAnalysis, ValueLogAnalysis } from "./value-log-analysis";

export function renderValueLogAnalysis(analysis: ValueLogAnalysis, period: "week" | "month" | "both" = "both") {
  const sections = [
    `Value Log analysis — through ${analysis.as_of} (${analysis.timezone})`,
    "Completed, non-reversed projections only. Observations are descriptive, not causal or clinical.",
  ];
  if (period === "week" || period === "both") sections.push(renderPeriod("Last 7 days", analysis.periods.week));
  if (period === "month" || period === "both") sections.push(renderPeriod("Month to date", analysis.periods.month));
  if (period === "week" || period === "both") sections.push(renderComparison(analysis));
  sections.push(`Interpretation boundaries\n- ${analysis.notes.join("\n- ")}`);
  return `${sections.join("\n\n")}\n`;
}

function renderPeriod(title: string, period: PeriodAnalysis) {
  const node = period.wellbeing_nodes[0];
  const community = period.communities[0];
  const quality = Object.entries(period.data_quality.status_counts).map(([status, count]) => `${status}: ${count}`).join(", ") || "none";
  const lines = [
    `${title} (${period.window.start_date} to ${period.window.end_date})`,
    `- Coverage: ${period.coverage.recorded_days}/${period.window.day_count} days; ${period.activity.count} activities; ${duration(period.activity.minutes)}.`,
    `- Pilot W: ${period.pilot_w.start === null ? "no completed movement" : `${signed(period.pilot_w.net, 2)} net (${signed(period.pilot_w.positive, 2)} positive, ${signed(period.pilot_w.negative, 2)} negative); ${period.pilot_w.positive_days} positive and ${period.pilot_w.negative_days} negative days`}.`,
    `- Performance outward: ${whole(period.performance.total_credits)} non-monetary credits.`,
    `- Largest recorded-time node: ${node ? `${node.key} (${percent(node.share_of_minutes)})` : "none"}.`,
    `- Largest recorded-time community: ${community ? `${community.key} (${percent(community.share_of_minutes)})` : "none"}.`,
    `- Data quality: ${period.data_quality.non_calculated_slices} active non-calculated slices (${quality}); ${period.coverage.missing_dates.length} dates without calculated activity.`,
  ];
  if (period.performance.by_community_and_lane.length) {
    lines.push(`- Credit routes: ${period.performance.by_community_and_lane.map((row) => `${row.community}/${row.lane} ${whole(row.credits)}`).join("; ")}.`);
  }
  if (period.drilldown.length) {
    lines.push("- Selective evidence:");
    for (const row of period.drilldown) {
      lines.push(`  - ${localTimestamp(row.start_at)}: ${row.activity} — ${duration(row.minutes)}, W ${signed(row.w_change, 2)}, credits ${whole(row.credits)} (${reason(row.reason)}).`);
    }
  }
  return lines.join("\n");
}

function renderComparison(analysis: ValueLogAnalysis) {
  const comparison = analysis.comparisons.week_vs_previous;
  const share = analysis.comparisons.week_share_of_month;
  return [
    "Seven-day comparison",
    `- Versus ${analysis.periods.previous_week.window.start_date} to ${analysis.periods.previous_week.window.end_date}: ${signed(comparison.activity_count_change, 0)} activities and ${signed(comparison.recorded_minutes_change, 0)} recorded minutes${comparison.recorded_minutes_percent_change === null ? " (no prior-week minute baseline)" : ` (${signed(comparison.recorded_minutes_percent_change, 1)}%)`}.`,
    `- Pilot W net difference: ${signed(comparison.pilot_w_net_change, 2)} W; Performance-credit difference: ${signed(comparison.performance_credits_change, 0)} credits. These measures remain separate.`,
    `- The last seven days contain ${percent(share.activity_count_percent)} of month-to-date activities and ${percent(share.recorded_minutes_percent)} of month-to-date recorded time.`,
  ].join("\n");
}

function duration(minutes: number) { const rounded = Math.round(minutes); const hours = Math.floor(rounded / 60); const rest = rounded % 60; return hours ? `${hours} hr${rest ? ` ${rest} min` : ""}` : `${rest} min`; }
function signed(value: number, digits: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`; }
function whole(value: number) { return Math.round(value).toLocaleString("en-IN"); }
function percent(value: number | null) { return value === null ? "not available" : `${value.toFixed(1)}%`; }
function reason(value: PeriodAnalysis["drilldown"][number]["reason"]) { return value.replaceAll("_", " "); }
function localTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}
