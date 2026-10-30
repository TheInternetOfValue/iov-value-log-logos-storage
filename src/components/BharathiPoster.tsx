"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { AathichudiItem } from "@/lib/daily-bharathi";

function BharathiyarMark() {
  return <svg aria-hidden="true" viewBox="0 0 64 64">
    <path d="M13 28c1-13 9-21 20-21 10 0 18 7 20 19-8-4-14-5-20-3-7 2-13 4-20 5Z" />
    <path d="M19 27c0 13 5 24 14 24 8 0 14-10 14-24-8-3-18-3-28 0Z" />
    <path className="bharathi-mark-paper" d="M13 25c2-12 10-19 20-19 9 0 17 6 20 17-9-3-16-3-22-1-7 3-12 4-18 3Z" />
    <path className="bharathi-mark-paper" d="M23 39c3-4 6-5 10-1 4-4 8-3 11 1-4 1-7 3-11 6-3-3-6-5-10-6Z" />
  </svg>;
}

export function BharathiPoster({ item }: { item: AathichudiItem }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = preview || pinned;

  return <div
    className={`bharathi-presence${open ? " open" : ""}`}
    onBlur={(event) => {
      if (!rootRef.current?.contains(event.relatedTarget as Node)) setPreview(false);
    }}
    onFocus={() => setPreview(true)}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        setPinned(false);
        setPreview(false);
        rootRef.current?.querySelector<HTMLButtonElement>(".bharathi-trigger")?.focus();
      }
    }}
    onMouseEnter={() => setPreview(true)}
    onMouseLeave={() => setPreview(false)}
    ref={rootRef}
  >
    <button
      aria-controls="daily-bharathi-poster"
      aria-expanded={open}
      aria-label="Open today's Bharathi reading"
      className="bharathi-trigger"
      onClick={() => setPinned((value) => !value)}
      type="button"
    >
      <BharathiyarMark />
      <span>Today&apos;s Bharathi</span>
    </button>
    {open ? <aside aria-labelledby="daily-bharathi-title" className="daily-bharathi-poster" id="daily-bharathi-poster">
      <div className="bharathi-poster-portrait">
        <figure>
          <Image alt="Subramania Bharati" height={226} sizes="(max-width: 760px) 104px, 170px" src="/brand/bharathiyar-portrait.png" width={300} />
        </figure>
        <div className="bharathi-portrait-copy"><span lang="ta">சுப்பிரமணிய பாரதி</span><strong>Daily Bharathi</strong></div>
      </div>
      <div className="bharathi-poster-reading">
        <header><p>புதிய ஆத்திசூடி</p><span>{item.number} / 110</span></header>
        <h2 id="daily-bharathi-title" lang="ta">{item["புதிய ஆத்திசூடி"]}</h2>
        <p className="daily-bharathi-english">{item["in English"]}</p>
        <p className="daily-bharathi-meaning" lang="ta">{item["எளிய பொருள்"]}</p>
        <details>
          <summary>Read reflection</summary>
          <p>{item.explanation}</p>
        </details>
      </div>
      <button aria-label="Close today's Bharathi reading" className="bharathi-close" onClick={() => { setPinned(false); setPreview(false); }} type="button">×</button>
    </aside> : null}
  </div>;
}
