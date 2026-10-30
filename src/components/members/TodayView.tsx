import Link from "next/link";
import type { ReactNode } from "react";
import { longDate, plural } from "@/components/native-log/flow/flow-model";
import type { MemberDaySource } from "@/lib/members/day-projection";

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const nodeTone = (node: string | null) => (node ? `tone-${node.toLowerCase()}` : "");

/**
 * Member Today: one date header with a day stepper, a plain summary, the day
 * circle (unchanged), visible untimed notes, then everything else. The one
 * primary action, logging, is pinned at the bottom.
 */
export function TodayView({ selected, today, timed, notes, logHref, circle, setup, notice, unavailable, children }: {
  selected: string; today: string; timed: number; notes: MemberDaySource[] | null;
  logHref: string | null; circle?: ReactNode; setup?: ReactNode; notice?: ReactNode; unavailable?: boolean; children?: ReactNode;
}) {
  const label = selected === today ? "Today" : selected === shift(today, -1) ? "Yesterday" : "Earlier day";
  const untimed = notes?.length ?? 0;
  const summary = unavailable ? "Day details are unavailable right now." : timed || untimed
    ? [timed ? plural(timed, "recorded activity", "recorded activities") : "", untimed ? plural(untimed, "untimed note", "untimed notes") : ""].filter(Boolean).join(" · ")
    : notes === null ? "No timed activities on the clock." : selected === today ? "Nothing recorded yet today." : "Nothing recorded on this day.";
  return <div className={`member-today${logHref ? " has-dock" : ""}`}>
    <header className="today-head">
      <div className="today-head-row">
        <p className="today-kicker">{label}</p>
        <nav className="today-stepper" aria-label="Choose a day">
          <Link className="today-step" href={`/day?date=${shift(selected, -1)}`} aria-label="Previous day">‹</Link>
          {selected < today
            ? <Link className="today-step" href={`/day?date=${shift(selected, 1)}`} aria-label="Next day">›</Link>
            : <span className="today-step is-disabled" aria-hidden="true">›</span>}
        </nav>
      </div>
      <h1><time dateTime={selected}>{longDate(selected)}</time></h1>
      <p className="today-meta">{summary}{selected !== today ? <> · <Link href="/day">Back to today</Link></> : null}</p>
    </header>
    {setup}
    {circle ? <section className="today-circle" aria-label="Your recorded day">{circle}</section> : null}
    {notes && notes.length ? <section className="today-notes" aria-labelledby="today-notes-title">
      <h2 id="today-notes-title">Untimed notes</h2>
      <p className="today-section-meta">Saved without a time. Add one by voice whenever you remember.</p>
      <ul>{notes.map((note) => <li key={note.sourceId}>
        <span>{note.activity}</span>
        <span className="today-note-meta">{note.node ? <><i className={nodeTone(note.node)} aria-hidden="true" />{note.node}</> : null}{note.state === "clarification" ? " · Needs clarification" : ""}</span>
      </li>)}</ul>
    </section> : null}
    {children ? <section className="today-more">{children}</section> : null}
    {notice}
    {logHref ? <div className="today-dock"><Link className="today-log" href={logHref}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
      {selected === today ? "Log by voice" : `Log ${longDate(selected).split(" ")[0]} by voice`}
    </Link></div> : null}
  </div>;
}
