"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function DatedSetup({ policy, house, binding, qa }: { policy: string; house: string | null; binding: string; qa: boolean }) {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [later, setLater] = useState(false);
  const router = useRouter();
  if (later) return <p>You’re using private logging. You can choose the Field Station setup when you return.</p>;
  const selected = house ?? "house_of_bros", label = selected === "house_of_sis" ? "HouseOfSis" : "HouseOfBros";
  async function accept() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/cohort", { method: "POST", headers: { "content-type": "application/json", "x-value-log-session": binding }, body: JSON.stringify({ action: "enroll_dated", policy, house: selected, consent: true, startingValuesConfirmed: true, termsVersion: "dated-700-non-performance-v1" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Setup could not finish. Your private logging remains available."); } finally { setBusy(false); }
  }
  return <section className="card" aria-labelledby="dated-setup-title">
    <p className="meta">{qa ? "Synthetic QA policy · " : ""}Field Station · one-time setup</p>
    <h2 id="dated-setup-title">Start from 700</h2>
    <p>Each of the six Wellbecoming components starts at an assumed 700 from 26 October 2026. This experimental starting point is not an assessment.</p>
    <p>By joining {label}, you accept these starting values and automated review of your non-Performance logs. Missing effects stay unknown. Work stays private and unassessed, with no salary or valuation.</p>
    <p>Approved conversations and review history are retained as private evidence. Removing a draft does not erase that approved history.</p>
    {!house ? <p>Choose HouseOfBros only if it is your community. If you need HouseOfSis or another assignment, continue privately while Moses confirms it.</p> : null}
    <button disabled={busy} onClick={() => void accept()}>{busy ? "Saving…" : `Accept 700 and join ${label}`}</button>{" "}
    <button className="secondary" disabled={busy} onClick={() => setLater(true)}>Continue privately</button>
    <p role="status">{message}</p>
  </section>;
}
