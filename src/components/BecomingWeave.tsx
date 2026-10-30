"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { WELLBEING_IDENTITY_EIGHT_RING_PROFILE, type WellbeingIdentityNode } from "@theinternetofvalue/wellbeing-identity-contracts";
import { ContextualReading } from "@/components/ContextualReading";
import { WellbeingMovementPlot, type PeriodMovementDatum, type SettlementMovementDatum } from "@/components/WellbeingMovementPlot";
import { chartTickIndices } from "@/lib/chart-axis";
import type { InsightNode, InsightWeaveLane, InsightWeaveSeries, InsightWeaveStitch, IntraDayWSeries } from "@/lib/trends";
import { formatWMovement, formatWState } from "@/lib/w-presentation";

const WIDTH = 1040;
const HEIGHT = 430;
const LEFT = 132;
const RIGHT = 22;
const LANE_Y = [72, 124, 176, 228, 280, 366];
// Optional wellbeing-score row under Performance, on the same day columns.
const SCORE_LABEL_Y = 412, SCORE_TOP = 428, SCORE_BOTTOM = 488, SCORE_HEIGHT = 520;

/** End-of-day W for one day; on a day without completed movement the score carries from the last movement. */
export type WeaveScorePoint = { date: string; w: number | null; moved: boolean; net: number | null };

export type InsightEvidenceDay = {
  date: string;
  label: string;
  activityCount: number;
  wValue: number | null;
  credits: number;
};

export type InsightEvidence = {
  periodMovement: PeriodMovementDatum[];
  selectedSeries: IntraDayWSeries | null;
  days: InsightEvidenceDay[];
  houseOfBrosW: number;
  houseOfBrosMinutes: number;
  iovCredits: number;
  iovMinutes: number;
  gfeCredits: number;
  gfeMinutes: number;
};

type InsightLens = "reading" | "movement" | "evidence";

export function BecomingWeave({
  evidence,
  series,
  selectedNode,
  selectedDate,
  scorePoints = [],
}: {
  evidence: InsightEvidence;
  series: InsightWeaveSeries;
  selectedNode?: InsightNode;
  selectedDate?: string;
  scorePoints?: WeaveScorePoint[];
}) {
  const router = useRouter();
  const [previewNode, setPreviewNode] = useState<InsightNode | null>(null);
  const [previewStitchId, setPreviewStitchId] = useState<string | null>(null);
  const [selectedStitchId, setSelectedStitchId] = useState<string | null>(null);
  const [lens, setLens] = useState<InsightLens>("reading");
  const stitches = useMemo(() => series.lanes.flatMap((lane) => lane.stitches), [series.lanes]);
  const previewStitch = stitches.find((stitch) => stitch.id === previewStitchId) ?? null;
  const selectedCandidate = stitches.find((stitch) => stitch.id === selectedStitchId) ?? null;
  const selectedStitch = selectedCandidate && selectedCandidate.node === selectedNode && selectedCandidate.start_date === selectedDate ? selectedCandidate : null;
  const visibleStitch = previewStitch ?? selectedStitch;
  const visibleNode = visibleStitch?.node ?? previewNode ?? selectedNode;
  const visibleLane = series.lanes.find((lane) => lane.node === visibleNode) ?? null;
  const startMs = new Date(`${series.start_date}T00:00:00+05:30`).getTime();
  const endMs = new Date(`${series.end_date}T23:59:59.999+05:30`).getTime();
  const span = Math.max(1, endMs - startMs);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const xFor = (iso: string) => LEFT + Math.min(1, Math.max(0, (new Date(iso).getTime() - startMs) / span)) * plotWidth;
  const dayWidth = plotWidth / series.range_days;
  const tickIndices = chartTickIndices(series.range_days);
  const dates = dateRange(series.start_date, series.range_days);
  const settlements = settlementValues(evidence.selectedSeries);
  const score = scoreRow(scorePoints, dates, (index) => LEFT + dayWidth * (index + 0.5));
  const height = score ? SCORE_HEIGHT : HEIGHT;
  const ruleBottom = score ? SCORE_BOTTOM + 12 : 393;

  const navigate = (node?: InsightNode, date?: string) => {
    const search = new URLSearchParams({ range: String(series.range_days) });
    if (node) search.set("node", node);
    if (date) search.set("date", date);
    router.push(`/trends?${search.toString()}`, { scroll: false });
  };

  const selectLane = (node: InsightNode) => {
    setLens("reading");
    setSelectedStitchId(null);
    navigate(node);
  };

  const selectStitch = (stitch: InsightWeaveStitch) => {
    setLens("reading");
    setSelectedStitchId(stitch.id);
    navigate(stitch.node, stitch.start_date);
  };

  const clearSelection = () => {
    setLens("reading");
    setPreviewNode(null);
    setPreviewStitchId(null);
    setSelectedStitchId(null);
    navigate();
  };

  const chooseMovementDay = (value: PeriodMovementDatum) => {
    setLens("movement");
    setSelectedStitchId(null);
    navigate(selectedNode, value.date);
  };

  const handleEscape = () => {
    if (lens !== "reading") {
      setLens("reading");
      return;
    }
    clearSelection();
  };

  const readingContent = visibleStitch ? <StitchReading stitch={visibleStitch} /> : visibleLane ? <LaneReading evidence={evidence} lane={visibleLane} selectedDate={selectedDate} /> : <OverviewReading evidence={evidence} series={series} />;
  const contextualContent = lens === "movement"
    ? <MovementReading date={selectedDate} series={evidence.selectedSeries} />
    : lens === "evidence"
      ? <EvidenceReading date={selectedDate} node={selectedNode} />
      : readingContent;
  const footer = <ReadingControls date={selectedDate} hasSelection={Boolean(selectedNode || selectedDate || selectedStitch)} lens={lens} onClear={clearSelection} onLens={setLens} />;

  return <section className="becoming-weave" aria-labelledby="becoming-weave-title" onKeyDown={(event) => { if (event.key === "Escape") handleEscape(); }}>
    <div className="weave-heading"><div><p className="meta">The becoming weave</p><h2 id="becoming-weave-title">Where recorded life gathered</h2></div><p><span className="pointer-instruction">Hover to glance · select to keep</span><span className="touch-instruction">Tap a thread or stitch to read</span></p></div>
    <div className="weave-layout">
      <div className="weave-field">
        <svg className={`weave-svg${previewStitch ? " inspecting" : ""}`} viewBox={`0 0 ${WIDTH} ${height}`} role="group" aria-label={`${series.range_days}-day view of recorded activity by primary Wellbecoming node`}>
          <desc>Five inner Wellbecoming threads and one separate Performance thread. Activity stitches follow their actual time. Completed W movement and Performance credits use separate marks.</desc>
          {dates.map((date, index) => {
            const x = LEFT + dayWidth * index;
            const selected = date === selectedDate;
            const movement = evidence.periodMovement.find((item) => item.date === date) ?? { id: date, date, label: longDate(date), value: null };
            const result = movement.value === null ? "No completed W movement" : `${formatWMovement(movement.value)} completed movement`;
            return <g className={`weave-date-control${selected ? " selected" : ""}`} key={date} role="button" tabIndex={0} aria-label={`${longDate(date)}. ${result}. Open movement reading.`} onClick={() => chooseMovementDay(movement)} onKeyDown={(event) => activate(event, () => chooseMovementDay(movement))}>
              {selected ? <rect className="weave-selected-day" x={x} y="39" width={dayWidth} height={ruleBottom - 39} /> : null}
              <line className="weave-day-rule" x1={x} x2={x} y1="42" y2={ruleBottom} />
              <rect className="weave-date-hit" x={x} y="0" width={dayWidth} height="44" />
              {tickIndices.has(index) ? <text className="weave-date-label" x={x + 5} y="25">{shortDate(date)}</text> : null}
            </g>;
          })}
          <line className="weave-day-rule" x1={WIDTH - RIGHT} x2={WIDTH - RIGHT} y1="42" y2={ruleBottom} />
          <text className="weave-zone-label" x={LEFT} y="326">CAPABILITY AND CONTRIBUTION</text>
          {series.lanes.map((lane, laneIndex) => {
            const y = LANE_Y[laneIndex];
            const selected = lane.node === selectedNode;
            const previewed = lane.node === previewNode && !previewStitch;
            return <g className={`weave-lane tone-${lane.node.toLowerCase()}${selected ? " selected" : ""}${previewed ? " previewed" : ""}`} key={lane.node}>
              <g className="weave-lane-label" role="button" tabIndex={0} aria-label={`${lane.node}. ${lane.activity_count} activities. ${lane.node === "Performance" ? `${whole(lane.credits)} credits` : `${formatWMovement(lane.w_net)} movement`}. Select this thread.`} onBlur={() => setPreviewNode((current) => current === lane.node ? null : current)} onClick={() => selectLane(lane.node)} onFocus={() => setPreviewNode(lane.node)} onKeyDown={(event) => activate(event, () => selectLane(lane.node))} onMouseEnter={() => setPreviewNode(lane.node)} onMouseLeave={() => setPreviewNode((current) => current === lane.node ? null : current)}>
                <rect className="weave-label-hit" x="0" y={y - 22} width={LEFT - 8} height="44" />
                <text className="weave-node-label" x="0" y={y + 4}>{lane.node}</text>
              </g>
              <line className="weave-thread" x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
              {lane.stitches.map((stitch) => {
                const x1 = xFor(stitch.start_at);
                const x2 = Math.max(x1 + 3, xFor(stitch.end_at));
                const active = stitch.id === visibleStitch?.id;
                const aria = stitchLabel(stitch);
                const endpointVisible = new Date(stitch.end_at).getTime() >= startMs && new Date(stitch.end_at).getTime() <= endMs;
                return <g className={`weave-stitch${active ? " active" : ""}`} key={stitch.id} role="button" tabIndex={0} aria-label={aria} onBlur={() => setPreviewStitchId((current) => current === stitch.id ? null : current)} onClick={() => selectStitch(stitch)} onFocus={() => setPreviewStitchId(stitch.id)} onKeyDown={(event) => activate(event, () => selectStitch(stitch))} onMouseEnter={() => setPreviewStitchId(stitch.id)} onMouseLeave={() => setPreviewStitchId((current) => current === stitch.id ? null : current)}>
                  <line className="weave-stitch-hit" x1={x1} x2={x2} y1={y} y2={y} />
                  <line className="weave-stitch-focus" x1={x1} x2={x2} y1={y} y2={y} />
                  <line className="weave-stitch-line" x1={x1} x2={x2} y1={y} y2={y} />
                  <line className="weave-stitch-boundary" x1={x1} x2={x1} y1={y - 9} y2={y + 9} />
                  {stitch.w_change !== null && endpointVisible ? <g className={`weave-w-marker${stitch.w_change < 0 ? " negative" : " positive"}`} aria-hidden="true">
                    <line x1={x2} x2={x2} y1={y} y2={y + (stitch.w_change < 0 ? 17 : -17)} />
                    <circle cx={x2} cy={y + (stitch.w_change < 0 ? 17 : -17)} r="4.5" />
                  </g> : null}
                  {stitch.credits !== null && endpointVisible ? <path className="weave-credit-marker" aria-hidden="true" d={diamond(x2, y - 19, 6)} /> : null}
                </g>;
              })}
            </g>;
          })}
                  {score ? <g className="weave-score" role="img" aria-label={`Wellbeing score by day: ${formatWState(score.first)} to ${formatWState(score.last)}.`}>
            <text className="weave-zone-label" x={LEFT} y={SCORE_LABEL_Y}>WELLBEING SCORE</text>
            <text className="weave-node-label" x="0" y={(SCORE_TOP + SCORE_BOTTOM) / 2 + 4}>Score</text>
            <text className="weave-score-scale" x={LEFT - 8} y={SCORE_TOP + 4} textAnchor="end">{score.high.toFixed(4)}</text>
            <text className="weave-score-scale" x={LEFT - 8} y={SCORE_BOTTOM + 4} textAnchor="end">{score.low.toFixed(4)}</text>
            <line className="weave-thread" x1={LEFT} x2={WIDTH - RIGHT} y1={SCORE_TOP} y2={SCORE_TOP} />
            <line className="weave-thread" x1={LEFT} x2={WIDTH - RIGHT} y1={SCORE_BOTTOM} y2={SCORE_BOTTOM} />
            {score.paths.map((path) => <path className="weave-score-line" d={path} key={path} />)}
            {score.marks.map((mark) => <circle className="weave-score-marker" cx={mark.x} cy={mark.y} r="3.5" key={mark.date} />)}
            {score.marks.length || score.paths.length ? dates.map((date, index) => {
              const point = scorePoints.find((item) => item.date === date);
              if (!point || point.w === null) return null;
              return <rect className="weave-score-hit" x={LEFT + dayWidth * index} y={SCORE_TOP - 8} width={dayWidth} height={SCORE_BOTTOM - SCORE_TOP + 16} key={date}>
                <title>{`${longDate(date)} · ${formatWState(point.w)}${point.moved && point.net !== null ? ` · ${formatWMovement(point.net)} that day` : " · no completed movement, score held"}`}</title>
              </rect>;
            }) : null}
          </g> : null}
        </svg>
        <div className="weave-mobile" aria-label="Wellbecoming node index">
          {series.lanes.map((lane) => <div className={`weave-mobile-lane${lane.node === selectedNode ? " selected" : ""}`} key={lane.node}>
            {lane.node === "Performance" ? <span className="weave-mobile-zone">Capability and contribution</span> : null}
            <button type="button" onClick={() => selectLane(lane.node)} onFocus={() => setPreviewNode(lane.node)}>
              <span>{lane.node}</span>
              <small>{lane.activity_count} {lane.activity_count === 1 ? "activity" : "activities"}</small>
              <span className="weave-mobile-trace" aria-hidden="true">
                {lane.stitches.map((stitch) => {
                  const stitchStart = Math.min(1, Math.max(0, (new Date(stitch.start_at).getTime() - startMs) / span)) * 100;
                  const stitchEnd = Math.min(1, Math.max(0, (new Date(stitch.end_at).getTime() - startMs) / span)) * 100;
                  return <i key={stitch.id} style={{ left: `${stitchStart}%`, width: `${Math.max(1.2, stitchEnd - stitchStart)}%` }} />;
                })}
              </span>
            </button>
            {lane.node === selectedNode ? <ol>{lane.stitches.filter((stitch) => !selectedDate || stitch.start_date === selectedDate).map((stitch) => <li key={stitch.id}><button type="button" onClick={() => selectStitch(stitch)}><time>{shortDate(stitch.start_date)} · {timeRange(stitch)}</time><strong>{stitch.activity}</strong><span>{stitchResult(stitch)}</span></button></li>)}</ol> : null}
            {lane.node === selectedNode ? <ContextualReading className="weave-reading contextual-reading-mobile" footer={footer} label="Insights reading">{contextualContent}{lens === "reading" && visibleNode ? <IdentityDestinationLocator node={visibleNode} /> : null}</ContextualReading> : null}
          </div>)}
          {score ? <div className="weave-mobile-lane weave-mobile-score">
            <span className="weave-mobile-zone">Wellbeing score</span>
            <div><span>Score</span><small>{formatWState(score.last)}</small>
              <svg className="weave-mobile-score-trace" viewBox={`${LEFT} ${SCORE_TOP - 6} ${WIDTH - LEFT - RIGHT} ${SCORE_BOTTOM - SCORE_TOP + 12}`} preserveAspectRatio="none" aria-hidden="true">{score.paths.map((path) => <path d={path} key={path} />)}</svg>
            </div>
          </div> : null}
        </div>
        <div className="weave-key"><span><i className="stitch" />Recorded slice</span><span><i className="movement" />Completed W</span><span><i className="credit" />Performance credits</span>{score ? <span><i className="score" />Wellbeing score</span> : null}</div>
        {score ? <details className="weave-score-table"><summary>Wellbeing score as a table</summary><table><thead><tr><th scope="col">Day</th><th scope="col">End-of-day W</th><th scope="col">Change</th></tr></thead><tbody>{dates.map((date) => {
          const point = scorePoints.find((item) => item.date === date);
          return <tr key={date}><th scope="row">{longDate(date)}</th><td>{point?.w == null ? "—" : formatWState(point.w)}</td><td>{point?.moved && point.net !== null ? formatWMovement(point.net) : point?.w == null ? "—" : "held"}</td></tr>;
        })}</tbody></table></details> : null}
        {!selectedNode ? <ContextualReading className="weave-reading contextual-reading-mobile" footer={footer} label="Insights period reading">{contextualContent}</ContextualReading> : null}
      </div>
      <ContextualReading className="weave-reading contextual-reading-desktop" footer={footer} label="Insights reading">
        {contextualContent}
        {lens === "reading" && visibleNode ? <IdentityDestinationLocator node={visibleNode} /> : null}
      </ContextualReading>
    </div>
    {lens === "movement" && selectedDate ? <MovementLayer date={selectedDate} onSelectDay={chooseMovementDay} periodMovement={evidence.periodMovement} series={evidence.selectedSeries} settlements={settlements} /> : null}
    {lens === "evidence" ? <EvidenceLayer date={selectedDate} evidence={evidence} node={selectedNode} series={series} /> : null}
    <details className="weave-reflection"><summary><span className="meta">Private reflection</span><strong>Reflect on this period</strong></summary><div><h2>{selectedNode ? `What did you notice around ${selectedNode} during this period?` : "What would you repeat, protect, or adjust next week?"}</h2><p>This prompt is not saved. It is simply a quiet place to close the period.</p></div></details>
  </section>;
}

function OverviewReading({ evidence, series }: { evidence: InsightEvidence; series: InsightWeaveSeries }) {
  const activities = series.lanes.reduce((total, lane) => total + lane.activity_count, 0);
  const activeNodes = series.lanes.filter((lane) => lane.activity_count > 0).length;
  const hasW = series.lanes.some((lane) => lane.stitches.some((stitch) => stitch.w_change !== null));
  const hasPerformance = series.lanes.find((lane) => lane.node === "Performance")?.stitches.some((stitch) => stitch.credits !== null) ?? false;
  const totalCredits = evidence.iovCredits + evidence.gfeCredits;
  return <><p className="annotation-kicker">Period overview</p><h3>{activities ? `${activities} recorded ${activities === 1 ? "activity" : "activities"}` : "No recorded life in this range"}</h3><p>{activities ? `Recorded life touched ${activeNodes} of 6 primary threads. Choose a thread to see where it gathered, or a stitch to read the canonical activity.` : "The weave stays open without treating an empty period as failure."}</p>{activities && !hasW ? <p className="weave-neutral-note">No completed W movement appears in this range.</p> : null}{hasPerformance ? <CommunityRoutes evidence={evidence} totalCredits={totalCredits} /> : <p className="weave-neutral-note">No Performance contribution appears in this range.</p>}<p className="weave-neutral-note">Thread density describes recorded presence, not wellbeing quality or a target.</p></>;
}

function LaneReading({ evidence, lane, selectedDate }: { evidence: InsightEvidence; lane: InsightWeaveLane; selectedDate?: string }) {
  const dayStitches = selectedDate ? lane.stitches.filter((stitch) => stitch.start_date === selectedDate) : lane.stitches;
  return <><p className="annotation-kicker">{lane.node === "Performance" ? "Capability and contribution" : "Wellbecoming thread"}</p><h3>{lane.node}</h3><p>{selectedDate ? `${dayStitches.length} recorded ${dayStitches.length === 1 ? "activity" : "activities"} on ${longDate(selectedDate)}.` : `${lane.activity_count} recorded ${lane.activity_count === 1 ? "activity" : "activities"} · ${duration(lane.logged_minutes)}.`}</p>{lane.node === "Performance" ? <><strong className="weave-reading-result">{whole(lane.credits)} credits</strong><CommunityRoutes evidence={evidence} totalCredits={lane.credits} /></> : <strong className="weave-reading-result">{formatWMovement(lane.w_net)} completed movement</strong>}<p>{selectedDate ? dayStitches.length ? "Choose a stitch for its exact canonical reading." : "No canonical activity appears for this thread and date." : "Choose a date heading for movement, or a stitch for an exact reading."}</p></>;
}

function StitchReading({ stitch }: { stitch: InsightWeaveStitch }) {
  return <><p className="annotation-kicker">Recorded life · {stitch.node}</p><time>{longDate(stitch.start_date)} · {timeRange(stitch)}</time><h3>{stitch.activity}</h3><p>{stitch.node === "Performance" ? [stitch.sao_lane, stitch.skill_level].filter(Boolean).join(" · ") || "Performance" : stitch.node}</p>{stitch.node === "Performance" ? <CommunityMark community={stitch.community} /> : null}<strong className="weave-reading-result">{stitchResult(stitch)}</strong>{stitch.start_date !== stitch.settlement_date ? <p className="weave-neutral-note">This activity began on {longDate(stitch.start_date)}; its completed result settled on {longDate(stitch.settlement_date)}.</p> : null}<Link className="annotation-link" href={`/slices/canonical/${stitch.id}`}>Review or correct this activity →</Link><Link className="annotation-link quiet" href={`/day?date=${stitch.start_date}`}>Open Living Day →</Link></>;
}

function MovementReading({ date, series }: { date?: string; series: IntraDayWSeries | null }) {
  if (!date) return <><p className="annotation-kicker">Movement lens</p><h3>Choose a day</h3><p>Select a point from the movement horizon to read its settlement path.</p></>;
  if (!series || series.points.length < 2) return <><p className="annotation-kicker">Movement lens · {longDate(date)}</p><h3>No completed W movement</h3><p>Recorded life can appear without a completed movement result. Nothing is treated as zero.</p></>;
  return <><p className="annotation-kicker">Movement lens · {longDate(date)}</p><h3>{formatWState(series.projection.openingW)} → {formatWState(series.projection.closingW)}</h3><strong className="weave-reading-result">{formatWMovement(series.projection.netW)} completed movement</strong><p>Select a settlement point below to read the exact transition.</p></>;
}

function EvidenceReading({ date, node }: { date?: string; node?: InsightNode }) {
  const scope = [node, date ? longDate(date) : null].filter(Boolean).join(" · ");
  return <><p className="annotation-kicker">Evidence lens{scope ? ` · ${scope}` : ""}</p><h3>Exact values</h3><p>The ledger below preserves completed values and settlement timing without repeating the visual overview.</p><p className="weave-neutral-note">Opening state, signed movement, closing state, W and Performance credits remain separate.</p></>;
}

function ReadingControls({
  date,
  hasSelection,
  lens,
  onClear,
  onLens,
}: {
  date?: string;
  hasSelection: boolean;
  lens: InsightLens;
  onClear: () => void;
  onLens: (lens: InsightLens) => void;
}) {
  return <div className="contextual-lens-controls" aria-label="Insights reading mode">
    <button aria-pressed={lens === "reading"} type="button" onClick={() => onLens("reading")}>Reading</button>
    <button aria-pressed={lens === "movement"} disabled={!date} type="button" onClick={() => onLens("movement")}>Movement</button>
    <button aria-pressed={lens === "evidence"} type="button" onClick={() => onLens("evidence")}>Evidence</button>
    {hasSelection ? <button className="weave-clear" type="button" onClick={onClear}>Period overview</button> : null}
  </div>;
}

function MovementLayer({ date, onSelectDay, periodMovement, series, settlements }: { date: string; onSelectDay: (value: PeriodMovementDatum) => void; periodMovement: PeriodMovementDatum[]; series: IntraDayWSeries | null; settlements: SettlementMovementDatum[] }) {
  return <section className="contextual-layer movement-layer" aria-labelledby="settlement-path-title">
    <div className="contextual-layer-heading"><div><p className="meta">Movement over the period</p><h2 id="settlement-path-title">Daily completed W</h2></div><p>Zero stays central. Ember marks selection, not a desired result.</p></div>
    <WellbeingMovementPlot onSelect={onSelectDay} selectedId={date} values={periodMovement} variant="period" />
    <div className="settlement-section">
      <div className="contextual-layer-heading"><div><p className="meta">Selected day · {longDate(date)}</p><h3>Settlement path</h3></div><Link className="annotation-link" href={`/day?date=${date}`}>Open Living Day →</Link></div>
      {series && settlements.length ? <WellbeingMovementPlot closingW={series.projection.closingW} openingW={series.projection.openingW} values={settlements} variant="settlement" /> : <p className="weave-neutral-note">No completed W settlement appears for this day.</p>}
    </div>
  </section>;
}

function EvidenceLayer({ date, evidence, node, series }: { date?: string; evidence: InsightEvidence; node?: InsightNode; series: InsightWeaveSeries }) {
  const selectedLane = node ? series.lanes.find((lane) => lane.node === node) ?? null : null;
  const performanceOnly = node === "Performance";
  const days = date ? evidence.days.filter((day) => day.date === date) : evidence.days;
  const transitions = settlementValues(evidence.selectedSeries);
  return <section className="contextual-layer evidence-layer" aria-labelledby="evidence-layer-title">
    <div className="contextual-layer-heading"><div><p className="meta">Evidence layer</p><h2 id="evidence-layer-title">{node ? `${node} exact reading` : date ? `${longDate(date)} exact reading` : "Period exact values"}</h2></div><p>Completed records only</p></div>
    {selectedLane ? <dl className="evidence-node-summary"><div><dt>Recorded life</dt><dd>{selectedLane.activity_count} {selectedLane.activity_count === 1 ? "activity" : "activities"}</dd></div><div><dt>Recorded time</dt><dd>{duration(selectedLane.logged_minutes)}</dd></div><div><dt>{node === "Performance" ? "Performance contribution" : "Completed movement"}</dt><dd>{node === "Performance" ? `${whole(selectedLane.credits)} credits` : formatWMovement(selectedLane.w_net)}</dd></div></dl> : null}
    <section className={`evidence-days${performanceOnly ? " performance-only" : ""}`} aria-labelledby="evidence-days-title"><h3 id="evidence-days-title">{date ? "Selected day" : "Recorded days"}</h3><ol>{days.map((day) => <li key={day.date}><time dateTime={day.date}>{day.label}</time><span>{day.activityCount} {day.activityCount === 1 ? "activity" : "activities"}</span>{performanceOnly ? null : <strong>{day.wValue === null ? "No completed W" : formatWMovement(day.wValue)}</strong>}<span>{whole(day.credits)} credits</span></li>)}</ol></section>
    {!performanceOnly && date && evidence.selectedSeries ? <details className="evidence-transitions"><summary>Show calculation evidence</summary><div className="evidence-opening-closing"><span>Opening {formatWState(evidence.selectedSeries.projection.openingW)}</span><span>Closing {formatWState(evidence.selectedSeries.projection.closingW)}</span></div><ol>{transitions.map((item) => <li key={item.id}><time>{item.label}</time><span>{formatWState(item.preW)}</span><strong>{formatWMovement(item.change)}</strong><span>{formatWState(item.postW)}</span></li>)}</ol></details> : null}
    <section className="evidence-commons" aria-labelledby="evidence-commons-title"><h3 id="evidence-commons-title">{performanceOnly ? "Performance credit routing" : "Separate Commons measures"}</h3><dl className={performanceOnly ? "performance-only" : ""}>{performanceOnly ? null : <div><dt><CommunityMark community="house_of_bros" /></dt><dd>{formatWMovement(evidence.houseOfBrosW)}</dd><span>{duration(evidence.houseOfBrosMinutes)}</span></div>}<div><dt><CommunityMark community="iov" /></dt><dd>{whole(evidence.iovCredits)} credits</dd><span>{duration(evidence.iovMinutes)}</span></div><div><dt><CommunityMark community="gfe" /></dt><dd>{whole(evidence.gfeCredits)} credits</dd><span>{duration(evidence.gfeMinutes)}</span></div></dl></section>
  </section>;
}

function CommunityRoutes({ evidence, totalCredits }: { evidence: InsightEvidence; totalCredits: number }) {
  return <div className="community-routes" aria-label={`${whole(totalCredits)} Performance credits routed outward separately`}>
    {evidence.iovCredits ? <span><CommunityMark community="iov" /> <strong>{whole(evidence.iovCredits)}</strong></span> : null}
    {evidence.gfeCredits ? <span><CommunityMark community="gfe" /> <strong>{whole(evidence.gfeCredits)}</strong></span> : null}
  </div>;
}

function CommunityMark({ community }: { community: string }) {
  const key = community.toLowerCase();
  const mark = key === "iov"
    ? { src: "/brand/communities/iov.webp", label: "IoV Research Foundation" }
    : key === "gfe"
      ? { src: "/brand/communities/gfe.webp", label: "Growth Flow Engineering" }
      : { src: "/brand/communities/house-of-bros.webp", label: "HouseOfBros" };
  return <span className="community-mark"><Image alt="" aria-hidden="true" height={28} src={mark.src} width={28} /><span>{mark.label}</span></span>;
}

function IdentityDestinationLocator({ node }: { node: InsightNode }) {
  const activeNode: WellbeingIdentityNode = node === "Performance" ? "~~Skills" : "~~IdentityState";
  const active = WELLBEING_IDENTITY_EIGHT_RING_PROFILE.find((ring) => ring.path === activeNode)!;
  return <div className="identity-destination"><div><p className="annotation-kicker">Identity context</p><strong>{active.label}</strong></div><svg viewBox="0 0 120 120" role="img" aria-label={`${active.label} ring highlighted as identity context`}>
    {WELLBEING_IDENTITY_EIGHT_RING_PROFILE.map((ring) => <circle className={ring.path === activeNode ? "active" : ""} key={ring.path} cx="60" cy="60" r={18 + ring.order * 5} fill="none" stroke={ring.path === "~~ConsentAndDisclosure" ? "#8a857d" : ring.color} />)}
  </svg>{node === "Performance" ? <p>Identity context: Skills. Value Log does not update this ring in this release; Performance credits route outward separately.</p> : <p>Completed Pilot W associated with these slices settles into Value Log&apos;s Identity State projection. This is not a canonical Wellbeing Identity write.</p>}</div>;
}

function activate(event: React.KeyboardEvent, action: () => void) {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
}
function diamond(x: number, y: number, radius: number) { return `M ${x - radius} ${y} L ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} Z`; }
function whole(value: number) { return Math.round(value).toLocaleString("en-IN"); }
function duration(minutes: number) { const rounded = Math.round(minutes); const hours = Math.floor(rounded / 60); const rest = rounded % 60; return hours ? `${hours} hr${rest ? ` ${rest} min` : ""}` : `${rest} min`; }
function stitchResult(stitch: InsightWeaveStitch) { return stitch.credits !== null ? `${whole(stitch.credits)} credits` : stitch.w_change !== null ? formatWMovement(stitch.w_change) : "No completed movement"; }
function stitchLabel(stitch: InsightWeaveStitch) { return `${stitch.node}. ${longDate(stitch.start_date)}, ${timeRange(stitch)}. ${stitch.activity}. ${stitchResult(stitch)}.`; }
function timeRange(stitch: InsightWeaveStitch) { const format = new Intl.DateTimeFormat("en-IN", { timeZone: stitch.timezone, hour: "numeric", minute: "2-digit", hour12: true }); return `${format.format(new Date(stitch.start_at))}–${format.format(new Date(stitch.end_at))}`; }
function shortDate(value: string) { return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`)); }
function longDate(value: string) { return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`)); }
function dateRange(startDate: string, count: number) { const start = new Date(`${startDate}T12:00:00Z`); return Array.from({ length: count }, (_, index) => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0, 10); }); }
function settlementValues(series: IntraDayWSeries | null): SettlementMovementDatum[] {
  if (!series) return [];
  return series.projection.events.map((event) => ({
    id: event.id,
    label: new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(event.settledAt)),
    settledAt: event.settledAt,
    preW: event.preW,
    change: event.change,
    postW: event.postW,
  }));
}

/** Scales the end-of-day score into the score row; null when the range has no score at all. */
function scoreRow(points: WeaveScorePoint[], dates: string[], xAt: (index: number) => number) {
  const byDate = new Map(points.map((point) => [point.date, point]));
  const values = dates.map((date) => byDate.get(date)?.w ?? null);
  const known = values.filter((value): value is number => value !== null);
  if (!known.length) return null;
  const low = Math.min(...known), high = Math.max(...known);
  const pad = Math.max(high - low, 0.002) * 0.12;
  const yAt = (value: number) => SCORE_BOTTOM - ((value - (low - pad)) / (high - low + 2 * pad)) * (SCORE_BOTTOM - SCORE_TOP);
  const paths: string[] = [];
  let path = "";
  values.forEach((value, index) => {
    if (value === null) { if (path) paths.push(path); path = ""; return; }
    path += `${path ? "L" : "M"}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`;
  });
  if (path) paths.push(path);
  const marks = dates.flatMap((date, index) => {
    const point = byDate.get(date);
    return point?.moved && point.w !== null ? [{ date, x: xAt(index), y: yAt(point.w) }] : [];
  });
  return { paths, marks, low, high, first: known[0], last: known[known.length - 1] };
}
