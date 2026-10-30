import Link from "next/link";
import { formatLocalDateTime } from "@/lib/format";
import type { TimelineOverlap } from "@/lib/timeline-integrity";

export function TimelineConflictCard({ conflicts }: { conflicts: TimelineOverlap[] }) {
  if (!conflicts.length) return null;
  return <section className="warning timeline-conflict-card" role="alert">
    <p className="meta">Timeline integrity needs correction</p>
    <h2>{conflicts.length} active {conflicts.length === 1 ? "overlap blocks" : "overlaps block"} confirmation and calculation</h2>
    <p>Commons decide who confirms a record; calculation uses one global timeline. Correct a time or remove a duplicate through the audited workflow.</p>
    {conflicts.map(({ first, second }) => <div className="timeline-conflict-pair" key={`${first.id}:${second.id}`}>
      {[first, second].map((slice) => <article key={slice.id}>
        <strong>{slice.activity ?? "Activity"}</strong>
        <span>{formatLocalDateTime(slice.start_at, "Asia/Kolkata")} – {formatLocalDateTime(slice.end_at, "Asia/Kolkata")}</span>
        <span>{slice.community === "house_of_bros" ? "HouseOfBros" : slice.community.toUpperCase()}</span>
        <Link href={`/slices/canonical/${slice.id}`}>Correct activity</Link>
      </article>)}
    </div>)}
  </section>;
}
