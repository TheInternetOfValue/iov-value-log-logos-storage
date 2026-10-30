"use client";
import { useState } from "react";
import type { DayIndexCursor } from "@/lib/members/prepare-day-index";

type Metrics = {
  inspected: number;
  indexedOccurrences: number;
  needsOperatorReview: number;
};
export function PrepareDayIndex({ binding }: { binding: string }) {
  const [pending, setPending] = useState<{
    apply: boolean;
    cursor: DayIndexCursor;
    metrics: Metrics;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState("");
  async function run(apply: boolean) {
    setBusy(true);
    setMessage(apply ? "Preparing saved times…" : "Checking saved times…");
    if (!apply) setReady(false);
    let cursor = pending?.apply === apply ? pending.cursor : null;
    const totals =
      pending?.apply === apply
        ? { ...pending.metrics }
        : { inspected: 0, indexedOccurrences: 0, needsOperatorReview: 0 };
    try {
      for (let page = 0; page < 10; page++) {
        const response = await fetch("/api/cohort/admin/day-index", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-value-log-session": binding,
          },
          body: JSON.stringify({ apply, cursor }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        for (const key of [
          "inspected",
          "indexedOccurrences",
          "needsOperatorReview",
        ] as const)
          totals[key] += result.metrics[key];
        cursor = result.next;
        if (!cursor) break;
      }
      setPending(cursor ? { apply, cursor, metrics: totals } : null);
      if (!apply) setReady(!cursor && totals.needsOperatorReview === 0);
      else if (!cursor) setReady(false);
      setMessage(
        `${totals.inspected} saved logs checked. ${totals.indexedOccurrences} ${apply ? "occurrences prepared" : "occurrences can be prepared"}. ${totals.needsOperatorReview} need review.${cursor ? " More batches remain; continue below." : ""}`,
      );
    } catch (error) {
      setMessage(
        `${(error as Error).message} Previous saved logs remain unchanged. A retry safely checks already prepared references.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Prepare older saved logs for day rings</summary>
      <p>
        Use only typed times from already approved private logs. This prepares a
        date index; it changes no writing, original receipt, score or sharing.
        Missing times need review. No writing or encryption setting is returned.
      </p>
      <button disabled={busy} onClick={() => void run(false)}>
        {pending && !pending.apply ? "Continue checking" : "Check saved times"}
      </button>{" "}
      <button
        disabled={busy || (!ready && !pending?.apply)}
        onClick={() => void run(true)}
      >
        {pending?.apply ? "Continue preparing" : "Prepare checked times"}
      </button>
      <p role="status">{message}</p>
    </details>
  );
}
