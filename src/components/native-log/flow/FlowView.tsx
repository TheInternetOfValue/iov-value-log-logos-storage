"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { NativeActivity, NativeDraft } from "@/lib/native-log/draft";
import { MAX_CAPTURE_SECONDS } from "@/lib/native-log/capture-health";
import { RECORDING_PROMPTS, checkSummary, clock, failureCopy, hasTime, longDate, missingTimes, plural, speechLength, spokenTimeText, timeText, type DoneSummary, type Failure } from "./flow-model";
import "./flow.css";

const Mic = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
const Stop = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" /></svg>;
const Retry = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>;
const Lock = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
const Close = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const Pencil = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>;
const Back = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;

type Action = { label: string; onClick?: () => void; disabled?: boolean; icon?: ReactNode; tone?: "ember" | "ink" | "outline" | "outline-ember" | "sand"; href?: string; describedBy?: boolean };
function DockButton({ action }: { action: Action }) {
  const className = `flow-button tone-${action.disabled ? "sand" : action.tone ?? "outline"}`;
  const content = <>{action.icon}{action.label}</>;
  if (action.href && !action.disabled) return <Link className={className} href={action.href}>{content}</Link>;
  return <button type="button" className={className} disabled={action.disabled} onClick={action.onClick} aria-describedby={action.describedBy ? "flow-reason" : undefined}>{content}</button>;
}
/** Pinned dock: the screen's main action on top, the reason always reserved in the middle, commit at the bottom. */
export function Dock({ top, reason, bottom, note }: { top?: Action; reason?: string; bottom?: Action; note?: ReactNode }) {
  return <div className="flow-dock" role="group" aria-label="Actions">
    {note}
    {top ? <DockButton action={top} /> : null}
    {reason ? <p id="flow-reason" className="flow-reason">{reason}</p> : null}
    {bottom ? <DockButton action={{ ...bottom, describedBy: Boolean(reason) }} /> : null}
  </div>;
}

export function Shell({ title, closeHref, closeLabel, onBack, progress, children, dock, live }: {
  title: ReactNode; closeHref: string; closeLabel: string; onBack?: () => void; progress?: ReactNode; children: ReactNode; dock: ReactNode; live?: string;
}) {
  return <div className="native-flow">
    <header className="flow-header">
      {onBack ? <button type="button" className="flow-icon" aria-label="Back" onClick={onBack}><Back /></button> : <span className="flow-icon-space" />}
      {progress ?? <p className="flow-title">{title}</p>}
      <Link className="flow-icon" href={closeHref} aria-label={closeLabel}><Close /></Link>
    </header>
    <main className="flow-main">{children}</main>
    {dock}
    <p className="flow-live" role="status" aria-live="polite">{live}</p>
  </div>;
}

export function StartScreen({ notice, resume, typingControls, extras }: {
  date: string; notice?: string; resume?: { label: string; onResume: () => void } | null;
  typingControls: ReactNode; extras?: ReactNode;
}) {
  return <>
    {resume ? <button type="button" className="flow-resume" onClick={resume.onResume}>{resume.label} <span>Continue where you left off →</span></button> : null}
    <h1 className="flow-heading flow-start-heading">Walk back through your day</h1>
    <p className="flow-lede">Tell us what you did and roughly when.</p>
    <p className="flow-meta">English, Hindi, Tamil or a mix · up to 10 minutes</p>
    {notice ? <p className="flow-notice" role="status">{notice}</p> : null}
    {typingControls}
    {extras}
  </>;
}

export function RecordingScreen({ elapsed, silent, level, deviceSaved, stopping }: {
  elapsed: number; silent: boolean; level: number | null; deviceSaved: boolean; stopping: boolean;
}) {
  const left = MAX_CAPTURE_SECONDS - elapsed;
  const prompt = RECORDING_PROMPTS[Math.floor(elapsed / 8) % RECORDING_PROMPTS.length];
  const dots = 24, lit = level === null ? 0 : Math.max(0, Math.min(dots, Math.round(((level + 60) / 60) * dots)));
  return <>
    <p className="flow-recording"><span className="flow-dot" aria-hidden="true" />{stopping ? "Finishing…" : "Recording"}</p>
    <p className="flow-timer"><span>{clock(elapsed)}</span> of {clock(MAX_CAPTURE_SECONDS)}</p>
    <div className="flow-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, (elapsed / MAX_CAPTURE_SECONDS) * 100)}%` }} /></div>
    {silent ? <div className="flow-alert" role="alert"><strong>We can’t hear you — check your microphone isn’t muted.</strong><span>We’re still recording. This goes away as soon as we hear you.</span></div> : null}
    {level !== null ? <><div className="flow-meter" aria-hidden="true">{Array.from({ length: dots }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)}</div>
      <meter className="flow-sr" min={-60} max={0} value={Math.max(-60, level)}>{silent ? "Very quiet" : "We can hear you"}</meter>
      <p className="flow-meta">{silent ? "Very quiet for a few seconds." : "We can hear you clearly."}</p></> : null}
    {left <= 60 ? <p className="flow-notice">1 minute left. We’ll stop at 10:00 and keep everything.</p> : null}
    <div className="flow-prompt" aria-live="off"><p>You might add</p><strong>{prompt}</strong></div>
    <p className="flow-meta">{deviceSaved ? "Your words are saved on this phone as you speak." : "Keep this screen open while you speak."}</p>
  </>;
}

export function ProcessingScreen({ speechSeconds, phase, part, total, deviceSaved, interrupted }: {
  speechSeconds: number; phase: "sending" | "table"; part: number; total: number; deviceSaved: boolean; interrupted?: string;
}) {
  // Seconds in the current phase, so a slow step visibly keeps going rather than looking frozen.
  const [tick, setTick] = useState({ phase, seconds: 0 });
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setTick({ phase, seconds: Math.floor((Date.now() - started) / 1000) }), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  const elapsed = tick.phase === phase ? tick.seconds : 0;
  const steps = [
    { label: phase === "sending" && total ? `Sending part ${Math.min(part + 1, total)} of ${total}` : "Sending your recording", done: phase === "table", current: phase === "sending" },
    { label: "Writing down your words", done: phase === "table", current: false },
    { label: "Building your table", done: false, current: phase === "table" },
  ];
  return <>
    <h1 className="flow-heading">Working on your log</h1>
    <p className="flow-lede">{speechSeconds ? `${speechLength(speechSeconds)} of speech. ` : ""}{elapsed >= 60 ? "Taking longer than usual. Keep this screen open." : "This usually takes under a minute."}</p>
    {interrupted ? <p className="flow-notice">{interrupted}</p> : null}
    <ol className="flow-steps">{steps.map((step) => <li key={step.label} className={step.done ? "done" : step.current ? "current" : ""} aria-current={step.current ? "step" : undefined}>
      <span className="flow-step-mark" aria-hidden="true" /><span>{step.label}{step.current && phase === "sending" && total > 1 ? <span className="flow-parts" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i < part ? "on" : i === part ? "now" : ""} />)}</span> : null}
        {step.current && phase === "sending" && part > 0 ? <small>{plural(part, "part sent", "parts sent")}</small> : null}
        {step.current && elapsed >= 3 ? <small aria-hidden="true">{clock(elapsed)}</small> : null}</span></li>)}</ol>
    <p className="flow-privacy"><Lock /><span>{deviceSaved ? "Your recording is saved on this phone. You can close this screen — we’ll pick up where we left off." : "Keep this screen open until your table appears."}</span></p>
  </>;
}

export function FailedScreen({ failure, saved, extra }: { failure: Failure; saved: string; extra?: ReactNode }) {
  const copy = failureCopy(failure);
  return <>
    <h1 className="flow-heading">{copy.heading}</h1>
    <div className="flow-card" role="alert"><p className="flow-card-label">What happened</p><p>{copy.reason}</p></div>
    <div className="flow-card flow-saved"><Lock /><div><strong>{saved}</strong></div></div>
    <p className="flow-meta">{copy.retry}</p>
    {extra}
  </>;
}

const nodeTone = (node: string) => node ? `tone-${node.toLowerCase()}` : "";
function Reading({ node }: { node: NativeActivity["node"] }) {
  return node ? <span className="flow-reading"><i className={nodeTone(node)} aria-hidden="true" />{node}</span> : <span className="flow-chip">No reading yet</span>;
}
function TimeCell({ activity }: { activity: NativeActivity }) {
  const text = timeText(activity);
  if (text) return <span title={activity.timeNote}>{text}</span>;
  return <><span className="flow-chip">No time yet</span>{activity.timeLabel ? <small className="flow-time-label">{activity.timeLabel}</small> : null}</>;
}

/** The one open typed change: a row ("Fix"/"Add time") or "new" for anything else. */
export type Correction = {
  target: string | null; text: string; error?: string; sending: boolean; disabled: boolean;
  onOpen: (target: string) => void; onChange: (text: string) => void; onSend: () => void; onCancel: () => void;
};
const STARTERS: Array<[label: string, text: string]> = [["Wrong time", "It was from "], ["Wrong name", "It was actually "], ["Didn’t happen", "This didn’t happen."]];
function CorrectionBox({ activity, needsTime, correction }: { activity?: NativeActivity; needsTime?: boolean; correction: Correction }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const name = activity?.activity || "this activity";
  const label = !activity ? "What else happened, and roughly when?" : needsTime ? `When did ${name} happen?` : `What should change about ${name}?`;
  const placeholder = !activity ? "Had lunch with Priya around 1 pm" : needsTime ? "Around 8:30, or 2 to 3 pm" : "It was 7 to 8 am";
  const start = (text: string) => {
    correction.onChange(text);
    requestAnimationFrame(() => { const el = field.current; if (el) { el.focus(); el.setSelectionRange(text.length, text.length); } });
  };
  const send = !correction.sending && !correction.disabled && Boolean(correction.text.trim());
  return <form className="flow-fix-box" data-inline-feedback="true" onSubmit={(e) => { e.preventDefault(); if (send) correction.onSend(); }}>
    <label htmlFor="flow-fix-text">{label}</label>
    {activity && !needsTime ? <div className="flow-starters" role="group" aria-label="Start with">
      {STARTERS.map(([title, text]) => <button key={title} type="button" disabled={correction.sending} onClick={() => start(text)}>{title}</button>)}
    </div> : null}
    <textarea id="flow-fix-text" ref={field} rows={2} maxLength={3000} autoFocus value={correction.text} placeholder={placeholder} disabled={correction.sending}
      aria-describedby={correction.error ? "flow-fix-error" : undefined}
      onChange={(e) => correction.onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (send) correction.onSend(); } }} />
    {!activity ? <small>You can also describe changes to several rows here.</small> : null}
    {correction.error ? <p id="flow-fix-error" className="flow-fix-error" role="alert">{correction.error}</p> : null}
    <div className="flow-fix-actions">
      <button type="submit" className="flow-fix-send" disabled={!send}>{correction.sending ? "Updating…" : "Update table"}</button>
      <button type="button" className="flow-link plain" disabled={correction.sending} onClick={correction.onCancel}>Cancel</button>
    </div>
  </form>;
}

export function CheckScreen({ draft, changedId, sharedDay, correction, notice, preparation, unmatched }: {
  draft: NativeDraft; changedId?: string | null; sharedDay: boolean; correction: Correction; notice?: string;
  /** Rows the server could not match to the person's words were left out; say so rather than lose them silently. */
  unmatched?: { count: number; onAdd: () => void; onDismiss: () => void } | null;
  /** A completeness or preparation issue, with its one recovery action. */
  preparation?: { message: string; onRetry: () => void; disabled: boolean } | null;
}) {
  const missing = missingTimes(draft).length;
  const locked = correction.sending || correction.disabled;
  return <>
    <p className="flow-kicker">{longDate(draft.date)}</p>
    <h1 className="flow-heading">{draft.correctsRecordId ? "Check your correction" : "Check your day"}</h1>
    <p className="flow-summary" aria-live="polite">{checkSummary(draft)}</p>
    {draft.reviewQuestion ? <p className="flow-notice">From Insights: {draft.reviewQuestion}</p> : null}
    {preparation ? <div className="flow-notice" role="alert"><p>{preparation.message}</p>
      <button type="button" className="flow-link" disabled={preparation.disabled} onClick={preparation.onRetry}>Try preparing again →</button></div> : null}
    {notice ? <p className="flow-notice" role="status">{notice}</p> : null}
    {unmatched ? <div className="flow-notice flow-unmatched" role="status">
      <p>{unmatched.count === 1 ? "We couldn’t place one thing you said, so it isn’t in the table." : `We couldn’t place ${unmatched.count} things you said, so they aren’t in the table.`} If something’s missing, add it below.</p>
      <div className="flow-fix-actions">
        <button type="button" className="flow-link" disabled={locked || correction.target === "new"} onClick={unmatched.onAdd}>Add what’s missing →</button>
        <button type="button" className="flow-link plain" onClick={unmatched.onDismiss}>Dismiss</button>
      </div>
    </div> : null}
    <table className="flow-table">
      <caption className="flow-sr">Your proposed log. Use Fix on a row to change it.</caption>
      <thead><tr><th scope="col">Time</th><th scope="col">What happened</th><th scope="col">Reading</th><th scope="col"><span className="flow-sr">Change</span></th></tr></thead>
      <tbody>{draft.activities.map((activity) => {
        const timed = hasTime(activity, draft.timezone), open = correction.target === activity.id, name = activity.activity || "Activity";
        return <Fragment key={activity.id}>
          <tr className={[activity.id === changedId ? "changed" : "", open ? "open" : ""].filter(Boolean).join(" ") || undefined}>
            <td>{timed ? <TimeCell activity={activity} /> : <>
              <button type="button" className="flow-add-time" disabled={locked} aria-expanded={open} onClick={() => correction.onOpen(activity.id)} aria-label={`Add a time for ${name}`}>+ Add time</button>
              {timeText(activity) ? <small className="flow-time-label">{timeText(activity)}</small> : activity.timeLabel ? <small className="flow-time-label">{activity.timeLabel}</small> : null}</>}</td>
            <td>{name}</td><td><Reading node={activity.node} /></td>
            <td className="flow-fix-cell"><button type="button" className="flow-fix" disabled={locked} aria-expanded={open} aria-label={`Fix ${name}`} onClick={() => correction.onOpen(activity.id)}><Pencil /><span aria-hidden="true">Fix</span></button></td>
          </tr>
          {open ? <tr className="flow-fix-row"><td colSpan={4}><CorrectionBox activity={activity} needsTime={!timed} correction={correction} /></td></tr> : null}
        </Fragment>;
      })}</tbody>
    </table>
    {correction.target === "new" ? <CorrectionBox correction={correction} />
      : <button type="button" className="flow-add" disabled={locked} onClick={() => correction.onOpen("new")}>+ Add something that’s missing</button>}
    {missing ? <p className="flow-meta">{sharedDay ? "Anything without a time is saved as a note on your day." : "Anything without a time waits in Insights until you add one."}</p> : null}
  </>;
}

export function DoneScreen({ summary, draft, audioNote }: { summary: DoneSummary; draft: NativeDraft; audioNote?: string }) {
  return <>
    <span className="flow-check" aria-hidden="true">✓</span>
    <h1 className="flow-heading">{summary.heading}</h1>
    <p className="flow-summary" role="status">{summary.line}</p>
    <ul className="flow-receipt">{draft.activities.map((activity) => <li key={activity.id}><span>{spokenTimeText(activity) ?? "Note"}</span><span>{activity.activity}</span></li>)}</ul>
    {audioNote ? <p className="flow-meta">{audioNote}</p> : null}
  </>;
}

export { Mic, Stop, Retry };
