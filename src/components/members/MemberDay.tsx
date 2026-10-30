"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MemberEntry, SavedMemberEntry } from "@/lib/members/entries";
import { wellbeingNodes } from "@/lib/members/nodes";
type SavedEntry = SavedMemberEntry;
export function MemberDay({ today, initialDate, initialEntries, initialTotal, initialError, binding, writing, timezone, nativeLogHref, voiceDefault=false, embedded=false }: { today: string; initialDate: string; initialEntries: SavedEntry[]; initialTotal: number; initialError: boolean; binding: string; writing: boolean; timezone: string; nativeLogHref?: string; voiceDefault?: boolean; embedded?: boolean }) {
  const [date, setDate] = useState(initialDate), [entries, setEntries] = useState<SavedEntry[]>(initialEntries), [total, setTotal] = useState(initialTotal);
  const [loaded, setLoaded] = useState(!initialError), [loadError, setLoadError] = useState(initialError ? "Could not load your activities. Please try again." : ""), [message, setMessage] = useState("");
  const [editing, setEditing] = useState<MemberEntry | null>(null), [text, setText] = useState(""), [node, setNode] = useState<MemberEntry["node"]>("Physiology"), [minutes, setMinutes] = useState("");
  const [needsSignin, setNeedsSignin] = useState(false);
  const [busy, setBusy] = useState(false), [removing, setRemoving] = useState<string | null>(null);
  const operation = useRef<{ id: string; revision: number } | null>(null), writingRef = useRef<HTMLTextAreaElement>(null), generation = useRef(0);
  const dirty = text.length > 0 || editing !== null;
  const headers = { "Content-Type": "application/json", "x-value-log-session": binding };
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.stopPropagation(); };
    const protectNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      setMessage("Save your activity or discard the writing before leaving this page.");
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", protectNavigation, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", protectNavigation, true); };
  }, [dirty]);
  async function load(offset = 0, targetDate = date) {
    const version = ++generation.current;
    try {
      const response = await fetch(`/api/member/entries?date=${targetDate}&offset=${offset}`, { cache: "no-store", headers: { "x-value-log-session": binding } });
      const body = await response.json(); if (!response.ok) { setNeedsSignin(response.status === 401 || response.status === 403); throw new Error(body.error); }
      if (generation.current !== version) return;
      setLoadError(""); setEntries(previous => offset ? [...previous, ...body.entries] : body.entries); setTotal(body.total); setLoaded(true);
    } catch (error) { if (generation.current === version) setLoadError(error instanceof Error ? error.message : "Could not load your activities. Try again."); }
  }
  function reset() { setNeedsSignin(false); setEditing(null); setText(""); setMinutes(""); setRemoving(null); operation.current = null; }
  function chooseDate(value: string) {
    if (busy || !value || value > today) return;
    if (dirty) { setMessage("Save your activity or discard the writing before changing the date."); return; }
    generation.current++; setEntries([]); setTotal(0); setLoaded(false); setLoadError(""); setDate(value); setMessage(""); void load(0, value);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation(); if (busy) return; setBusy(true); setMessage("");
    const op = operation.current ?? { id: editing?.id ?? crypto.randomUUID(), revision: editing?.revision ?? 0 };
    operation.current = op;
    try {
      const response = await fetch("/api/member/entries", { method: "PUT", headers, body: JSON.stringify({ ...op, date, node, text, minutes: minutes ? Number(minutes) : null }) });
      const body = await response.json(); if (!response.ok) { setNeedsSignin(response.status === 401 || response.status === 403); throw new Error(body.error); }
      reset(); setMessage("Saved privately. This activity is unassessed."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save. Your writing is still here; try again."); } finally { setBusy(false); }
  }
  function edit(entry: SavedEntry) {
    if (dirty || busy) { setMessage("Save or discard the current writing before editing another activity."); return; }
    setEditing(entry); setText(entry.text); setNode(entry.node); setMinutes(entry.minutes === null ? "" : String(entry.minutes)); operation.current = null;
    setMessage(""); requestAnimationFrame(() => writingRef.current?.focus());
  }
  async function remove(entry: SavedEntry) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/member/entries", { method: "DELETE", headers, body: JSON.stringify({ id: entry.id, revision: entry.revision }) });
      const body = await response.json(); if (!response.ok) { setNeedsSignin(response.status === 401 || response.status === 403); throw new Error(body.error); }
      setRemoving(null); setMessage("Activity removed from your private log."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove it. Please try again."); } finally { setBusy(false); }
  }
  const editor = (<section aria-labelledby="member-writing-title"><h2 id="member-writing-title">{editing ? "Edit activity" : "Add an activity"}</h2>
        <form data-inline-feedback="true" onSubmit={save} className="stack card member-form">
          <label>What did you do?<textarea ref={writingRef} value={text} onChange={event => setText(event.target.value)} maxLength={6000} rows={5} required disabled={!writing || busy} /></label>
          <label>Primary Wellbecoming node<select value={node} onChange={event => setNode(event.target.value as MemberEntry["node"])} disabled={!writing || busy}>{wellbeingNodes.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Duration in minutes <span className="meta">(optional)</span><input type="number" min={1} max={1440} step={1} value={minutes} onChange={event => setMinutes(event.target.value)} disabled={!writing || busy} /></label>
          <p className="meta">Choose the one node that best describes this activity. Recording it creates no score, credits or community membership.</p>
          <div className="member-actions"><button disabled={!writing || busy}>{busy ? "Saving…" : "Save privately"}</button>{dirty ? <button type="button" className="secondary" disabled={busy} onClick={() => { reset(); setMessage("Writing discarded. Saved activities are unchanged."); }}>Discard writing</button> : null}</div>
          {!writing ? <p>Saving is temporarily paused. You can still read and export saved activities.</p> : null}
        </form>
      </section>);
  return <div className="member-log">
    {/* Embedded on Today, the surrounding section names it and the day stepper picks the date. */}
    {embedded ? <p className="meta">Written notes stay private and unassessed. They are separate from your day circle.</p> : <>
    <header><p className="meta">Private Value Log</p><h1>What happened today?</h1><p className="lede">Record a moment from your day. Your activities stay private and unassessed.</p>{nativeLogHref ? <p><Link className="button" href={`/log?date=${date}`}>Log by voice</Link></p> : null}</header>
    <div className="member-date"><label>Activity date<input type="date" value={date} max={today} onChange={event => chooseDate(event.target.value)} disabled={busy} /></label><span className="meta">{timezone}</span></div>
    </>}
    <div className={`member-grid ${voiceDefault?"member-voice-default":""}`}>
      {voiceDefault ? <details className="member-optional-writing" open={editing ? true : undefined}><summary>Write an activity instead</summary>{editor}</details> : editor}
      <section aria-labelledby="member-activities-title"><h2 id="member-activities-title">Your activities</h2>
        {loadError ? <div role="alert"><p>{loadError}</p><button className="secondary" disabled={busy} onClick={() => void load()}>Try loading again</button></div> : !loaded ? <p role="status">Loading your private activities…</p> : !total ? <p className="member-empty">Nothing recorded for this date yet. Start with one moment you want to remember.</p> : <>
          <p className="meta">{total} {total === 1 ? "activity" : "activities"} · unassessed</p>
          <ol className="member-entries">{entries.map(entry => <li key={entry.id} className="card"><p className="meta">{entry.node}{entry.minutes ? ` · ${entry.minutes} min` : ""}</p><p className="member-activity-text">{entry.text}</p>
            {removing === entry.id ? <div><p>Remove this activity&apos;s writing? A content-free removal record is retained.</p><div className="member-actions"><button disabled={busy} className="danger" onClick={() => void remove(entry)}>Remove activity</button><button disabled={busy} className="secondary" onClick={() => setRemoving(null)}>Keep activity</button></div></div> : <div className="member-actions"><button className="secondary" disabled={!writing || busy} onClick={() => edit(entry)}>Edit</button><button className="quiet" disabled={!writing || busy || dirty} onClick={() => setRemoving(entry.id)}>Remove</button></div>}
          </li>)}</ol>
          {entries.length < total ? <button className="secondary" disabled={busy} onClick={() => void load(entries.length)}>Load more activities</button> : null}
        </>}
      </section>
    </div>
    <div className="member-status" role="status" aria-live="polite">{message}{needsSignin ? <p><a href="/login" target="_blank" rel="noopener">Open sign-in in another tab</a>. Return here after signing into the original account; your writing stays on this page.</p> : null}</div>
    {embedded ? null : <footer className="member-footer"><Link href="/profile">My Wellbeing Identity</Link><Link href="/privacy">Privacy, export and removal</Link><p className="meta">Validated wellbeing readings and Performance credits need an appropriate baseline and validation policy. They are not available for new members yet.</p></footer>}
  </div>;
}
