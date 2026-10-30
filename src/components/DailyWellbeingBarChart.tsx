"use client";

import { useRouter } from "next/navigation";
import { WellbeingMovementPlot, type PeriodMovementDatum } from "@/components/WellbeingMovementPlot";
import type { InsightNode } from "@/lib/trends";

export type DailyWellbeingBar = { date: string; label: string; value: number; hasValue: boolean };

export function DailyWellbeingBarChart({
  bars,
  range,
  selectedDate,
  selectedNode,
  compact = false,
}: {
  bars: DailyWellbeingBar[];
  range: number;
  selectedDate?: string;
  selectedNode?: InsightNode;
  compact?: boolean;
}) {
  const router = useRouter();
  const values: PeriodMovementDatum[] = bars.map((bar) => ({
    id: bar.date,
    date: bar.date,
    label: bar.label,
    value: bar.hasValue ? bar.value : null,
  }));
  const choose = (value: PeriodMovementDatum) => {
    const search = new URLSearchParams({ range: String(range), date: value.date });
    if (selectedNode) search.set("node", selectedNode);
    router.push(`/trends?${search.toString()}`);
  };

  return (
    <div className={`daily-w-chart${compact ? " compact" : ""}`}>
      <WellbeingMovementPlot onSelect={choose} selectedId={selectedDate} values={values} variant="period" />
      {!compact ? (
        <section className="daily-w-values" aria-label="Daily movement values">
          <h3>Daily movement values</h3>
          <ol>
            {values.map((value) => (
              <li className={value.id === selectedDate ? "selected" : ""} key={value.id}>
                <time dateTime={value.date}>{value.label}</time>
                <strong>{value.value === null ? "No completed movement" : `${value.value >= 0 ? "+" : ""}${value.value.toFixed(2)} W`}</strong>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
