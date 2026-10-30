"use client";
import { useEffect, useRef, useState } from "react";
export function NativeExport({ binding }: { binding: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    setBusy(true); setMessage("Preparing your private voice-log drafts…");
    const abort = new AbortController(); controller.current = abort;
    try {
      let cursor: string | null = null, cutoff = "";
      const parts: BlobPart[] = ['{"format":"value-log-native-v1","drafts":[']; let count = 0;
      do {
        const query: URLSearchParams = new URLSearchParams({ ...(cutoff ? { cutoff } : {}), ...(cursor ? { cursor } : {}) });
        const response = await fetch(`/api/native-log/export?${query}`, { cache: "no-store", signal: abort.signal, headers: { "x-value-log-session": binding } });
        const page: { records: unknown[]; cutoff: string; next: string | null; error?: string } = await response.json();
        if (!response.ok) throw new Error(page.error || "Export could not finish.");
        for (const record of page.records) parts.push(`${count++ ? "," : ""}${JSON.stringify(record)}`);
        cutoff = page.cutoff; cursor = page.next;
        setMessage(`Preparing export… ${count} drafts and removal markers collected.`);
      } while (cursor);
      if (abort.signal.aborted) return;
      parts.push("]}"); const url = URL.createObjectURL(new Blob(parts, { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "my-value-log-voice-drafts.json"; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("Your private export is ready. Keep it somewhere private.");
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Export could not finish. Try again; no partial file was downloaded."); }
    finally { setBusy(false); }
  }
  return <div><button className="secondary" disabled={busy} onClick={() => void download()}>Export my voice-log drafts</button><p role="status">{message}</p></div>;
}
