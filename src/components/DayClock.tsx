"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ContextualReading } from "@/components/ContextualReading";
import { clockArcPath, clockPoint } from "@/lib/day-clock";
import type { AmbientCondition, DailyBriefingReading, DayPhase, DayWeather } from "@/lib/day-external-context";

export type DayClockPlan = {
  id: string;
  activity: string;
  start: string;
  end: string;
  startMinute: number;
  endMinute: number;
  status: string;
  aiCodexActivity?: string | null;
  intendedOutcome?: string | null;
  startAt: string;
  endAt: string;
};

export type DayClockActivity = {
  id: string;
  activity: string;
  reviewHref?: string;
  completedMovement?: boolean;
  detail: string;
  start: string;
  end: string;
  result: string;
  needsReview: boolean;
  calculating: boolean;
  type: "wellbeing" | "performance";
  node: string;
  startMinute: number;
  endMinute: number;
  conflict: boolean;
};

function localMinute(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: "hour" | "minute" | "second") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute") + value("second") / 60;
}

function timeLabel(date: Date) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function remainingLabel(milliseconds: number) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} hr ${minutes % 60} min remaining` : `${minutes} min remaining`;
}

function activityTone(node: string) {
  return node.toLowerCase().replaceAll(" ", "-");
}

function roundedTemperature(value: number) {
  return `${Math.round(value)}°C`;
}

function localContextTime(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2];
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "pm" : "am"}`;
}

function briefingTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function fallbackDayPhase(minute: number | null): DayPhase {
  if (minute === null) return "day";
  if (minute < 300 || minute >= 1170) return "night";
  if (minute < 450) return "dawn";
  if (minute >= 990) return "dusk";
  return "day";
}

function AmbientWeatherLayer({
  condition,
  isDay,
  minute,
  phase,
}: {
  condition: AmbientCondition;
  isDay: boolean;
  minute: number | null;
  phase: DayPhase;
}) {
  const sun = clockPoint(minute ?? 720, 132);
  const showClouds = ["cloud", "fog", "rain", "storm", "snow"].includes(condition);
  const showRain = condition === "rain" || condition === "storm";
  const showSnow = condition === "snow";
  return <g aria-hidden="true" className={`clock-atmosphere atmosphere-${condition} phase-${phase}`}>
    {isDay ? <g className="atmosphere-sun" transform={`translate(${sun.x} ${sun.y})`}><circle r="48" /><circle className="atmosphere-sun-core" r="20" /></g> : <path className="atmosphere-moon" d="M 380 180 A 58 58 0 1 0 430 267 A 48 48 0 1 1 380 180" />}
    {showClouds ? <g className="atmosphere-clouds">
      <path d="M 100 250 C 112 218 145 211 169 230 C 192 196 244 212 247 250 Z" />
      <path d="M 365 410 C 378 376 418 373 438 397 C 461 369 510 384 516 418 L 365 418 Z" />
    </g> : null}
    {showRain ? <g className="atmosphere-rain">
      {[0, 1, 2, 3, 4, 5].map((index) => <line key={index} x1={392 + index * 20} x2={381 + index * 20} y1={430 + (index % 2) * 8} y2={455 + (index % 2) * 8} />)}
    </g> : null}
    {showSnow ? <g className="atmosphere-snow">
      {[0, 1, 2, 3, 4].map((index) => <circle key={index} cx={392 + index * 25} cy={440 + (index % 2) * 13} r="3" />)}
    </g> : null}
  </g>;
}

export function DayClock({
  activities,
  assistantUrl,
  nativeLogHref,
  briefing,
  calculationActive,
  conflictHref,
  focus,
  isToday,
  plans,
  performanceTerm = "Performance credits",
  memberView = false,
  weather,
  highlightIds = [],
  quietIntro = false,
}: {
  activities: DayClockActivity[];
  assistantUrl: string;
  nativeLogHref?: string;
  briefing?: DailyBriefingReading | null;
  calculationActive: boolean;
  conflictHref?: string;
  focus?: string | null;
  isToday: boolean;
  plans: DayClockPlan[];
  performanceTerm?: string;
  memberView?: boolean;
  weather?: DayWeather | null;
  /** Arcs just added by a submission; highlighted briefly. */
  highlightIds?: string[];
  /** The page already states the count; at rest, only say how to read the circle. */
  quietIntro?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [contextLens, setContextLens] = useState<"day" | "weather" | "briefing">("day");
  const [ambientEnabled, setAmbientEnabled] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [previewedArc, setPreviewedArc] = useState<{ id: string; kind: "plan" | "activity" } | null>(null);
  const [previewedResultId, setPreviewedResultId] = useState<string | null>(null);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      try {
        setAmbientEnabled(window.localStorage.getItem("value-log:ambient-conditions") !== "off");
      } catch {
        setAmbientEnabled(true);
      }
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);

  const nowMinute = now ? localMinute(now) : null;
  const ambientPhase = weather?.phase ?? fallbackDayPhase(nowMinute);
  const ambientCondition = weather?.condition ?? "neutral";
  const ambientIsDay = weather?.isDay ?? ambientPhase !== "night";
  const ambientVisible = isToday && ambientEnabled;
  const selected = activities.find((item) => item.id === selectedId) ?? null;
  const inspectedPlan = plans.find((item) => item.id === selectedPlanId) ?? null;
  const planActuals = inspectedPlan ? activities.filter((item) => item.startMinute < inspectedPlan.endMinute && item.endMinute > inspectedPlan.startMinute) : [];
  const previewedResult = activities.find((item) => item.id === previewedResultId && item.result) ?? null;
  const previewedPlan = previewedArc?.kind === "plan" ? plans.find((item) => item.id === previewedArc.id) ?? null : null;
  const previewedActivity = previewedArc?.kind === "activity" ? activities.find((item) => item.id === previewedArc.id) ?? null : null;
  const previewedClockItem = previewedResult ? {
    activity: previewedResult.activity,
    detail: previewedResult.result,
    minute: previewedResult.endMinute,
    radius: previewedResult.type === "performance" ? 237 : 188,
  } : previewedPlan ? {
    activity: previewedPlan.activity,
    detail: `Planned · ${previewedPlan.start}–${previewedPlan.end}`,
    minute: (previewedPlan.startMinute + previewedPlan.endMinute) / 2,
    radius: 252,
  } : previewedActivity ? {
    activity: previewedActivity.activity,
    detail: `Recorded · ${previewedActivity.start}–${previewedActivity.end}`,
    minute: (previewedActivity.startMinute + previewedActivity.endMinute) / 2,
    radius: 214,
  } : null;
  const calculationPending = activities.some((item) => item.calculating);
  const calculationRunning = calculationActive && calculationPending;
  const currentPlan = isToday && now ? plans.find((item) => new Date(item.startAt) <= now && new Date(item.endAt) > now) ?? null : null;
  const nextPlan = isToday && now ? plans.find((item) => new Date(item.startAt) > now) ?? null : null;
  const hand = nowMinute === null ? null : clockPoint(nowMinute, 176);
  const secondsHand = now === null ? null : clockPoint(now.getSeconds() * 24, 92);
  const previewedClockPoint = previewedClockItem ? clockPoint(previewedClockItem.minute, previewedClockItem.radius) : null;
  const tooltipActivity = previewedClockItem ? previewedClockItem.activity.length > 31 ? `${previewedClockItem.activity.slice(0, 30)}…` : previewedClockItem.activity : "";
  const tooltipWidth = previewedClockItem ? Math.max(126, Math.min(236, Math.max(tooltipActivity.length, previewedClockItem.detail.length) * 6.4 + 24)) : 0;
  const tooltipX = previewedClockPoint ? previewedClockPoint.x + tooltipWidth + 12 > 620 ? previewedClockPoint.x - tooltipWidth - 12 : previewedClockPoint.x + 12 : 0;
  const tooltipY = previewedClockPoint ? Math.max(18, Math.min(572, previewedClockPoint.y - 25)) : 0;
  const ticks = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({
    hour,
    outer: clockPoint(hour * 60, 284),
    inner: clockPoint(hour * 60, hour % 6 === 0 ? 269 : 276),
  })), []);

  useEffect(() => {
    if (!calculationRunning) return;
    const refresh = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(refresh);
  }, [calculationRunning, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || contextLens === "day") return;
      setContextLens("day");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextLens]);

  const select = (id: string) => {
    setContextLens("day");
    setSelectedPlanId(null);
    setSelectedId((current) => current === id ? null : id);
  };
  const selectPlan = (id: string) => {
    setContextLens("day");
    setSelectedId(null);
    setSelectedPlanId((current) => current === id ? null : id);
  };
  const openContext = (lens: "weather" | "briefing") => {
    setSelectedId(null);
    setSelectedPlanId(null);
    setContextLens((current) => current === lens ? "day" : lens);
  };
  const updateAmbientPreference = () => {
    setAmbientEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("value-log:ambient-conditions", next ? "on" : "off");
      } catch {
        // The preference remains session-local when storage is unavailable.
      }
      return next;
    });
  };

  const calculationClass = calculationRunning ? " calculating" : calculationPending ? " calculation-pending" : "";
  const ambientClass = ambientVisible ? ` ambient-enabled ambient-${ambientCondition} phase-${ambientPhase}` : "";
  const annotationFooter = contextLens === "day"
    ? <div className="annotation-key"><span><i />Inner marks are completed W movement.</span><span><b />Outer diamonds are {performanceTerm}.</span></div>
    : contextLens === "weather"
      ? <p className="external-context-boundary">Weather is external context from <a href="https://open-meteo.com/" rel="noopener noreferrer" target="_blank">Open-Meteo ↗</a>. It does not alter the record.</p>
      : <p className="external-context-boundary">Private dated briefing artifact · read only · no protocol write.</p>;

  return <section aria-busy={calculationRunning || undefined} className={`living-day${calculationClass}${ambientClass}`} aria-labelledby="living-day-title">
    <div className="living-day-heading">
      <div><p className="meta">The living day</p><h2 id="living-day-title">{memberView ? "Your recorded day" : "Plans are quiet. Recorded life is vivid."}</h2></div>
      <div><div className="clock-legend" aria-label="Clock legend">{!memberView ? <span><i className="planned" />Planned</span> : null}<span><i className="recorded" />Recorded life</span><span><i className="settled" />W movement</span><span><b className="performance" />{performanceTerm}</span></div><p className="clock-instruction"><span className="pointer-instruction">Hover to glance · select to keep</span><span className="touch-instruction">Tap a mark to read</span></p></div>
    </div>
    {!memberView ? <nav className="day-context-entries" aria-label="External daily context">
      {weather ? <button aria-pressed={contextLens === "weather"} className={contextLens === "weather" ? "selected" : ""} onClick={() => openContext("weather")} type="button">
        <span>Outside now</span><strong>{weather.location} · {roundedTemperature(weather.temperatureC)} · {weather.conditionLabel}</strong>
      </button> : null}
      {!weather && isToday ? <button aria-label={`Time-based ambient day is ${ambientEnabled ? "on" : "off"}`} aria-pressed={ambientEnabled} onClick={updateAmbientPreference} type="button">
        <span>Ambient day</span><strong>Time-based · {ambientEnabled ? "On" : "Off"}</strong>
      </button> : null}
      <button aria-pressed={contextLens === "briefing"} className={contextLens === "briefing" ? "selected" : ""} disabled={!briefing} onClick={() => briefing && openContext("briefing")} type="button">
        <span>{briefing ? briefing.freshness === "stale" ? "Earlier briefing" : "Morning briefing" : "Briefing not ready"}</span><strong>{briefing ? `${briefing.artifact.signals.length} signals` : "No dated artifact"}</strong>
      </button>
    </nav> : null}
    <div className="living-day-layout">
      <div className="day-clock-wrap">
        <svg aria-describedby="day-clock-description" aria-label="24-hour view of planned and recorded activity" className={`day-clock${calculationClass}`} role="group" viewBox="0 0 640 640">
          <desc id="day-clock-description">Muted outer arcs are plans. Coloured inner arcs are recorded activities. Midnight is at the top and time moves clockwise.</desc>
          <circle className="clock-paper" cx="320" cy="320" r="298" />
          {ambientVisible ? <AmbientWeatherLayer condition={ambientCondition} isDay={ambientIsDay} minute={nowMinute} phase={ambientPhase} /> : null}
          <circle aria-hidden="true" className="clock-calculation-halo" cx="320" cy="320" r="291" />
          <circle className="clock-rule outer" cx="320" cy="320" r="252" />
          <circle className="clock-rule actual" cx="320" cy="320" r="214" />
          {ticks.map((tick) => <line className={tick.hour % 6 === 0 ? "clock-tick major" : "clock-tick"} key={tick.hour} x1={tick.inner.x} x2={tick.outer.x} y1={tick.inner.y} y2={tick.outer.y} />)}
          <g className="clock-labels" aria-hidden="true"><text x="320" y="46">00</text><text x="594" y="325">06</text><text x="320" y="605">12</text><text x="47" y="325">18</text></g>
          <g aria-label="Planned activity" className="clock-plans">
            {plans.map((item) => {
              const path = clockArcPath(item.startMinute, item.endMinute, 252);
              return <g className={`clock-plan-group${inspectedPlan?.id === item.id ? " selected" : ""}`} key={item.id} onMouseEnter={() => setPreviewedArc({ id: item.id, kind: "plan" })} onMouseLeave={() => setPreviewedArc((current) => current?.id === item.id ? null : current)}>
                <path aria-hidden="true" className="clock-plan-hit" d={path} onClick={() => selectPlan(item.id)} />
                <path aria-label={`${item.start}–${item.end}: planned — ${item.activity}. Intention, not recorded life.`} className={`clock-plan ${item.status}`} d={path} onBlur={() => setPreviewedArc((current) => current?.id === item.id ? null : current)} onClick={() => selectPlan(item.id)} onFocus={() => setPreviewedArc({ id: item.id, kind: "plan" })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectPlan(item.id); } }} role="button" tabIndex={0} />
              </g>;
            })}
          </g>
          <g aria-label="Recorded activity" className="clock-actuals">
            {activities.map((item) => {
              const path = clockArcPath(item.startMinute, item.endMinute, 214);
              const end = clockPoint(item.endMinute, item.type === "performance" ? 237 : 188);
              const boundaryInner = clockPoint(item.startMinute, 198);
              const boundaryOuter = clockPoint(item.startMinute, 230);
              return <g className={`clock-activity tone-${activityTone(item.node)}${selected?.id === item.id ? " selected" : ""}${item.needsReview ? " pending" : ""}${item.conflict ? " conflict" : ""}${highlightIds.includes(item.id) ? " is-new" : ""}`} key={item.id} onMouseEnter={() => setPreviewedArc({ id: item.id, kind: "activity" })} onMouseLeave={() => setPreviewedArc((current) => current?.id === item.id ? null : current)}>
                <path aria-hidden="true" className="clock-activity-hit" d={path} onClick={() => select(item.id)} />
                <path aria-label={`${item.start}–${item.end}: recorded — ${item.activity}${item.result ? `. ${item.result}` : ""}`} className="clock-activity-arc" d={path} onBlur={() => setPreviewedArc((current) => current?.id === item.id ? null : current)} onClick={() => select(item.id)} onFocus={() => setPreviewedArc({ id: item.id, kind: "activity" })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(item.id); } }} role="button" tabIndex={0} />
                <line aria-hidden="true" className="clock-slice-boundary" x1={boundaryInner.x} x2={boundaryOuter.x} y1={boundaryInner.y} y2={boundaryOuter.y} />
                {item.result && (!memberView || item.type === "performance" || item.completedMovement) ? <g aria-label={`${item.result} for ${item.activity}`} className={`clock-result-marker ${item.type}`} onBlur={() => setPreviewedResultId((current) => current === item.id ? null : current)} onClick={() => { setPreviewedResultId(item.id); select(item.id); }} onFocus={() => setPreviewedResultId(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPreviewedResultId(item.id); select(item.id); } }} onMouseEnter={() => setPreviewedResultId(item.id)} onMouseLeave={() => setPreviewedResultId((current) => current === item.id ? null : current)} role="button" tabIndex={0} transform={`translate(${end.x} ${end.y})`}>
                  <circle aria-hidden="true" className="clock-marker-hit" cx="0" cy="0" r="24" />
                  {item.type === "performance" ? <path aria-hidden="true" className="clock-credit-mark clock-marker-shape" d="M -7 0 L 0 -7 L 7 0 L 0 7 Z" /> : <circle aria-hidden="true" className="clock-w-mark clock-marker-shape" cx="0" cy="0" r="6" />}
                </g> : null}
              </g>;
            })}
          </g>
          {previewedClockItem && previewedClockPoint ? <g aria-hidden="true" className="clock-result-tooltip">
            <rect height="47" rx="4" width={tooltipWidth} x={tooltipX} y={tooltipY} />
            <text className="clock-tooltip-title" x={tooltipX + 12} y={tooltipY + 19}>{tooltipActivity}</text>
            <text className="clock-tooltip-detail" x={tooltipX + 12} y={tooltipY + 36}>{previewedClockItem.detail}</text>
          </g> : null}
          {isToday && hand ? <g aria-hidden="true" className="clock-now"><line x1="320" x2={hand.x} y1="320" y2={hand.y} /><circle cx="320" cy="320" r="5" /></g> : null}
          {isToday && secondsHand ? <g aria-hidden="true" className="clock-seconds"><line x1="320" x2={secondsHand.x} y1="320" y2={secondsHand.y} /><circle cx="320" cy="320" r="2.5" /></g> : null}
          <g aria-hidden="true" className="clock-centre-copy">
            <text className="clock-centre-kicker" x="320" y="284">{isToday ? "NOW · IST" : "SELECTED DAY"}</text>
            <text className="clock-centre-time" x="320" y="326">{isToday ? now ? timeLabel(now) : "—" : `${activities.length}`}</text>
            <text className="clock-centre-note" x="320" y="355">{isToday ? now ? currentPlan ? "planned block" : nextPlan ? `next · ${nextPlan.start}` : "open time" : "India Standard Time" : activities.length === 1 ? "recorded activity" : "recorded activities"}</text>
          </g>
        </svg>
        <span aria-live="polite" className="sr-only">{previewedResult ? `${previewedResult.result} for ${previewedResult.activity}` : ""}</span>
      </div>
      {!(memberView && quietIntro && !activities.length && !calculationRunning && !calculationPending && !conflictHref) ? <ContextualReading
        className="day-annotation"
        label="Living Day reading"
        footer={memberView && quietIntro ? (activities.length ? <details><summary>About the marks</summary>{annotationFooter}</details> : null) : annotationFooter}
      >
        {calculationRunning ? <div className="clock-calculation-status" role="status"><i aria-hidden="true" /><div><strong>Calculating completed movement</strong><span>Approved records are settling into W and credit results. This view refreshes automatically.</span></div></div> : calculationPending ? <div className="clock-calculation-status waiting" role="status"><i aria-hidden="true" /><div><strong>Awaiting calculation</strong><span>Human confirmation is complete. Review will show if calculation needs attention.</span></div></div> : null}
        {contextLens === "weather" && weather ? <>
          <p className="annotation-kicker">Outside now · {weather.location}</p>
          <time>Updated {localContextTime(weather.observedAt)} · {weather.timezone}</time>
          <h3>{roundedTemperature(weather.temperatureC)} · {weather.conditionLabel}</h3>
          <p>Feels like {roundedTemperature(weather.apparentTemperatureC)}. Cloud cover {Math.round(weather.cloudCover)}%{weather.precipitationMm ? ` · ${weather.precipitationMm.toFixed(1)} mm precipitation` : ""}.</p>
          <button aria-pressed={ambientEnabled} className="ambient-toggle" onClick={updateAmbientPreference} type="button">
            <span>Ambient conditions</span><strong>{ambientEnabled ? "On" : "Off"}</strong>
          </button>
        </> : contextLens === "briefing" && briefing ? <>
          <p className="annotation-kicker">{briefing.freshness === "stale" ? "Earlier briefing" : briefing.artifact.title}</p>
          <time>Generated {briefingTime(briefing.artifact.generated_at)} · {briefing.artifact.timezone}</time>
          <ol className="daily-briefing-signals">
            {briefing.artifact.signals.map((signal) => <li key={signal.id}>
              <p className="briefing-signal-status">{signal.rank} · {signal.status}</p>
              <h3>{signal.headline}</h3>
              <p>{signal.summary}</p>
              {signal.iov_reading ? <p className="briefing-iov-reading"><strong>IoV reading</strong> · {signal.iov_reading}</p> : null}
              <p className="briefing-sources">{signal.sources.map((source, index) => <span key={`${signal.id}-${source.url}`}>{index ? " · " : ""}<a href={source.url} rel="noopener noreferrer" target="_blank">{source.publisher} ↗</a></span>)}</p>
            </li>)}
          </ol>
          {briefing.artifact.full_briefing_url ? <a className="annotation-link" href={briefing.artifact.full_briefing_url} rel="noopener noreferrer" target="_blank">Read full briefing ↗</a> : null}
        </> : inspectedPlan ? <>
          <p className="annotation-kicker">Planned intention · {inspectedPlan.status}</p>
          <time>{inspectedPlan.start}–{inspectedPlan.end}</time>
          <h3>{inspectedPlan.activity}</h3>
          <p>This is an intention, not recorded life.</p>
          {inspectedPlan.aiCodexActivity ? <p><strong>AI/Codex</strong> · {inspectedPlan.aiCodexActivity}</p> : null}
          {inspectedPlan.intendedOutcome ? <p><strong>Goal</strong> · {inspectedPlan.intendedOutcome}</p> : null}
          <span className="annotation-label">Recorded at this time</span>
          <p>{planActuals.length ? planActuals.map((item) => item.activity).join(" · ") : "No canonical activity overlaps this planned block yet."}</p>
          {assistantUrl ? <a className="annotation-link" href={assistantUrl} rel="noopener noreferrer" target="_blank">Plan or revise with Assistant ↗</a> : null}
        </> : selected ? <>
          <p className="annotation-kicker">Recorded life · {selected.type === "performance" ? "Performance" : selected.node}</p>
          <time>{selected.start}–{selected.end}</time>
          <h3>{selected.activity}</h3>
          <p>{selected.detail}</p>
          {selected.result ? <strong className="annotation-result">{selected.result}</strong> : selected.needsReview ? <strong className="annotation-pending">Needs a human decision in Review</strong> : selected.calculating ? <strong className="annotation-calculating">{calculationRunning ? "Calculating" : "Awaiting"} {selected.type === "performance" ? performanceTerm : "W movement"}…</strong> : <span className="annotation-pending">No completed movement yet</span>}
          <Link className="annotation-link" href={selected.reviewHref ?? `/slices/canonical/${selected.id}`}>Review or correct this activity →</Link>
        </> : conflictHref ? <>
          <p className="annotation-kicker">Timeline correction</p>
          <h3>Two activities occupy the same time</h3>
          <p>The conflict is marked in red on the clock. Correct the affected time before adding more to this day.</p>
          <Link className="button danger" href={conflictHref}>Correct time conflict</Link>
        </> : quietIntro ? <p className="annotation-hint">{activities.length ? `Tap a coloured arc to read ${activities.length === 1 ? "the activity" : "an activity"}.` : "Nothing on the circle yet."}</p> : <>
          <p className="annotation-kicker">{isToday ? "Present moment" : memberView ? "Your day" : "Canonical day"}</p>
          {focus ? <><span className="annotation-label">Daily focus</span><h3>{focus}</h3></> : null}
          {isToday && currentPlan ? <><time>{currentPlan.start}–{currentPlan.end}</time><h3>{currentPlan.activity}</h3><p>This is planned intention. It becomes recorded life only after you explicitly log it.</p>{now ? <strong className="annotation-pending">{remainingLabel(new Date(currentPlan.endAt).getTime() - now.getTime())}</strong> : null}</> : isToday && nextPlan ? <><span className="annotation-label">Next planned</span><time>{nextPlan.start}</time><h3>{nextPlan.activity}</h3></> : <><h3>{activities.length ? `${activities.length} recorded ${activities.length === 1 ? "activity" : "activities"}` : "An open day"}</h3><p>{activities.length ? (memberView ? "Choose a coloured arc to read your activity and its review status." : "Choose a coloured arc to read the canonical activity.") : "Nothing has been recorded for this date yet."}</p></>}
          {nativeLogHref ? <><Link className="annotation-link primary" href={nativeLogHref}>Log by voice →</Link>{assistantUrl ? <a className="annotation-link" href={assistantUrl} rel="noopener noreferrer" target="_blank">Use the Assistant instead ↗</a> : null}</> : assistantUrl ? <a className="annotation-link primary" href={assistantUrl} rel="noopener noreferrer" target="_blank">{isToday ? "Log what actually happened ↗" : "Add something to this day ↗"}</a> : null}
        </>}
      </ContextualReading> : null}
    </div>
  </section>;
}
