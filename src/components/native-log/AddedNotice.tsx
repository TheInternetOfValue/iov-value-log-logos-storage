"use client";
import { useEffect, useState } from "react";

/** Short confirmation on Today after a submission; the day itself is unchanged. */
export function AddedNotice({ timed, notes }: { timed: number; notes: number }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible || (!timed && !notes)) return null;
  const text = timed
    ? `${timed} ${timed === 1 ? "activity" : "activities"} added · highlighted on your day`
    : `${notes} ${notes === 1 ? "note" : "notes"} added`;
  return <p className="added-notice" role="status"><span aria-hidden="true">✓</span>{text}</p>;
}
