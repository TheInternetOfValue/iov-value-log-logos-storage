export class NativePollError extends Error { constructor(message: string, readonly status = 0) { super(message); } }
export async function pollNativeProposal<T extends { revision: number; status?: string; document?: unknown; processingUntil?: string | null }>(options: {
  id: string; revision: number; binding: string; signal: AbortSignal;
  /** When the queue request's answer was lost, the job may claim the draft a little later; wait this long before calling it stopped. */
  claimGraceMs?: number;
}): Promise<T> {
  const deadline = Date.now() + 180000, claimBy = Date.now() + (options.claimGraceMs ?? 0);
  let attempt = 0;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/native-log/drafts?id=${options.id}`, { headers: { "x-value-log-session": options.binding }, cache: "no-store", signal: AbortSignal.any([options.signal, AbortSignal.timeout(7000)]) });
    const view = await response.json().catch(() => null);
    if (!response.ok || !view) throw new NativePollError(view?.error || "Could not check progress. Your saved words remain available.", response.status);
    if (!view.document || view.status !== "draft") throw new NativePollError("This draft was submitted or removed. Open your saved logs.");
    if (view.revision > options.revision) return view as T;
    if (!view.processingUntil && Date.now() >= claimBy) throw new NativePollError("Processing stopped before it finished. Your words are saved; try again.");
    await new Promise<void>((resolve, reject) => {
      // Check again as soon as the tab is back in view; timers in a backgrounded tab may not have run.
      const page = typeof document === "undefined" ? null : document;
      const done = () => { clearTimeout(timer); options.signal.removeEventListener("abort", stop); page?.removeEventListener("visibilitychange", wake); };
      const stop = () => { done(); reject(new NativePollError("Stopped waiting. Your saved words remain available.")); };
      const wake = () => { if (page?.visibilityState === "visible") { done(); resolve(); } };
      const timer = setTimeout(() => { done(); resolve(); }, Math.min(4000, 1200 + attempt++ * 400));
      options.signal.addEventListener("abort", stop, { once: true });
      page?.addEventListener("visibilitychange", wake);
      if (options.signal.aborted) stop();
    });
  }
  throw new NativePollError("Your words are saved. Open the saved draft shortly to check whether the activities finished.");
}
