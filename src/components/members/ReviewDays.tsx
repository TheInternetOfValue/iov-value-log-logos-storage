import Link from "next/link";

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export function ReviewDays({ selected, today }: { selected?: string; today: string }) {
  const anchor = selected ?? today;
  const dates = Array.from({ length: 7 }, (_, i) => shift(anchor, i - 6));
  return <section id="review-days" className="review-days" aria-label="Choose activities by day">
    <div className="review-days-heading"><div><p className="member-kicker">YOUR ACTIVITY</p><h2>Browse by day</h2></div><Link className={!selected ? "review-all-active" : ""} aria-current={!selected ? "true" : undefined} href="/review">All days</Link></div>
    <nav className="review-day-strip" aria-label="Review dates">
      {dates.map((date) => { const d = new Date(`${date}T12:00:00Z`); return <Link key={date} href={`/review?date=${date}`} aria-current={date === selected ? "date" : undefined} className={date === selected ? "selected" : ""}><span>{new Intl.DateTimeFormat("en", {weekday:"short",timeZone:"UTC"}).format(d)}</span><strong>{d.getUTCDate()}</strong><small>{new Intl.DateTimeFormat("en", {month:"short",timeZone:"UTC"}).format(d)}</small></Link>; })}
    </nav>
    <div className="review-day-controls"><Link href={`/review?date=${shift(anchor, -7)}`}>← Earlier</Link><form action="/review"><label htmlFor="review-date">Choose a date</label><input id="review-date" name="date" type="date" max={today} defaultValue={selected ?? today} /><button type="submit">Go</button></form>{anchor < today ? <Link href={`/review?date=${today}`}>Today →</Link> : null}</div>
  </section>;
}
