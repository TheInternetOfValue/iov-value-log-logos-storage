import Link from "next/link";
import { DayClock, type DayClockActivity } from "@/components/DayClock";
import { formatLocalTime } from "@/lib/format";
import { logosDemoDay, logosDemoDays, logosNodeStatus, type LogosDemoRecord } from "@/lib/logos-demo";

const DISPLAY_TIMEZONE = "Asia/Kolkata";

function readableDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}
function durationLabel(totalMinutes: number) {
  const rounded = Math.max(0, Math.round(totalMinutes)), hours = Math.floor(rounded / 60), minutes = rounded % 60;
  return !hours ? `${minutes} min` : minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}
function clockMinutes(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const value = (type: "hour" | "minute") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}
function communityLabel(value?: string) {
  return value === "house_of_bros" ? "HouseOfBros" : value === "iov" ? "IoV" : value === "gfe" ? "GFE" : "";
}
function impactLabel(record: LogosDemoRecord) {
  const direction = record.impact_direction ? record.impact_direction[0].toUpperCase() + record.impact_direction.slice(1) : "";
  return [direction, record.impact_intensity].filter(Boolean).join(" · ");
}

/** The Today day view, read from the local Logos Storage node instead of Supabase. */
export async function LogosDayView({ date, basePath = "/day", showStorage = false }: { date?: string; basePath?: string; showStorage?: boolean }) {
  const query = { date };
  const days = logosDemoDays();
  const status = await logosNodeStatus();

  if (!days.length || !status) return <section className="canonical-day">
    <header className="canonical-day-heading"><div><h1>Logos Storage</h1><p>Local demo</p></div></header>
    <div className="empty canonical-empty">
      {!status ? <>No Logos Storage node is answering. Start it with <code>npm run logos:node</code>, then reload.</> : <>No days are stored yet. Run <code>npm run logos:import -- &lt;records.csv&gt;</code>, then reload.</>}
    </div>
  </section>;

  const index = Math.max(0, days.findIndex((day) => day.date === query.date));
  const selectedIndex = query.date && days.some((day) => day.date === query.date) ? index : days.length - 1;
  const day = days[selectedIndex];
  const stored = await logosDemoDay(day);
  const records = stored.ok ? stored.records : [];

  const activities = records.filter((record) => record.end_at).map((record, position, all): DayClockActivity & { lane: number } => {
    const timezone = record.timezone ?? DISPLAY_TIMEZONE;
    const startMinute = clockMinutes(record.start_at, timezone);
    const endMinute = Math.min(1440, startMinute + (Date.parse(record.end_at!) - Date.parse(record.start_at)) / 60_000);
    const lane = all.slice(0, position).filter((other) => {
      const otherStart = clockMinutes(other.start_at, other.timezone ?? DISPLAY_TIMEZONE);
      const otherEnd = otherStart + (Date.parse(other.end_at!) - Date.parse(other.start_at)) / 60_000;
      return otherStart < endMinute && otherEnd > startMinute;
    }).length;
    const performance = record.slice_type === "performance";
    return {
      id: record.id ?? `${day.date}-${position}`,
      activity: record.activity,
      detail: performance ? [communityLabel(record.community), record.sao_lane, record.skill_level].filter(Boolean).join(" · ") : record.wellbeing_node ?? "",
      start: formatLocalTime(record.start_at, timezone),
      end: formatLocalTime(record.end_at!, timezone),
      result: impactLabel(record),
      needsReview: record.status === "validation_pending",
      calculating: false,
      type: performance ? "performance" : "wellbeing",
      node: record.wellbeing_node ?? "Performance",
      startMinute,
      endMinute,
      conflict: false,
      lane: Math.min(lane, 2),
    };
  });
  const minutes = activities.reduce((total, item) => total + (item.endMinute - item.startMinute), 0);
  const previous = days[selectedIndex - 1], next = days[selectedIndex + 1];
  const stripStart = Math.max(0, Math.min(selectedIndex - 3, days.length - 7));
  const strip = days.slice(stripStart, stripStart + 7);

  return <section className="canonical-day">
    <header className="canonical-day-heading">
      <div>
        <h1>{readableDate(day.date)}</h1>
        <p>{records.length} {records.length === 1 ? "activity" : "activities"} · {durationLabel(minutes)} recorded{showStorage ? " · read from Logos Storage" : ""}</p>
      </div>
    </header>

    {showStorage || !stored.ok ? <section className="card" style={{ marginBottom: 24 }} aria-labelledby="logos-heading">
      <p className="meta">Local demo · Logos Storage node</p>
      <h2 id="logos-heading">This day is stored on Logos as one encrypted object</h2>
      <p><strong>CID</strong> <code style={{ wordBreak: "break-all" }}>{day.cid}</code></p>
      {stored.ok ? <>
        <p className="meta">What the node holds (AES-256-GCM, unreadable without the key):</p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, maxHeight: 96, overflow: "hidden", margin: 0 }}>{stored.envelope.ciphertext.slice(0, 360)}…</pre>
        <p className="meta">The page fetched it by CID from the node and decrypted it on this machine with the local demo key. Node: {status.totalBlocks} blocks, {(status.quotaUsedBytes / 1024).toFixed(0)} KB used; content is not advertised to the network.</p>
      </> : <p role="alert">{stored.error}</p>}
    </section> : null}

    {activities.length ? <DayClock activities={activities.map((item) => ({ ...item, result: "" }))} assistantUrl="" calculationActive={false} isToday={false} plans={[]} performanceTerm="Performance" quietIntro /> : null}

    <nav className="day-pager" aria-label="Move between stored days">
      {previous ? <Link href={`${basePath}?date=${previous.date}`}>← Previous day</Link> : <span aria-disabled="true">← Previous day</span>}
      <Link className={selectedIndex === days.length - 1 ? "current" : undefined} href={basePath}>Latest</Link>
      {next ? <Link href={`${basePath}?date=${next.date}`}>Next day →</Link> : <span aria-disabled="true">Next day →</span>}
    </nav>

    <nav className="seven-day-strip" aria-label="Stored days">
      {strip.map((item) => <Link className={item.date === day.date ? "selected" : ""} href={`${basePath}?date=${item.date}`} key={item.date} aria-current={item.date === day.date ? "date" : undefined}>
        <span>{new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${item.date}T12:00:00Z`))}</span>
        <strong>{new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${item.date}T12:00:00Z`))}</strong>
        <small>{item.records} {item.records === 1 ? "activity" : "activities"}<br />{item.cid.slice(0, 10)}…</small>
      </Link>)}
    </nav>

    {records.length ? <details className="activity-agenda" open>
      <summary><span>Read as timeline</span><span className="meta">{records.length} {records.length === 1 ? "activity" : "activities"}</span></summary>
      <div className="agenda-list">{activities.map((item) => <div className={`agenda-row ${item.type}`} key={item.id}>
        <time>{item.start}<span>{item.end}</span></time>
        <div><h3>{item.activity}</h3><p>{item.detail}</p></div>
        {item.result ? <strong className={item.needsReview ? "needs-review" : ""}>{item.result}</strong> : <span />}<span aria-hidden="true" />
      </div>)}</div>
    </details> : null}

    <details className="month-disclosure">
      <summary><span>All days on Logos</span><span>{days.length} days · {days.reduce((total, item) => total + item.records, 0)} activities</span></summary>
      <div className="card">{[...days].reverse().map((item) => <p key={item.date} style={{ margin: "4px 0", fontVariantNumeric: "tabular-nums" }}>
        <Link href={`${basePath}?date=${item.date}`}>{item.date}</Link> · {item.records} {item.records === 1 ? "activity" : "activities"} · <code style={{ fontSize: 12 }}>{item.cid}</code>
      </p>)}</div>
    </details>
  </section>;
}
