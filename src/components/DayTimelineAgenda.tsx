"use client";

import Link from "next/link";
import { useState } from "react";

export type DayAgendaItem = {
  id: string;
  activity: string;
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
  startPercent: number;
  widthPercent: number;
  lane: number;
};

export function DayTimelineAgenda({
  calculationActive,
  date,
  filter,
  items,
  performanceTerm = "credits",
}: {
  calculationActive: boolean;
  date: string;
  filter: "all" | "wellbeing" | "performance";
  items: DayAgendaItem[];
  performanceTerm?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const shownItems = items.filter((item) => filter === "all" || item.type === filter);

  return <details className="activity-agenda" open={filter !== "all" ? true : undefined}>
      <summary><span id="agenda-heading">Read as timeline</span><span className="meta">{shownItems.length} {shownItems.length === 1 ? "activity" : "activities"}</span></summary>
      <nav className="agenda-filters" aria-label="Activity filters">{(["all", "wellbeing", "performance"] as const).map((candidate) => <Link className={filter === candidate ? "active" : ""} href={`/day?date=${date}${candidate === "all" ? "" : `&filter=${candidate}`}`} key={candidate}>{candidate[0].toUpperCase() + candidate.slice(1)}</Link>)}</nav>
      <div className="agenda-list">{shownItems.length ? shownItems.map((item) => <Link className={`agenda-row ${item.type}${activeId === item.id ? " timeline-active" : ""}${item.conflict ? " conflict" : ""}`} href={`/slices/canonical/${item.id}`} id={`activity-${item.id}`} key={item.id} onBlur={() => setActiveId((current) => current === item.id ? null : current)} onFocus={() => setActiveId(item.id)} onMouseEnter={() => setActiveId(item.id)} onMouseLeave={() => setActiveId((current) => current === item.id ? null : current)}>
        <time>{item.start}<span>{item.end}</span></time>
        <div><h3>{item.activity}</h3><p>{item.detail}</p></div>
        {item.result ? <strong className={item.needsReview ? "needs-review" : ""}>{item.result}</strong> : item.calculating ? <strong className="calculating-result">{calculationActive ? "Calculating" : "Awaiting"} {item.type === "performance" ? performanceTerm : "W"}…</strong> : null}<span aria-hidden="true">›</span>
      </Link>) : <div className="empty">No activities match this filter.</div>}</div>
    </details>;
}
