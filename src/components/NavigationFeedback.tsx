"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function NavigationFeedback() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const navigationKey = `${pathname}?${query}`;
  const [pending, setPending] = useState<{ message: string; key: string } | null>(null);
  const [longRunning, setLongRunning] = useState(false);

  useEffect(() => {
    if (!pending || pending.key !== navigationKey) return;
    const timer = window.setTimeout(() => setLongRunning(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [navigationKey, pending]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setLongRunning(false);
      setPending({ message: "Opening page…", key: navigationKey });
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.dataset.inlineFeedback === "true") return;
      const submitter = event.submitter as HTMLButtonElement | HTMLInputElement | null;
      const label = submitter?.dataset.pendingLabel;
      setLongRunning(false);
      setPending({ message: label || "Saving your changes…", key: navigationKey });
      for (const button of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]')) {
        button.setAttribute("aria-disabled", "true");
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, [navigationKey]);

  if (!pending || pending.key !== navigationKey) return null;
  return <div className="navigation-overlay" role="status" aria-live="polite" aria-busy="true">
    <div className="navigation-toast">
      <span className="loading-tilde" aria-hidden="true">~</span>
      <div><strong>{pending.message}</strong><span>{longRunning ? "Processing is continuing safely. You may leave and return later." : "Please wait while this step is recorded safely."}</span></div>
    </div>
  </div>;
}
