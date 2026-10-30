"use client";

import { useId, useState } from "react";
import { chartTickIndices } from "@/lib/chart-axis";
import { formatWMovement, formatWState, type WDecimal } from "@/lib/w-presentation";

export type PeriodMovementDatum = {
  id: string;
  date: string;
  label: string;
  value: number | null;
};

export type SettlementMovementDatum = {
  id: string;
  label: string;
  settledAt: string;
  preW: WDecimal;
  change: WDecimal;
  postW: WDecimal;
};

type PeriodProps = {
  variant: "period";
  values: PeriodMovementDatum[];
  selectedId?: string;
  onSelect?: (value: PeriodMovementDatum) => void;
  label?: string;
};

type SettlementProps = {
  variant: "settlement";
  values: SettlementMovementDatum[];
  openingW: WDecimal | null;
  closingW: WDecimal | null;
  label?: string;
};

export function WellbeingMovementPlot(props: PeriodProps | SettlementProps) {
  return props.variant === "period" ? <PeriodPlot {...props} /> : <SettlementPlot {...props} />;
}

const WIDTH = 820;

function PeriodPlot({ values, selectedId, onSelect, label = "Daily completed W movement" }: PeriodProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const descriptionId = useId();
  const left = 28;
  const right = 18;
  const top = 18;
  const baseline = 70;
  const bottom = 118;
  const plotWidth = WIDTH - left - right;
  const band = plotWidth / Math.max(1, values.length);
  const scale = Math.max(...values.map((value) => Math.abs(Number(value.value ?? 0))), 0.01);
  const scaleLabel = formatWState(scale).replace(" W", "");
  const ticks = chartTickIndices(values.length);
  const active = values.find((value) => value.id === activeId) ?? null;
  const yFor = (value: number) => baseline - (value / scale) * 34;

  return (
    <div className="movement-plot period-movement-plot">
      <svg aria-describedby={descriptionId} aria-label={label} role="img" viewBox={`0 0 ${WIDTH} 132`}>
        <desc id={descriptionId}>Daily completed Pilot W movement around a central zero line. Positive movement rises, negative movement falls, and missing movement is shown as a gap.</desc>
        <line className="movement-zero" x1={left} x2={WIDTH - right} y1={baseline} y2={baseline} />
        <text className="movement-scale-label" x={left} y={top}>+{scaleLabel}</text>
        <text className="movement-scale-label" x={left} y={bottom}>−{scaleLabel}</text>
        {values.map((value, index) => {
          const x = left + band * index + band / 2;
          const present = value.value !== null;
          const y = present ? yFor(Number(value.value ?? 0)) : baseline;
          const isSelected = value.id === selectedId;
          const isActive = value.id === activeId;
          return (
            <g
              aria-label={`${value.label}. ${present ? `${formatWMovement(value.value ?? 0)} completed movement` : "No completed W movement"}.`}
              className={`movement-period-point${isSelected ? " selected" : ""}${isActive ? " active" : ""}${present ? "" : " missing"}`}
              key={value.id}
              onBlur={() => setActiveId((current) => current === value.id ? null : current)}
              onClick={() => onSelect?.(value)}
              onFocus={() => setActiveId(value.id)}
              onKeyDown={(event) => activate(event, () => onSelect?.(value))}
              onMouseEnter={() => setActiveId(value.id)}
              onMouseLeave={() => setActiveId((current) => current === value.id ? null : current)}
              role={onSelect ? "button" : "img"}
              tabIndex={onSelect ? 0 : undefined}
            >
              <rect className="movement-hit" height="92" width={Math.max(30, Math.min(52, band))} x={x - Math.max(30, Math.min(52, band)) / 2} y="24" />
              {present ? <>
                <line className="movement-stem" x1={x} x2={x} y1={baseline} y2={y} />
                <circle className="movement-dot" cx={x} cy={y} r="4.5" />
              </> : <line className="movement-missing" x1={x - 5} x2={x + 5} y1={baseline} y2={baseline} />}
              {ticks.has(index) ? <text className="movement-date-label" textAnchor="middle" x={x} y="128">{value.label}</text> : null}
            </g>
          );
        })}
      </svg>
      <div aria-live="polite" className="movement-reading">
        {active ? <><strong>{active.label}</strong><span>{active.value === null ? "No completed W movement" : `${formatWMovement(active.value)} completed movement`}</span></> : <span>Choose a day to read its completed movement.</span>}
      </div>
    </div>
  );
}

function SettlementPlot({ values, openingW, closingW, label = "Within-day W settlement path" }: SettlementProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const descriptionId = useId();
  const left = 46;
  const right = 46;
  const baseline = 72;
  const plotWidth = WIDTH - left - right;
  const active = values.find((value) => value.id === activeId) ?? null;
  const minuteFor = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
    const part = (type: "hour" | "minute") => Number(parts.find((item) => item.type === type)?.value ?? 0);
    return part("hour") * 60 + part("minute");
  };
  const xFor = (iso: string) => left + (minuteFor(iso) / 1440) * plotWidth;

  return (
    <div className="movement-plot settlement-movement-plot">
      <svg aria-describedby={descriptionId} aria-label={label} className="settlement-desktop" role="img" viewBox={`0 0 ${WIDTH} 164`}>
        <desc id={descriptionId}>Opening and closing Pilot W with completed movements placed at their actual India Standard Time settlement points.</desc>
        <text className="movement-state-label" x={left} y="22">Opening {formatWState(openingW)}</text>
        <text className="movement-state-label" textAnchor="end" x={WIDTH - right} y="22">Closing {formatWState(closingW)}</text>
        <line className="movement-zero" x1={left} x2={WIDTH - right} y1={baseline} y2={baseline} />
        {["00:00", "06:00", "12:00", "18:00", "24:00"].map((tick, index) => {
          const x = left + plotWidth * (index / 4);
          return <g aria-hidden="true" key={tick}><line className="settlement-tick" x1={x} x2={x} y1={baseline - 4} y2={baseline + 4} /><text className="movement-date-label" textAnchor="middle" x={x} y="112">{tick}</text></g>;
        })}
        {values.map((value) => {
          const x = xFor(value.settledAt);
          const direction = Number(value.change) < 0 ? 1 : -1;
          const y = baseline + direction * 22;
          const activePoint = value.id === activeId;
          return (
            <g
              aria-label={`${value.label}. ${formatWState(value.preW)} before, ${formatWMovement(value.change)} movement, ${formatWState(value.postW)} after.`}
              className={`movement-settlement-point${activePoint ? " active" : ""}${Number(value.change) < 0 ? " negative" : " positive"}`}
              key={value.id}
              onBlur={() => setActiveId((current) => current === value.id ? null : current)}
              onClick={() => setActiveId(value.id)}
              onFocus={() => setActiveId(value.id)}
              onKeyDown={(event) => activate(event, () => setActiveId(value.id))}
              onMouseEnter={() => setActiveId(value.id)}
              onMouseLeave={() => setActiveId((current) => current === value.id ? null : current)}
              role="button"
              tabIndex={0}
            >
              <rect className="movement-hit" height="72" width="34" x={x - 17} y={baseline - 36} />
              <line className="movement-stem" x1={x} x2={x} y1={baseline} y2={y} />
              <circle className="movement-dot" cx={x} cy={y} r="4.5" />
            </g>
          );
        })}
      </svg>
      <ol className="settlement-mobile" aria-label={label}>
        <li><strong>Opening</strong><span>{formatWState(openingW)}</span></li>
        {values.map((value) => <li key={value.id}><time>{value.label}</time><span>{formatWMovement(value.change)} → {formatWState(value.postW)}</span></li>)}
        <li><strong>Closing</strong><span>{formatWState(closingW)}</span></li>
      </ol>
      <div aria-live="polite" className="movement-reading">
        {active ? <><strong>{active.label}</strong><span>{formatWState(active.preW)} → {formatWMovement(active.change)} → {formatWState(active.postW)}</span></> : <span>Select a settlement point for its exact transition.</span>}
      </div>
    </div>
  );
}

function activate(event: React.KeyboardEvent, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}
