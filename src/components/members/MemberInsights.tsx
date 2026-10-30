import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memberDayProjection } from "@/lib/members/day-server";
import type { cohortSnapshot } from "@/lib/cohort/server";
import { INSIGHT_NODE_ORDER } from "@/lib/trends";

type Snapshot = Awaited<ReturnType<typeof cohortSnapshot>>;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export async function MemberInsights({ client, owner, cohort, today, range }: { client: SupabaseClient; owner: string; cohort: Snapshot; today: string; range?: string }) {
  const days = range === "14" ? 14 : range === "30" ? 30 : 7;
  const dates = Array.from({ length: days }, (_, i) => shift(today, i - days + 1));
  const projections: Awaited<ReturnType<typeof memberDayProjection>>[] = [];
  try {
    // Bound concurrency while reusing the already loaded cohort snapshot.
    for (let i = 0; i < dates.length; i += 5) projections.push(...await Promise.all(dates.slice(i, i + 5).map(date => memberDayProjection(client, owner, date, cohort))));
  } catch {
    return <section className="member-insights"><p className="member-kicker">YOUR ACTIVITY</p><h2>Your days, together</h2><p role="status">Your activity overview could not load. Your saved records are still available.</p></section>;
  }
  const dayItems = projections.map(day => {
    const items = [...day.activities.map(item => ({ id: item.occurrenceId, node: item.node })), ...day.notes.map(item => ({ id: item.occurrenceId, node: item.node }))];
    return { date: day.date, items, minutes: day.activities.reduce((sum, item) => sum + (item.endMinute - item.startMinute), 0) };
  });
  const ids = new Set(dayItems.flatMap(day => day.items.map(item => item.id)));
  const recordedDays = dayItems.filter(day => day.items.length).length;
  const minutes = Math.round(dayItems.reduce((sum, day) => sum + day.minutes, 0));
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
  return <section className="member-insights" aria-labelledby="member-insights-title">
    <div className="member-insights-heading"><div><p className="member-kicker">YOUR PRIVATE OVERVIEW</p><h2 id="member-insights-title">Your days, together<span className="heading-dot">.</span></h2></div><nav aria-label="Insights period">{[7, 14, 30].map(n => <Link key={n} href={`/review?range=${n}`} aria-current={n === days ? "page" : undefined} className={n === days ? "active" : ""}>{n} days</Link>)}</nav></div>
    <div className="member-overview-card"><div className="member-overview-top"><span>YOUR LAST {days} DAYS</span><span aria-hidden="true">~</span></div><p className="member-overview-description">A little perspective on the days you’ve recorded.</p><dl className="member-insights-summary"><div><dt>Days recorded</dt><dd>{recordedDays}<small> / {days}</small></dd></div><div><dt>Activities</dt><dd>{ids.size}</dd></div><div><dt>Timed activity</dt><dd>{duration}</dd></div></dl></div>
    <div className="member-weave"><div className="member-weave-header"><div><p className="member-kicker">A CLOSER LOOK</p><h3>Activities across your days</h3><p>Each dot marks a day with activity.</p></div><span aria-hidden="true">↗</span></div>
      <div className="member-weave-scroll"><div className="member-weave-grid" style={{ gridTemplateColumns: `92px repeat(${days}, minmax(24px, 1fr))`, minWidth: `${92 + days * 28}px` }}>
        <span className="member-weave-corner">DAY</span>{dates.map(date => <Link key={date} className="member-weave-date" href={`/review?range=${days}&date=${date}#review-days`} aria-label={`Review ${date}`}>{Number(date.slice(8))}</Link>)}
        {INSIGHT_NODE_ORDER.map(node => <div className="member-weave-row" key={node} style={{ display: "contents" }}><span className="member-weave-node">{node}</span>{dayItems.map(day => { const count = day.items.filter(item => item.node === node).length; return <Link key={day.date} href={`/review?range=${days}&date=${day.date}#review-days`} className={`member-weave-cell tone-${node.toLowerCase()}${count ? " has-activity" : ""}`} aria-label={`${node}, ${day.date}: ${count} ${count === 1 ? "activity" : "activities"}`}><span aria-hidden="true" /></Link>; })}</div>)}
      </div></div>
      <p className="member-weave-instruction">Select a day to see its activities <span aria-hidden="true">↗</span></p>
      <details className="member-weave-about"><summary>About this view</summary><p className="member-weave-note">Shows your indexed activities and private notes in India time. Older conversations that haven’t been indexed may be missing. Unclassified activities are included in totals but not in the grid. Time excludes untimed notes. Activity is not a wellbeing score.</p></details>
    </div>
  </section>;
}
