"use client";

import { useId, useState } from "react";

export type WellbeingTrendPoint = {
  id: string;
  x: number;
  value: number;
  title: string;
  detail: string;
};

export type WellbeingTrendTick = {
  value: number;
  label: string;
};

const WIDTH = 760;
const HEIGHT = 292;
const PLOT = { left: 72, right: 24, top: 20, bottom: 52 };

export function WellbeingTrendChart({
  points,
  xTicks,
  xDomain,
  label,
}: {
  points: WellbeingTrendPoint[];
  xTicks: WellbeingTrendTick[];
  xDomain: [number, number];
  label: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const descriptionId = useId();
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const [yMin, yMax, yTicks] = yScale(points.map((point) => point.value));
  const x = (value: number) => PLOT.left + ((value - xDomain[0]) / Math.max(xDomain[1] - xDomain[0], 1)) * plotWidth;
  const y = (value: number) => PLOT.top + ((yMax - value) / Math.max(yMax - yMin, 1)) * plotHeight;
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point.x).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
  const active = points.find((point) => point.id === activeId) ?? null;

  return <div className="wellbeing-chart">
    <svg className="wellbeing-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} aria-describedby={descriptionId}>
      <desc id={descriptionId}>Wellbeing Score values are shown on a zoomed observed range. Hover, focus, or select a point for its exact value.</desc>
      {yTicks.map((tick) => <g key={tick}>
        <line className="wellbeing-grid-line" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={y(tick)} y2={y(tick)} />
        <text className="wellbeing-y-label" x={PLOT.left - 12} y={y(tick) + 4} textAnchor="end">{tick.toFixed(2)}</text>
      </g>)}
      <line className="wellbeing-axis" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={PLOT.top + plotHeight} y2={PLOT.top + plotHeight} />
      <line className="wellbeing-axis" x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={PLOT.top + plotHeight} />
      {xTicks.map((tick) => <g key={`${tick.value}-${tick.label}`}>
        <line className="wellbeing-axis-tick" x1={x(tick.value)} x2={x(tick.value)} y1={PLOT.top + plotHeight} y2={PLOT.top + plotHeight + 5} />
        <text className="wellbeing-x-label" x={x(tick.value)} y={HEIGHT - 20} textAnchor="middle">{tick.label}</text>
      </g>)}
      <text className="wellbeing-axis-title" transform={`translate(18 ${PLOT.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">Wellbeing Score</text>
      <path className="wellbeing-path" d={path} />
      {points.map((point) => {
        const selected = point.id === activeId;
        return <g
          aria-label={`${point.title}. ${point.detail}`}
          className={selected ? "wellbeing-point active" : "wellbeing-point"}
          key={point.id}
          onBlur={() => setActiveId((current) => current === point.id ? null : current)}
          onClick={() => setActiveId(point.id)}
          onFocus={() => setActiveId(point.id)}
          onMouseEnter={() => setActiveId(point.id)}
          onMouseLeave={() => setActiveId((current) => current === point.id ? null : current)}
          role="button"
          tabIndex={0}
        >
          <circle className="wellbeing-point-hitbox" cx={x(point.x)} cy={y(point.value)} r="13" />
          <circle className="wellbeing-point-dot" cx={x(point.x)} cy={y(point.value)} r="4.5" />
        </g>;
      })}
    </svg>
    <div className="wellbeing-chart-caption">
      <span>Y-axis: observed range</span>
      <span>Hover or focus a point for detail</span>
    </div>
    <div aria-live="polite" className="wellbeing-tooltip">
      {active ? <><strong>{active.title}</strong><span>{active.detail}</span></> : <span>Select a point to inspect its movement.</span>}
    </div>
  </div>;
}

function yScale(values: number[]): [number, number, number[]] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rawStep = Math.max((max - min) / 3, 0.01);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const lower = Math.floor((min - step * 0.45) / step) * step;
  const upper = Math.ceil((max + step * 0.45) / step) * step;
  const ticks: number[] = [];
  for (let value = lower; value <= upper + step / 100; value += step) ticks.push(Number(value.toFixed(6)));
  return [lower, upper, ticks];
}
