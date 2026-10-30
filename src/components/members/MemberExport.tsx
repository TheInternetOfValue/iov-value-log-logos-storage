"use client";
import { memberExportWriter } from "@/lib/members/export-format";
import { useEffect, useRef, useState } from "react";
export function MemberExport({ binding }: { binding: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (busy) return; setBusy(true); setMessage("Preparing your private export…");
    const abort = new AbortController(); controller.current = abort;
    let cutoff = "", count = 0;
    let writer: ReturnType<typeof memberExportWriter> | null = null;
    try {
      for (const stage of ["activities","audit"] as const) {
        let cursor: string | null = null;
        do {
          const query: URLSearchParams = new URLSearchParams({ stage, ...(cutoff ? { cutoff } : {}), ...(cursor ? { cursor } : {}) });
          const response: Response = await fetch(`/api/member/export?${query}`, { cache: "no-store", signal: abort.signal, headers: { "x-value-log-session": binding } });
          const page: { records: unknown[]; next: string | null; cutoff: string; metadata: Record<string,unknown>; error?: string } = await response.json(); if (!response.ok) throw new Error(page.error);
          if (!cutoff) { cutoff = page.cutoff; writer = memberExportWriter(page.metadata); }
          writer!.append(stage, page.records);
          if (stage === "activities") count += page.records.length;
          cursor = page.next;
          setMessage(`Preparing your private export… ${count} activities collected.`);
        } while (cursor);
      }
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(new Blob(writer!.finish(), { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = "my-value-log.json";
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Your private export is ready. Keep the downloaded file somewhere private.");
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Export could not finish. Please try again; no partial file was downloaded."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy} onClick={() => void download()}>{busy ? "Preparing export…" : "Export my private Value Log"}</button><p role="status" aria-live="polite">{message}</p></div>;
}
