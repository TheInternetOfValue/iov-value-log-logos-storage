"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
const subscribeTimezone = () => () => {};
export function MemberSetup({ name = "", timezone = "UTC", binding, writing,cohortInvite, minimal=false }: { name?: string; timezone?: string; binding: string; writing: boolean;cohortInvite?:string; minimal?: boolean }) {
  const [needsSignin, setNeedsSignin] = useState(false);
  const router = useRouter();
  const browserTimezone = useSyncExternalStore(subscribeTimezone, () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", () => timezone);
  const [chosenZone, setZone] = useState<string | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const zone = minimal ? "Asia/Kolkata" : chosenZone ?? (name ? timezone : browserTimezone);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation(); const data = new FormData(event.currentTarget); setBusy(true); setMessage("");
    try {
      const result = await fetch("/api/member/setup", { method: "POST", headers: { "Content-Type": "application/json", "x-value-log-session": binding },
        body: JSON.stringify({ name: minimal ? name || "Value Log member" : data.get("name"), timezone: zone, accepted: minimal || data.get("accepted") === "on" }) });
      const body = await result.json(); if (!result.ok) { setNeedsSignin(result.status === 401 || result.status === 403); throw new Error(body.error); }
      router.push(cohortInvite&&/^[A-Za-z0-9_-]{32,100}$/.test(cohortInvite)?`/onboarding/field-station?invite=${encodeURIComponent(cohortInvite)}`:"/day"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save. Please try again."); } finally { setBusy(false); }
  }
  return <form data-inline-feedback="true" className="stack card member-form" onSubmit={submit}>
    {minimal ? <p>Open your private Value Log to save activities and return to them. Day times use India time. Your other Identity details are optional. Field Station starting assumptions and review are a separate choice.</p> : <>
    <label>What should we call you?<input name="name" defaultValue={name} maxLength={80} autoComplete="given-name" required /></label>
    <label>Your timezone<input value={zone} onChange={event => setZone(event.target.value)} list="member-timezones" required />
      <datalist id="member-timezones">{[...new Set([timezone, "UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "Asia/Singapore", "Australia/Sydney"])].map(value => <option key={value} value={value} />)}</datalist>
    </label>
    <p className="meta">Check the timezone before saving. It determines the dates in your Value Log.</p>
    <label className="member-consent"><input name="accepted" type="checkbox" required />Save my private activities in Value Log so I can return to them. I understand they are unassessed and do not produce a wellbeing score or credits.</label>
    </>}
    <button disabled={busy || !writing}>{busy ? "Saving…" : minimal ? "Open my private Value Log" : "Open my Value Log"}</button>
    {!writing ? <p>New activity saving is temporarily paused.</p> : null}
    <p role="status" aria-live="polite">{message}{needsSignin ? <> <a href="/login" target="_blank" rel="noopener">Open sign-in in another tab</a>, then return here.</> : null}</p>
  </form>;
}
