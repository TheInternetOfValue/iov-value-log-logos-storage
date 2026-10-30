"use client";

import { useEffect, useRef } from "react";

export function HouseOfBrosIntro({ destination = "Review" }: { destination?: "Review" | "Insights" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem("value-log-house-intro-seen") === "1") return;
      localStorage.setItem("value-log-house-intro-seen", "1");
    } catch { /* The explanation still opens if browser storage is unavailable. */ }
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return <>
    <button className="house-intro-trigger" type="button" onClick={() => dialog.current?.showModal()}>What is HouseOfBros? <span aria-hidden="true">↗</span></button>
    <dialog ref={dialog} className="house-intro-dialog" aria-labelledby="house-intro-title" aria-describedby="house-intro-description">
      <div className="house-intro-top"><span>VALUE LOG <b> / </b> COMMUNITY</span><button type="button" aria-label="Close explanation" onClick={() => dialog.current?.close()}>×</button></div>
      <div className="house-intro-symbol" aria-hidden="true"><span>~</span></div>
      <h2 id="house-intro-title">House <span>Of</span> Bros<span className="house-intro-dot">.</span></h2>
      <p id="house-intro-description" className="house-intro-lead">A community that reviews how activities are recorded.</p>
      <div className="house-intro-divider" />
      <p className="house-intro-limit">It checks clarity and classification, but cannot independently verify how you feel.</p>
      <button className="house-intro-close" type="button" onClick={() => dialog.current?.close()}>Continue to {destination} <span aria-hidden="true">→</span></button>
    </dialog>
  </>;
}
