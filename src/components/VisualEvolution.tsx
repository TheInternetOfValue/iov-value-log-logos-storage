"use client";

import Image from "next/image";
import { useState } from "react";

const views = {
  weekly: {
    label: "Weekly score",
    before: "/review-placeholder.svg",
    after: "/review-placeholder.svg",
    beforeAlt: "Earlier Value Log weekly trend screen without chart axes or date labels.",
    afterAlt: "Value Log weekly Wellbeing Score chart with date and score axes.",
    beforeNote: "Direction was visible, but the date and score context were implicit.",
    afterNote: "Intentional dates, a labelled score scale, and on-demand point detail make the movement inspectable.",
    beforePosition: "top center",
    afterPosition: "top center",
  },
  withinDay: {
    label: "Within one day",
    before: "/review-placeholder.svg",
    after: "/review-placeholder.svg",
    beforeAlt: "Earlier within-day trend treatment without a full-day time axis or score axis.",
    afterAlt: "Value Log within-day Wellbeing Score chart with a 00:00 to 24:00 India Standard Time axis.",
    beforeNote: "The path showed movement, but not the time context or a readable scale.",
    afterNote: "A full-day India Standard Time axis, score grid, and focusable points make each transition traceable.",
    beforePosition: "center 76%",
    afterPosition: "center center",
  },
} as const;

export function VisualEvolution() {
  const [view, setView] = useState<keyof typeof views>("weekly");
  const current = views[view];

  return <section className="visual-evolution" aria-labelledby="visual-evolution-title">
    <div className="visual-evolution-heading">
      <div>
        <p className="meta">Visual evolution</p>
        <h2 id="visual-evolution-title">From direction to readable evidence</h2>
        <p>Two matched views show the chart change without implying that the pilot values are a general dataset.</p>
      </div>
      <div className="visual-evolution-switch" aria-label="Comparison view">
        {(Object.keys(views) as Array<keyof typeof views>).map((key) => <button
          aria-pressed={view === key}
          className={view === key ? "active" : ""}
          key={key}
          onClick={() => setView(key)}
          type="button"
        >{views[key].label}</button>)}
      </div>
    </div>

    <div className="visual-evolution-pair">
      <figure>
        <figcaption><span>Before</span>{current.beforeNote}</figcaption>
        <div className="visual-evolution-image">
          <Image alt={current.beforeAlt} fill priority sizes="(max-width: 760px) 92vw, 42vw" src={current.before} style={{ objectPosition: current.beforePosition }} />
        </div>
      </figure>
      <div aria-hidden="true" className="visual-evolution-arrow">→</div>
      <figure>
        <figcaption><span>After</span>{current.afterNote}</figcaption>
        <div className="visual-evolution-image">
          <Image alt={current.afterAlt} fill sizes="(max-width: 760px) 92vw, 42vw" src={current.after} style={{ objectPosition: current.afterPosition }} />
        </div>
      </figure>
    </div>
    <p className="visual-evolution-disclosure">Illustrative pilot screen captures from a private account. They demonstrate interface changes only; they are not representative user data or outcome claims.</p>
  </section>;
}
