type PlanDay = {
  date: string;
  founder_critical_outcome: string;
  ai_support: string;
  recovery_protection: string;
  low_energy_fallback: string;
};

type ReviewRow = {
  id: string; packet_id: string; week_start: string; week_end: string; version: number;
  review_markdown: string; monday_friday_plan: unknown; owner_reflection: string; approved_at: string;
};
type PacketRow = { id: string; version: number; evidence: unknown; prepared_at: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}
function planDays(value: unknown): PlanDay[] { return list(value) as PlanDay[]; }

export function WeeklyReviewArchive({ reviews, packets }: { reviews: ReviewRow[]; packets: PacketRow[] }) {
  const packetById = new Map(packets.map((packet) => [packet.id, packet]));
  return <section className="weekly-review-archive" id="weekly-reviews" aria-labelledby="weekly-reviews-title">
    <header>
      <div><p className="meta">Owner-private archive</p><h2 id="weekly-reviews-title">Weekly Reviews</h2></div>
      <p>Monday–Saturday evidence, interpretation, your reflection, and the following week’s plan.</p>
    </header>
    {!reviews.length ? <p className="weekly-review-empty">No approved weekly review has been saved yet.</p> : <div className="weekly-review-list">{reviews.map((review, index) => {
      const packet = packetById.get(review.packet_id);
      const evidence = record(packet?.evidence);
      const current = record(record(evidence.periods).current);
      const summary = record(current.summary);
      const missingDates = list(summary.missing_dates).filter((date): date is string => typeof date === "string");
      const pending = Object.entries(record(summary.pending_statuses));
      const days = list(current.days).map(record);
      return <details className="weekly-review" key={review.id} open={index === 0}>
        <summary><span><strong>{displayDate(review.week_start)} – {displayDate(review.week_end)}</strong><small>Review v{review.version} · evidence v{packet?.version ?? "—"}</small></span><span aria-hidden="true">View</span></summary>
        <div className="weekly-review-body">
          <section><p className="meta">Interpretation</p><div className="weekly-review-prose">{review.review_markdown}</div></section>
          <section><p className="meta">Monday–Friday plan</p><ol className="weekly-plan">{planDays(review.monday_friday_plan).map((day) => <li key={day.date}>
            <h3>{displayDate(day.date)}</h3>
            <dl><div><dt>Founder-critical outcome</dt><dd>{day.founder_critical_outcome}</dd></div><div><dt>AI support</dt><dd>{day.ai_support}</dd></div><div><dt>Recovery protection</dt><dd>{day.recovery_protection}</dd></div><div><dt>Low-energy fallback</dt><dd>{day.low_energy_fallback}</dd></div></dl>
          </li>)}</ol></section>
          <section className="weekly-reflection"><p className="meta">What reality taught me</p><blockquote>{review.owner_reflection}</blockquote></section>
          <section><p className="meta">Evidence and data quality</p><div className="weekly-evidence-summary"><span>{String(summary.recorded_days ?? 0)} recorded days</span><span>{String(summary.activity_count ?? 0)} completed activities</span><span>{String(summary.recorded_minutes ?? 0)} minutes</span></div>
            <p>{missingDates.length ? `Missing completed records: ${missingDates.join(", ")}.` : "All six dates contain completed records."} {pending.length ? `Pending states: ${pending.map(([key, count]) => `${key} ${String(count)}`).join(", ")}.` : "No pending states were included."}</p>
            <details className="weekly-evidence-detail"><summary>Chronological source activities</summary>{days.map((day) => <div key={String(day.date)}><h3>{String(day.date)}</h3><ul>{list(day.activities).map(record).map((activity) => <li key={String(activity.id)}><strong>{String(activity.activity)}</strong><span>{String(activity.wellbeing_node)} · {String(activity.community)}</span></li>)}</ul></div>)}</details>
          </section>
        </div>
      </details>;
    })}</div>}
  </section>;
}
