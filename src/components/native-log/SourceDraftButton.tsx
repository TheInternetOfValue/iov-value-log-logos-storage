"use client";
import { useState } from "react";
export function SourceDraftButton({ action, sourceId, binding }: { action: "adopt" | "continue"; sourceId: string; binding: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function open() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/native-log/source-draft", { method: "POST", headers: { "content-type": "application/json", "x-value-log-session": binding }, body: JSON.stringify({ action, sourceId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); location.assign(body.path);
    } catch (error) { setMessage(error instanceof Error ? error.message : "This conversation could not open. Your saved log remains available."); setBusy(false); }
  }
  return <><button className="secondary" disabled={busy} onClick={() => void open()}>{busy ? "Opening…" : action === "adopt" ? "Review this earlier log" : "Correct by voice"}</button><p role="status">{message}</p></>;
}
