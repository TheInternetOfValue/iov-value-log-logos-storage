import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { TimelineConflictCard } from "@/components/review/TimelineConflictCard";
import { WellbeingTrendChart, type WellbeingTrendPoint } from "@/components/WellbeingTrendChart";
import { formatLocalDateTime, localDateFor } from "@/lib/format";
import { pageSession } from "@/lib/page-auth";
import { findTimelineOverlaps } from "@/lib/timeline-integrity";
import { buildIntraDayWSeries, type TrendWEvent } from "@/lib/trends";

export const dynamic = "force-dynamic";
const DISPLAY_TIMEZONE = "Asia/Kolkata";

function todayInIndia() { return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export default async function ProtocolPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { client } = await pageSession();
  const selected = (await searchParams).date ?? todayInIndia();
  const start = `${selected}T00:00:00+05:30`;
  const end = `${selected}T23:59:59.999+05:30`;
  const [{ data: slices }, { data: timeline }, { data: audits }, { data: wEvents }, { data: wReversals }, { data: creditEvents }, { data: replays }] = await Promise.all([
    client.from("current_time_slices").select("id,start_at,end_at,timezone,activity,status").gte("start_at", start).lte("start_at", end).order("start_at"),
    client.from("canonical_slices").select("id,start_at,end_at,community,activity,status").order("start_at"),
    client.from("audit_events").select("id,event_type,entity_type,entity_id,actor_type,created_at").gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }).limit(200),
    client.from("w_transitions").select("id,canonical_slice_id,pre_slice_w,post_slice_w,applied_change,calculator_version,parser_version,event_kind,reversal_of,created_at,canonical_slices!inner(start_at,end_at,timezone,community),replay_runs!inner(status)").eq("replay_runs.status", "completed").gte("canonical_slices.start_at", start).lte("canonical_slices.start_at", end).order("created_at"),
    client.from("w_transitions").select("reversal_of,replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed"),
    client.from("credit_events").select("id,canonical_slice_id,formula_result,calculator_version,parser_version,rate_version,event_kind,reversal_of,created_at,canonical_slices!inner(start_at,end_at,timezone,community),replay_runs!inner(status)").eq("replay_runs.status", "completed").gte("canonical_slices.start_at", start).lte("canonical_slices.start_at", end).order("created_at"),
    client.from("replay_runs").select("id,status,reason,started_at,completed_at,affected_count,failure_message").order("started_at", { ascending: false }).limit(12),
  ]);
  const reversalIds = (wReversals ?? []).map((row) => row.reversal_of).filter(Boolean) as string[];
  const calculations = (wEvents ?? []).filter((event) => event.event_kind === "calculation") as TrendWEvent[];
  const intraDay = buildIntraDayWSeries({ date: selected, wEvents: calculations, wReversalIds: reversalIds });
  const versions = {
    parser: [...new Set([...(wEvents ?? []).map((event) => event.parser_version), ...(creditEvents ?? []).map((event) => event.parser_version)].filter(Boolean))],
    calculator: [...new Set([...(wEvents ?? []).map((event) => event.calculator_version), ...(creditEvents ?? []).map((event) => event.calculator_version)].filter(Boolean))],
    rate: [...new Set((creditEvents ?? []).map((event) => event.rate_version).filter(Boolean))],
  };
  const conflicts = findTimelineOverlaps(timeline ?? []).filter((conflict) => localDateFor(conflict.first.start_at, DISPLAY_TIMEZONE) === selected || localDateFor(conflict.second.start_at, DISPLAY_TIMEZONE) === selected);

  return <section className="protocol-page">
    <PageIntro title="Provenance">Inspect how a day moved through the private pilot without exposing its source narrative.</PageIntro>
    <div className="protocol-date"><Link className="button secondary" href={`/day?date=${selected}`}>Open canonical day</Link><span>{selected} · India Standard Time</span></div>
    <div className="status-note"><strong>Pilot role disclosure:</strong> Moses acts in multiple validator roles. Role separation is not independent external review.</div>
    <TimelineConflictCard conflicts={conflicts} />

    <section className="protocol-section"><h2>Versions</h2><div className="protocol-versions"><article><span>Source parser</span><strong>{versions.parser.join(", ") || "No completed event"}</strong></article><article><span>Calculator</span><strong>{versions.calculator.join(", ") || "No completed event"}</strong></article><article><span>Performance rate</span><strong>{versions.rate.join(", ") || "No completed event"}</strong></article></div></section>

    <section className="card protocol-trace"><p className="meta">Within-day W trace</p><h2>Completed calculation transitions</h2>{intraDay.points.length > 1 ? <WellbeingTrendChart label={`Wellbeing transitions for ${selected}`} points={intraDay.points.map((point, index): WellbeingTrendPoint => ({ id: `${point.timestamp}-${index}`, x: point.label === "opening" ? 0 : minutesInIndia(point.timestamp), value: point.value, title: point.label === "opening" ? "Opening state" : formatLocalDateTime(point.timestamp), detail: point.label === "opening" ? `${point.value.toFixed(6)} W carried into the day` : `${point.change >= 0 ? "+" : ""}${point.change.toFixed(6)} W · ${point.value.toFixed(6)} W` }))} xDomain={[0, 1440]} xTicks={[0, 360, 720, 1080, 1440].map((value) => ({ value, label: value === 1440 ? "24:00" : `${String(value / 60).padStart(2, "0")}:00` }))} /> : <div className="empty">No completed Wellbeing transitions for this date.</div>}</section>

    <section className="protocol-section"><h2>Calculation and reversal events</h2><div className="protocol-events">{[...(wEvents ?? []).map((event) => ({ ...event, measure: "W" })), ...(creditEvents ?? []).map((event) => ({ ...event, measure: "credits" }))].length ? [...(wEvents ?? []).map((event) => ({ ...event, measure: "W" })), ...(creditEvents ?? []).map((event) => ({ ...event, measure: "credits" }))].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((event) => <article key={`${event.measure}-${event.id}`}><div><strong>{event.measure} · {event.event_kind}</strong><span>{event.canonical_slice_id}</span></div><time>{formatLocalDateTime(event.created_at)}</time></article>) : <div className="empty">No completed calculation events for this date.</div>}</div></section>

    <section className="protocol-section"><h2>Audit events created on this date</h2><div className="protocol-events">{audits?.length ? audits.map((event) => <article key={event.id}><div><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{event.actor_type} · {event.entity_type} · {event.entity_id}</span></div><time>{formatLocalDateTime(event.created_at)}</time></article>) : <div className="empty">No audit events were created on this date.</div>}</div></section>

    <section className="protocol-section"><h2>Recent replay runs</h2><div className="protocol-events">{replays?.length ? replays.map((run) => <article key={run.id}><div><strong>{run.status} · {run.affected_count} affected</strong><span>{run.reason}{run.status === "failed" ? ` · Reference ${run.id}` : ""}</span></div><time>{formatLocalDateTime(run.started_at)}</time></article>) : <div className="empty">No replay runs.</div>}</div>{replays?.some((run) => run.status === "failed") ? <p><Link href="/review">Open Review for any actionable retry</Link></p> : null}</section>

    <details className="sources-protocol"><summary>Active records on this date</summary><div className="protocol-records">{slices?.map((slice) => <Link href={`/slices/canonical/${slice.id}`} key={slice.id}>{formatLocalDateTime(slice.start_at, slice.timezone)} · {slice.activity} · {slice.status}</Link>)}</div></details>
  </section>;
}

function minutesInIndia(iso: string) {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: DISPLAY_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}
