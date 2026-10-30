"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import "./cohort.css";

type Agent = { active: boolean; accepted_at: string | null; operator_label: string; operator_did: string };
export function CohortAgent({ binding }: { binding: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/cohort/agent", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setAgent(body.agent);
    }).catch(() => { if (!controller.signal.aborted) setMessage("Reviewer settings could not be loaded. Check you are signed in with the designated account, then try again."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function command(input: unknown) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/cohort/agent", { method: "POST", headers: { "content-type": "application/json", "x-value-log-session": binding }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      location.reload();
    } catch {
      setMessage("The change could not be saved. Your previous settings are unchanged. Please try again."); setBusy(false);
    }
  }
  const status = !agent?.accepted_at ? "Awaiting acceptance" : agent.active ? "Review is on" : "Review is paused";
  return <section className="reviewer-page">
    <header className="reviewer-heading"><p className="member-kicker">FIELD STATION</p><h1>Reviewer<span className="heading-dot">.</span></h1><p>Manage automated review for the community.</p></header>
    {loading ? <div className="reviewer-loading" role="status">Loading reviewer settings…</div> : null}
    {message ? <p className="warning" role="alert">{message}</p> : null}
    {agent ? <>
      <section className={`reviewer-status ${agent.active && agent.accepted_at ? "is-active" : ""}`} aria-labelledby="reviewer-status-title">
        <div className="reviewer-status-top"><span>REVIEW STATUS</span><i aria-hidden="true" /></div>
        <h2 id="reviewer-status-title">{status}</h2>
        <p>{!agent.accepted_at ? "Accept this role to operate the automated reviewer." : agent.active ? "The reviewer can process eligible, approved records when review is enabled." : "No new automated reviews will run while the reviewer is paused."}</p>
        {!agent.accepted_at ? <button disabled={busy} onClick={() => void command({ action: "accept_operator", consent: true })}>{busy ? "Saving…" : "Accept reviewer responsibility"} <span aria-hidden="true">→</span></button> : <button disabled={busy} onClick={() => void command({ action: "agent_pause", active: !agent.active })}>{busy ? "Saving…" : agent.active ? "Pause automated review" : "Resume automated review"} <span aria-hidden="true">→</span></button>}
      </section>
      <section className="reviewer-about"><p className="member-kicker">HOW IT WORKS</p><h2>Clear boundaries</h2><div><span>01</span><p>Only participant-approved records with active consent are eligible for review.</p></div><div><span>02</span><p>Decisions are labelled automated. They do not claim a human witnessed the activity.</p></div></section>
      <details className="reviewer-account"><summary><span><strong>Operator account</strong><small>{agent.operator_label}</small></span><b aria-hidden="true">+</b></summary><p>Verified Identity</p><code>{agent.operator_did}</code></details>
      <Link className="reviewer-back" href="/day">← Back to Today</Link>
    </> : null}
  </section>;
}
