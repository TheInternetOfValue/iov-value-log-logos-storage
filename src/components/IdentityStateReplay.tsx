"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatLocalTime, localDateFor } from "@/lib/format";
import type { IdentityReplay, IdentityReplayEvent } from "@/lib/identity-replay";
import { moveReplayIndex, swipeReplayIndex } from "@/lib/identity-replay-controls";
import { WellbeingIdentityRenderer } from "@theinternetofvalue/wellbeing-identity-renderer";
import { ownerReplayProjection, replayInput } from "@/lib/identity-replay-projection";
import type { OwnerWellbeingIdentityProjection, ReplayIdentityProjection, WellbeingIdentityNode } from "@theinternetofvalue/wellbeing-identity-contracts";
import { FacetPresenter } from "@/components/FacetPresenter";

export function IdentityStateReplay({ replay, projection, regime = "historical_pilot" }: { replay: IdentityReplay; projection?: OwnerWellbeingIdentityProjection | ReplayIdentityProjection | null; regime?: "historical_pilot" | "canonical_founder" }) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [inspectedNode, setInspectedNode] = useState<WellbeingIdentityNode | null>(null);
  const [previewNode, setPreviewNode] = useState<WellbeingIdentityNode | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const event = activeIndex >= 0 ? replay.transitions[activeIndex] : null;
  const currentW = event?.resulting_w ?? replay.opening_w;
  const finished = activeIndex === replay.transitions.length - 1;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setActiveIndex((current) => {
      if (current >= replay.transitions.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 1600);
    return () => window.clearInterval(timer);
  }, [playing, replay.transitions.length]);

  const resumeTimeline = () => { setInspectedNode(null); setPreviewNode(null); };
  const move = (direction: -1 | 1) => { setPlaying(false); resumeTimeline(); setActiveIndex((value) => moveReplayIndex(value, direction, replay.transitions.length)); };
  const handleTouchEnd = (input: React.TouchEvent<HTMLElement>) => {
    const start = touchStart.current; touchStart.current = null;
    if (!start) return;
    const touch = input.changedTouches[0]; setPlaying(false); resumeTimeline();
    setActiveIndex((value) => swipeReplayIndex(value, touch.clientX - start.x, touch.clientY - start.y, replay.transitions.length));
  };
  const totalCredits = replay.contribution_totals.iov + replay.contribution_totals.gfe;
  const canonical = regime === "canonical_founder";
  const performanceLabel = canonical ? "VCperformance" : "historical credits";
  const stateLabel = event ? `Settled at ${formatLocalTime(event.settles_at, event.timezone)}` : "Opening state · 00:00 IST";

  return <section className="identity-replay-shell">
    <header className="identity-replay-header">
      <Link href={`/day?date=${replay.date}`} className="identity-back">← Canonical day</Link>
      <details className="identity-how"><summary>How this works</summary><p>Derived visual replay. Canonical activity and numeric values remain inspectable.</p></details>
    </header>
    <section className="identity-replay-stage" aria-labelledby="identity-replay-title">
      <div className="identity-replay-intro"><p className="identity-kicker">{canonical ? "HouseOfBros WellbeingScore Replay" : "Historical Pilot W Replay"}</p><h1 id="identity-replay-title">Explore {readableDate(replay.date)}</h1><p>{canonical ? "Canonical post-Genesis wellbeing and Performance events in exact order." : "Preserved pre-Genesis experimental events in settlement order."}</p></div>
      <div className="identity-stage-grid">
        <aside className="identity-state-card" aria-live="polite">
          <p className="identity-kicker">{stateLabel}</p>
          {currentW === null ? <><strong className="identity-no-state">No derived W</strong><p>This event has no completed wellbeing movement.</p></> : <><strong>{currentW.toFixed(3)} <small>W</small></strong>{event?.kind === "wellbeing" ? <><span>Applied movement</span><b>{signed(event.applied_w ?? 0)} W</b></> : <p>{event ? "W remains unchanged for this contribution event." : "The opening state remains visible until the first completed event settles."}</p>}</>}
        </aside>
        <IdentityField currentW={currentW} event={event} projection={projection ?? ownerReplayProjection()} inspectedNode={inspectedNode} previewNode={previewNode} onNodePreview={setPreviewNode} onNodeSelect={(node) => { setPlaying(false); setPreviewNode(null); setInspectedNode(node); }} onTouchStart={(input) => { const touch = input.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={handleTouchEnd} />
        <aside className="identity-transition-card" aria-live="polite">{inspectedNode ? <IdentityFacetPanel projection={projection ?? ownerReplayProjection()} nodePath={inspectedNode} onReturn={resumeTimeline} /> : previewNode ? <IdentityFacetPanel projection={projection ?? ownerReplayProjection()} nodePath={previewNode} preview /> : event ? <EventDetail event={event} date={replay.date} /> : <><p className="identity-kicker">Ready at midnight</p><h2>{replay.opening_w === null ? "Contribution replay" : "Opening state"}</h2><p>Select Next or a settlement marker to inspect the day&apos;s first completed event.</p></>}</aside>
      </div>
      <section className="identity-playback" aria-label="IdentityState replay controls">
        <div className="identity-controls">
          <button type="button" className="identity-icon-button" onClick={() => move(-1)} disabled={activeIndex < 0}>Previous</button>
          <button type="button" className="identity-play-button" onClick={() => { resumeTimeline(); if (finished && !playing) { setActiveIndex(-1); setPlaying(true); return; } setPlaying((value) => !value); }}>{playing ? "Pause" : finished ? "Replay" : "Play"}</button>
          <button type="button" className="identity-icon-button" onClick={() => move(1)} disabled={finished}>{activeIndex < 0 ? "Next" : "Next"}</button>
          <label className="sr-only" htmlFor="identity-scrubber">Replay position</label>
          <input id="identity-scrubber" type="range" min="0" max={replay.transitions.length} value={activeIndex + 1} onChange={(input) => { setPlaying(false); resumeTimeline(); setActiveIndex(Number(input.target.value) - 1); }} />
          <span>{event ? formatLocalTime(event.settles_at, event.timezone) : "00:00"}</span>
        </div><div className="identity-scrubber-labels"><span>00:00</span><span>24:00</span></div>
      </section>
      <p className="identity-motion-note">Transition motion is magnified for legibility. Numeric values remain exact.</p>
      <section className="identity-transition-list" aria-labelledby="identity-transition-list-title"><div><p className="identity-kicker">Textual event record</p><h2 id="identity-transition-list-title">Completed events</h2></div><ol>{replay.transitions.map((item, index) => <li key={`${item.kind}-${item.id}`}><button type="button" className={index === activeIndex && !inspectedNode ? "active" : ""} onClick={() => { setPlaying(false); resumeTimeline(); setActiveIndex(index); }} onFocus={() => { resumeTimeline(); setActiveIndex(index); }}><time>{formatLocalTime(item.settles_at, item.timezone)}</time><span><small>{item.kind === "performance" ? "Performance contribution" : "Wellbeing transition"}</small>{item.activity}</span>{item.kind === "wellbeing" ? <b>{signed(item.applied_w ?? 0)} W</b> : <b>{Math.round(item.performance?.credits ?? 0).toLocaleString("en-IN")} {performanceLabel}</b>}<strong>{item.kind === "wellbeing" && item.post_w !== null ? `${item.post_w.toFixed(3)} W` : communityName(item.performance?.community ?? "iov")}</strong></button></li>)}</ol></section>
      <section className="identity-closing" aria-label="Day closing state"><div><p className="identity-kicker">Day settled</p><h2>{replay.closing_w === null ? "Contribution complete" : "Closing state"}</h2></div><dl><div><dt>Opening</dt><dd>{state(replay.opening_w)}</dd></div><div><dt>Closing</dt><dd>{state(replay.closing_w)}</dd></div><div><dt>Net applied movement</dt><dd>{replay.closing_w === null ? "No completed W" : `${signed(replay.net_w)} W`}</dd></div><div><dt>Performance contribution</dt><dd>{Math.round(totalCredits).toLocaleString("en-IN")} {performanceLabel}</dd></div></dl><Link className="identity-outline-link" href={`/day?date=${replay.date}`}>Open canonical day</Link></section>
    </section>
    <footer className="identity-replay-disclosure">{canonical ? "This private visualisation replays the canonical HouseOfBros founder ledger from the constituted Genesis baseline. Historical Pilot W is not included." : "This private visualisation preserves pre-Genesis Pilot W as historical evidence. It does not enter or alter the canonical HouseOfBros WellbeingScore."}</footer>
  </section>;
}

function IdentityField({ currentW, event, projection, inspectedNode, previewNode, onNodePreview, onNodeSelect, onTouchStart, onTouchEnd }: { currentW: number | null; event: IdentityReplayEvent | null; projection: OwnerWellbeingIdentityProjection | ReplayIdentityProjection; inspectedNode: WellbeingIdentityNode | null; previewNode: WellbeingIdentityNode | null; onNodePreview: (node: WellbeingIdentityNode | null) => void; onNodeSelect: (node: WellbeingIdentityNode) => void; onTouchStart: React.TouchEventHandler<HTMLDivElement>; onTouchEnd: React.TouchEventHandler<HTMLDivElement> }) {
  const intensity = useMemo(() => currentW === null ? .42 : Math.min(.92, Math.max(.42, (currentW - 700) / 300)), [currentW]);
  const wellbeingEvent = event?.kind === "wellbeing" ? event : null;
  return <div className="identity-field" style={{ "--state-intensity": intensity } as React.CSSProperties} aria-label={event ? `Replay event: ${event.activity}` : "Opening state field"} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
    <WellbeingIdentityRenderer projection={projection} profile="replay" activeNode={inspectedNode ?? "~~IdentityState"} previewNode={previewNode} onNodePreview={onNodePreview} onNodePreviewEnd={() => onNodePreview(null)} onNodeSelect={onNodeSelect} transition={!inspectedNode && wellbeingEvent ? replayInput(wellbeingEvent) : undefined} reducedMotion={false} />
    {wellbeingEvent ? <div className="identity-ember-trace" aria-hidden="true" /> : null}
    {event?.performance ? <div className="identity-performance-route" aria-label={`${Math.round(event.performance.credits)} credits routed to ${communityName(event.performance.community)}`}><span>{Math.round(event.performance.credits)} credits → {communityName(event.performance.community)}</span><i /></div> : null}
  </div>;
}

function IdentityFacetPanel({ projection, nodePath, onReturn, preview = false }: { projection: OwnerWellbeingIdentityProjection | ReplayIdentityProjection; nodePath: WellbeingIdentityNode; onReturn?: () => void; preview?: boolean }) {
  const node = projection.nodes.find((candidate) => candidate.path === nodePath);
  const facets = projection.purpose === "owner-private-profile" ? projection.nodes.find((candidate) => candidate.path === nodePath)?.facets ?? [] : [];
  return <><p className="identity-kicker">{preview ? "Previewing identity ring" : "Identity ring selected"}</p><h2>{node?.label ?? "Identity node"}</h2><p>{preview ? "Move away to return to the replay. Click or press Enter to inspect this part of the identity." : "Replay is paused while you inspect this part of the identity portrait."}</p>{facets.length ? <dl>{facets.slice(0, 4).map((facet) => <div key={facet.path}><dt>{facet.label}</dt><dd><FacetPresenter value={facet.value} /></dd></div>)}</dl> : <p className="identity-neutral-fact">No owner-authorised private facets are available in this replay projection.</p>}{onReturn ? <button type="button" className="identity-return-button" onClick={onReturn}>Return to replay</button> : null}</>;
}

function EventDetail({ event, date }: { event: IdentityReplayEvent; date: string }) {
  const beganEarlier = localDateFor(event.begins_at, event.timezone) !== date;
  const interval = beganEarlier ? `Began ${formatLocalTime(event.begins_at, event.timezone)} yesterday · settled today` : `${formatLocalTime(event.begins_at, event.timezone)}–${formatLocalTime(event.settles_at, event.timezone)}`;
  return <><p className="identity-kicker">{event.kind === "performance" ? "Contribution settled" : "Transition at"} {formatLocalTime(event.settles_at, event.timezone)}</p><h2>{event.activity}</h2><p>{event.wellbeing_node ?? (event.kind === "performance" ? "Performance" : "Wellbeing")} · {interval}</p>{event.kind === "wellbeing" ? <dl><div><dt>Pre-state</dt><dd>{state(event.pre_w)}</dd></div><div><dt>Applied movement</dt><dd>{signed(event.applied_w ?? 0)} W</dd></div><div><dt>Post-state</dt><dd>{state(event.post_w)}</dd></div></dl> : <p className="identity-neutral-fact">This contribution leaves the current identity state unchanged.</p>}{event.performance ? <div className="identity-performance-fact"><span>Performance routed outward</span><strong>{Math.round(event.performance.credits).toLocaleString("en-IN")} credits · {communityName(event.performance.community)}</strong></div> : null}<Link href={`/slices/canonical/${event.canonical_slice_id}`}>Open canonical activity →</Link></>;
}

function readableDate(value: string) { return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`)); }
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`; }
function state(value: number | null) { return value === null ? "No completed W" : `${value.toFixed(3)} W`; }
function communityName(value: "iov" | "gfe" | "house_of_bros") { return value === "iov" ? "IoV Research Foundation" : value === "gfe" ? "Growth Flow Engineering" : "HouseOfBros"; }
