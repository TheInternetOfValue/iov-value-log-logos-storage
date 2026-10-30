import Link from "next/link";
import { WellbeingMovementPlot } from "@/components/WellbeingMovementPlot";
import type { DailyMovementProjection } from "@/lib/day-movement";
import { formatLocalTime } from "@/lib/format";
import { formatWMovement, formatWState } from "@/lib/w-presentation";

const DISPLAY_TIMEZONE = "Asia/Kolkata";

export type DailyMovementReading = {
  id: string;
  label: string;
  projection: DailyMovementProjection;
};

export function DailyMovementSummary({ date, readings }: { date: string; readings: DailyMovementReading[] }) {
  const splitRegime = readings.length > 1;
  return <section className="daily-movement-summary" aria-labelledby="daily-movement-title">
    <header>
      <div><p className="meta">Completed change</p><h2 id="daily-movement-title">Day movement</h2></div>
      <Link className="annotation-link quiet" href={`/trends?range=7&date=${date}`}>Open in Insights →</Link>
    </header>
    {splitRegime ? <p className="daily-movement-boundary">Genesis separates the historical and canonical measurement paths. They are not connected or added.</p> : null}
    <div className={splitRegime ? "daily-movement-regimes" : undefined}>
      {readings.map((reading) => <MovementReading key={reading.id} reading={reading} showLabel={splitRegime} />)}
    </div>
  </section>;
}

function MovementReading({ reading, showLabel }: { reading: DailyMovementReading; showLabel: boolean }) {
  const { projection } = reading;
  return <section className="daily-movement-reading" aria-label={reading.label}>
    {showLabel ? <h3>{reading.label}</h3> : null}
    {projection.status === "pending" ? <p className="daily-movement-empty">Awaiting calculation. Completed movement will appear here without requiring another review.</p> : null}
    {projection.status === "unavailable" ? <p className="daily-movement-empty">No completed W movement for this day.</p> : null}
    {projection.status === "completed" || projection.status === "zero" ? <>
      <dl className="daily-movement-ledger">
        <div><dt>Net movement</dt><dd>{formatWMovement(projection.netW)}</dd></div>
        <div><dt>Opening</dt><dd>{formatWState(projection.openingW)}</dd></div>
        <div><dt>Closing</dt><dd>{formatWState(projection.closingW)}</dd></div>
      </dl>
      {projection.status === "zero" ? <p className="daily-movement-empty"><strong>0.0000 W</strong> · No wellbeing transition applied.</p> : <WellbeingMovementPlot
        closingW={projection.closingW}
        label={`${reading.label} settlement path`}
        openingW={projection.openingW}
        values={projection.settlements.map((item) => ({
          ...item,
          label: formatLocalTime(item.settledAt, DISPLAY_TIMEZONE),
        }))}
        variant="settlement"
      />}
    </> : null}
  </section>;
}
