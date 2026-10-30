"use client";
import { useEffect, useRef, useState } from "react";
export function CohortExport({ binding }: { binding: string }) {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage("");
          const abort = new AbortController();
          controller.current = abort;
          void (async () => {
            const cutoff = new Date().toISOString(),
              data: Record<string, unknown[]> = {};
            for (const table of [
              "cohort_enrollments",
              "cohort_memberships",
              "cohort_reviewer_delegations",
              "cohort_rate_policies",
              "cohort_records",
              "cohort_review_events",
              "cohort_replay_runs",
              "approved_sources",
              "cohort_source_links",
            ]) {
              let offset: number | null = 0;
              data[table] = [];
              while (offset !== null) {
                const r: Response = await fetch(
                    `/api/cohort/export?table=${table}&offset=${offset}&cutoff=${encodeURIComponent(cutoff)}`,
                    {
                      cache: "no-store",
                      signal: abort.signal,
                      headers: { "x-value-log-session": binding },
                    },
                  ),
                  body: {
                    rows: unknown[];
                    next: number | null;
                    error?: string;
                  } = await r.json();
                if (!r.ok) throw new Error(body.error);
                data[table].push(...body.rows);
                offset = body.next;
              }
            }
            if (abort.signal.aborted) return;
            const url = URL.createObjectURL(
                new Blob(
                  [JSON.stringify({ version: 1, cutoff, data }, null, 2)],
                  { type: "application/json" },
                ),
              ),
              a = document.createElement("a");
            a.href = url;
            a.download = "field-station-private-export.json";
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage("Your complete pilot export is ready.");
          })()
            .catch((error) => {
              if (!abort.signal.aborted) setMessage(error.message);
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy
          ? "Preparing pilot export…"
          : "Export my complete Field Station records"}
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
