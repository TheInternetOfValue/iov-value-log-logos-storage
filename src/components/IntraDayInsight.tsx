import Link from "next/link";
import { WellbeingMovementPlot, type SettlementMovementDatum } from "@/components/WellbeingMovementPlot";
import type { IntraDayWSeries } from "@/lib/trends";
import { formatLocalTime } from "@/lib/format";
import { formatWMovement, formatWState } from "@/lib/w-presentation";

const DISPLAY_TIMEZONE = "Asia/Kolkata";

export function IntraDayInsight({ date, label, series }: { date: string; label: "Selected day" | "Latest completed day"; series: IntraDayWSeries }) {
  const transitions: SettlementMovementDatum[] = series.projection.events.map((event) => ({
    id: event.id,
    label: formatLocalTime(event.settledAt, DISPLAY_TIMEZONE),
    settledAt: event.settledAt,
    preW: event.preW,
    change: event.change,
    postW: event.postW,
  }));
  return <section className="card intra-day-insight" aria-labelledby="intra-day-heading">
    <div className="intra-day-heading"><div><p className="meta">{label}</p><h2 id="intra-day-heading">Within-day Wellbeing movement</h2><p>{date} · India Standard Time</p></div><div className="intra-day-actions"><Link className="button secondary" href={`/explore?date=${date}`}>Explore this day</Link><Link className="button secondary" href={`/day?date=${date}`}>Open canonical day</Link></div></div>
    {series.points.length > 1 ? <>
      <WellbeingMovementPlot closingW={series.projection.closingW} label={`Within-day Wellbeing movement for ${date}`} openingW={series.projection.openingW} values={transitions} variant="settlement" />
      <div className="intra-day-summary"><span>Opening {formatWState(series.projection.openingW)}</span><span>Closing {formatWState(series.projection.closingW)}</span></div>
      <section className="intra-day-values" aria-labelledby="intra-day-values-heading"><h3 id="intra-day-values-heading">Within-day transitions</h3><ol><li><time>Opening state</time><span>—</span><strong>{formatWState(series.projection.openingW)}</strong></li>{series.projection.events.map((event) => <li key={event.id}><time>{formatLocalTime(event.settledAt, DISPLAY_TIMEZONE)}</time><span>{formatWMovement(event.change)}</span><strong>{formatWState(event.postW)}</strong></li>)}</ol></section>
    </> : <div className="empty">No completed W data for this selected day.</div>}
  </section>;
}
