import Image from "next/image";

type Frame = {
  asset: string;
  alt: string;
  label: string;
};

const chapters: Array<{
  order: string;
  date: string;
  title: string;
  story: string;
  frames: Frame[];
}> = [
  {
    order: "2026-07-23-04",
    date: "23 July 2026 · Weave-first production reading",
    title: "The weave becomes the instrument—and reveals the next refinements",
    story: "This owner-authorized production sequence verifies the weave-first hierarchy, compact movement lens, contextual Performance reading, and exact evidence. It also records the remaining loading-question flash, partially obscured stitch halo, and compressed mobile index that prompted the next presentation-only refinement.",
    frames: [
      { asset: "2026-07-23/18-insights-14-day-overview-after-weave-first.webp", label: "Overview · after", alt: "Value Log Insights production overview with the numerical period ledger and Becoming Weave presented before movement." },
      { asset: "2026-07-23/19-insights-loading-question-flash-after-weave-first.webp", label: "Loading · observation", alt: "Value Log Insights production loading skeleton with the conceptual question still visible during loading." },
      { asset: "2026-07-23/20-insights-stitch-halo-obscured-after-weave-first.webp", label: "Focus · observation", alt: "Close production view of a selected weave stitch where most of the Ember halo sits beneath the stitch." },
      { asset: "2026-07-23/21-insights-movement-reading-after-weave-first.webp", label: "Movement · after", alt: "Value Log Insights production movement lens with a compact zero-centred period plot and selected-day settlement path." },
      { asset: "2026-07-23/22-insights-performance-reading-after-weave-first.webp", label: "Performance · after", alt: "Value Log Insights production Performance stitch reading with community provenance and credits separate from Wellbeing movement." },
      { asset: "2026-07-23/23-insights-performance-evidence-after-weave-first.webp", label: "Evidence · after", alt: "Value Log Insights production Performance evidence with exact totals and separate community credit routing." },
      { asset: "2026-07-23/24-insights-mobile-overview-before-mobile-trace-refinement.webp", label: "Mobile · observation", alt: "Value Log Insights mobile overview before gutters, compact ledger rhythm, and true miniature time traces were refined." },
    ],
  },
  {
    order: "2026-07-23-03",
    date: "23 July 2026 · Weave-first refinement",
    title: "The accumulation becomes the first reading",
    story: "These owner-authorized production observations record the final issues before the weave-first refinement: the movement chart still led the page, loading briefly introduced a different title, and exact stitches needed a stronger but geometrically stable focus state. The next authenticated sequence will be added after deployment.",
    frames: [
      { asset: "2026-07-23/14-insights-14-day-summary-before-weave-first.webp", label: "Hierarchy · before", alt: "Value Log Insights with the period summary and movement chart above the Becoming Weave before the weave-first refinement." },
      { asset: "2026-07-23/15-insights-loading-flash-before-stable-loading.webp", label: "Loading · before", alt: "Value Log Insights loading state briefly displaying Across time before the final page title loaded." },
      { asset: "2026-07-23/16-insights-selected-physiology-before-strong-focus.webp", label: "Thread · before", alt: "Value Log Becoming Weave with Physiology selected before stronger stable stitch focus." },
      { asset: "2026-07-23/17-insights-overnight-stitch-before-strong-focus.webp", label: "Overnight · before", alt: "Value Log Becoming Weave reading an overnight Physiology activity before stronger stable stitch focus." },
    ],
  },
  {
    order: "2026-07-23-02",
    date: "23 July 2026 · Contextual instrument",
    title: "From one long report to reading, movement, and evidence",
    story: "This complete owner-authorized production sequence records the first Becoming Weave release before contextual disclosure. It includes period, node, activity, Performance, exact evidence, and mobile states. The refinement keeps the weave primary while movement and evidence open only when requested.",
    frames: [
      { asset: "2026-07-23/05-insights-selected-physiology-before-contextual-refinement.webp", label: "Physiology", alt: "Value Log Becoming Weave with an exact Physiology activity selected." },
      { asset: "2026-07-23/06-insights-opening-pulse-before-contextual-refinement.webp", label: "Movement", alt: "Value Log Insights with the period movement horizon before contextual disclosure." },
      { asset: "2026-07-23/07-insights-exact-daily-chart-before-contextual-refinement.webp", label: "Daily evidence", alt: "Value Log Insights with the expanded daily Wellbeing movement chart." },
      { asset: "2026-07-23/08-insights-within-day-chart-before-contextual-refinement.webp", label: "Settlement", alt: "Value Log Insights with the expanded within-day Wellbeing settlement chart." },
      { asset: "2026-07-23/09-insights-selected-habit-before-contextual-refinement.webp", label: "Habit", alt: "Value Log Becoming Weave with a Habit activity selected." },
      { asset: "2026-07-23/10-insights-selected-performance-before-contextual-refinement.webp", label: "Performance", alt: "Value Log Becoming Weave with a Performance activity and its separate credit result selected." },
      { asset: "2026-07-23/11-insights-period-overview-before-contextual-refinement.webp", label: "Overview", alt: "Value Log Becoming Weave period overview." },
      { asset: "2026-07-23/12-insights-mobile-node-index-before-contextual-refinement.webp", label: "Mobile index", alt: "Value Log Becoming Weave mobile node index before wrapping and contextual refinements." },
      { asset: "2026-07-23/13-insights-mobile-selected-node-before-contextual-refinement.webp", label: "Mobile reading", alt: "Value Log Becoming Weave mobile selected-node and identity-context reading." },
    ],
  },
  {
    order: "2026-07-23-01",
    date: "23 July 2026 · Becoming Weave",
    title: "From stacked analytics to a longitudinal portrait",
    story: "This owner-authorized production sequence preserves the card-and-chart-led Insights baseline before the Becoming Weave. The released reading will connect the Living Day to the identity portrait: canonical activity gathers along five Wellbecoming threads, Performance remains separate, and exact evidence stays available below.",
    frames: [
      { asset: "2026-07-23/01-profile-ring-context-before-insights-weave.webp", label: "Identity context", alt: "Owner-authorized private Wellbeing Identity portrait used as architectural context for the light-background identity locator." },
      { asset: "2026-07-23/02-insights-summary-movement-before-weave.webp", label: "Period summary · before", alt: "Value Log Insights before the Becoming Weave, showing a textual period summary and daily completed-W bar chart." },
      { asset: "2026-07-23/03-insights-within-day-before-weave.webp", label: "Within day · before", alt: "Value Log Insights before the Becoming Weave, showing the selected-day Wellbeing movement chart and transition evidence." },
      { asset: "2026-07-23/04-insights-commons-days-before-weave.webp", label: "Ledgers · before", alt: "Value Log Insights before the Becoming Weave, showing Commons totals, recorded-day cards, and the private reflection prompt." },
    ],
  },
  {
    order: "2026-07-22-01",
    date: "22 July 2026 · Living Day",
    title: "From stacked surfaces to one living instrument",
    story: "This owner-authorized production sequence begins with the card-led Today experience, then records the released Living Day clock: plans recede outside, canonical life becomes vivid inside, exact movement remains separate, and the Bharathi reading opens as a human poster rather than another daily card.",
    frames: [
      { asset: "2026-07-22/01-today-opening-before-living-day-clock.webp", label: "Opening · before", alt: "Value Log Today opening before the Living Day clock, with a full-width Bharathi reading, daily focus, and current-plan card." },
      { asset: "2026-07-22/02-planned-schedule-before-living-day-clock.webp", label: "Plan · before", alt: "Value Log Today showing the planned schedule as a long row-based list before the clock composition." },
      { asset: "2026-07-22/03-month-reading-before-living-day-clock.webp", label: "Month · before", alt: "Value Log Today showing the seven-day strip and expanded monthly activity calendar before the clock-first hierarchy." },
      { asset: "2026-07-22/04-cinematic-reel-before-living-day-clock.webp", label: "Reel · before", alt: "Value Log completed-day cinematic reel before it became subordinate to the Living Day instrument." },
      { asset: "2026-07-22/05-living-day-empty-after.webp", label: "Open day · after", alt: "Value Log Living Day clock showing quiet plans and an empty canonical day after the redesign." },
      { asset: "2026-07-22/06-living-day-recorded-after.webp", label: "Recorded day · after", alt: "Value Log Living Day clock showing vivid canonical activities, quiet planned arcs, W movement dots, and Performance credit diamonds." },
      { asset: "2026-07-22/07-living-day-activity-reading-after.webp", label: "Activity · after", alt: "Value Log Living Day clock with a recorded Physiology activity selected and readable in the annotation rail." },
      { asset: "2026-07-22/08-living-day-performance-reading-after.webp", label: "Performance · after", alt: "Value Log Living Day clock with a Performance activity selected and its exact credit result shown separately." },
      { asset: "2026-07-22/09-bharathi-poster-after.webp", label: "Bharathi · after", alt: "Value Log Today with the Daily Bharathi poster opened from its compact portrait trigger." },
    ],
  },
  {
    order: "2026-07-22-02",
    date: "22 July 2026 · Interaction diagnosis",
    title: "The pointer collision that made the clock shimmer",
    story: "These owner-authorized diagnostic observations show the planned-ring and Performance-diamond collision before the clock adopted one stable glance-and-select grammar. They are now part of the public visual history alongside the more polished release states.",
    frames: [
      { asset: "2026-07-22/10-living-day-plan-diamond-hit-collision-before.webp", label: "Collision · before", alt: "Value Log Living Day with a planned arc and Performance diamond competing at the pointer boundary." },
      { asset: "2026-07-22/11-living-day-plan-reading-before-consistent-hover.webp", label: "Grammar · before", alt: "Value Log Living Day showing a planned reading before planned and recorded arcs shared one hover, focus, and selection grammar." },
    ],
  },
  {
    order: "2026-07-17-01",
    date: "17 July 2026 · Canonical Life First",
    title: "A day, decisions, and change each have a clear home",
    story: "This authenticated production sequence records the first complete pass through the new hierarchy: community-authority decisions resolve to a quiet Review state, while Today keeps the day readable. The final Insights capture records the remaining long-range axis issue that this release corrects.",
    frames: [
      { asset: "2026-07-17/01-review-two-authority-confirmation.webp", label: "Two decisions", alt: "Value Log Review with two community-authority confirmation decisions." },
      { asset: "2026-07-17/02-review-one-authority-confirmed.webp", label: "One remaining", alt: "Value Log Review after one community-authority confirmation is recorded." },
      { asset: "2026-07-17/03-review-all-caught-up.webp", label: "Clear state", alt: "Value Log Review after all available decisions are complete." },
      { asset: "2026-07-17/04-today-canonical-day.webp", label: "Canonical day", alt: "Value Log Today with a canonical day, date strip, day map, and agenda." },
      { asset: "2026-07-17/05-today-chronological-agenda.webp", label: "Chronological agenda", alt: "Value Log Today showing chronological activity rows." },
      { asset: "2026-07-17/06-insights-30-day-axis-observation.webp", label: "Insight observation", alt: "Value Log Insights 30-day chart before long-range axis readability refinement." },
    ],
  },
  {
    order: "2026-07-15-03",
    date: "15 July 2026 · Insights",
    title: "Readable evidence while the app works",
    story: "Insights now keeps its weekly and within-day evidence legible, while a centered filling-tilde message explains genuine page transitions without inventing percentage progress.",
    frames: [
      { asset: "2026-07-15/09-insights-centered-loading-after.webp", label: "Opening", alt: "Value Log Insights showing the centered filling-tilde opening state." },
      { asset: "2026-07-15/10-insights-weekly-after.webp", label: "Weekly", alt: "Value Log fourteen-day Wellbeing Score evidence after the presentation and replay repair." },
      { asset: "2026-07-15/11-insights-within-day-after.webp", label: "Within day", alt: "Value Log within-day Wellbeing Score path and dated evidence rows after the presentation and replay repair." },
    ],
  },
  {
    order: "2026-07-16-01",
    date: "16 July 2026 · Calculation recovery",
    title: "When human review was complete but machine work was not",
    story: "This owner-authorized diagnostic sequence made the stalled background calculation visible without inventing another human decision. It distinguishes validated records, recalculation status, and a clear Commons queue before the worker repair.",
    frames: [
      { asset: "2026-07-16/01-validated-records-awaiting-background-calculation-before-worker-repair.webp", label: "Validated", alt: "Value Log showing validated records awaiting background calculation before the worker repair." },
      { asset: "2026-07-16/02-review-stale-recalculation-running-before-worker-repair.webp", label: "Recalculation", alt: "Value Log Review showing stale recalculation status before the worker repair." },
      { asset: "2026-07-16/03-commons-clear-human-confirmation-complete-before-worker-repair.webp", label: "Human queue clear", alt: "Value Log Commons review correctly showing human confirmation complete while machine calculation remained outstanding." },
    ],
  },
  {
    order: "2026-07-15-04",
    date: "15 July 2026 · Projection diagnosis",
    title: "The evidence that isolated a range projection fault",
    story: "These owner-authorized observations preserve the diagnostic path: Insights remained internally consistent while Today missed a completed calendar score, and Review exposed a stale retry state. The evidence narrowed the repair without changing canonical records.",
    frames: [
      { asset: "2026-07-15/01-insights-daily-rows-projection-intact-before-calendar-repair.webp", label: "Rows intact", alt: "Value Log Insights daily rows showing an intact completed projection before the Today calendar repair." },
      { asset: "2026-07-15/02-insights-score-trend-projection-intact-before-calendar-repair.webp", label: "Trend intact", alt: "Value Log Insights score trend showing an intact completed projection before the Today calendar repair." },
      { asset: "2026-07-15/03-insights-summary-projection-intact-before-calendar-repair.webp", label: "Summary intact", alt: "Value Log Insights summary showing an intact completed projection before the Today calendar repair." },
      { asset: "2026-07-15/04-review-stale-retry-before-status-repair.webp", label: "Retry stale", alt: "Value Log Review showing a stale retry state before calculation-status repair." },
      { asset: "2026-07-15/05-today-calendar-missing-score-before-range-repair.webp", label: "Calendar fault", alt: "Value Log Today calendar missing a completed score before the full-month range repair." },
    ],
  },
  {
    order: "2026-07-15-02",
    date: "15 July 2026 · Review",
    title: "Human confirmation and machine work become distinct",
    story: "Commons-wise stays quiet when nothing needs a person. The session view became an inbox next: this captured oldest-first baseline records the final ordering issue, while approval eligibility continues to protect chronological calculation.",
    frames: [
      { asset: "2026-07-15/07-review-oldest-first-before-inbox-order.webp", label: "Ordering baseline", alt: "Value Log Chronological Review showing the oldest recorded session first before inbox ordering." },
      { asset: "2026-07-15/08-review-commons-clear-after.webp", label: "Clear Commons", alt: "Value Log Commons-wise Review correctly showing that no human confirmation is required." },
    ],
  },
  {
    order: "2026-07-15-01",
    date: "15 July 2026 · Today",
    title: "One projection, consistently presented",
    story: "After the range repair, Today reads the same completed month-wide Wellbeing Score projection as Insights. Logged days show their closing score; future and empty days remain quiet.",
    frames: [
      { asset: "2026-07-14/01-today-calendar-before-review-navigation.webp", label: "Earlier baseline", alt: "Value Log Today calendar before the compact navigation and projection consistency work." },
      { asset: "2026-07-15/06-today-calendar-scores-after-range-repair.webp", label: "After repair", alt: "Value Log Today calendar showing completed daily Wellbeing Scores after the full-month range repair." },
    ],
  },
  {
    order: "2026-07-13-05",
    date: "Activity reading",
    title: "From a compressed day to a legible agenda",
    story: "The first daily view made activity density visible, but individual records collided. The evolved view separates orientation from reading: a compact density layer above a chaptered agenda.",
    frames: [
      { asset: "01-activity-timeline-before-agenda.webp", label: "Before", alt: "Earlier Value Log daily timeline with densely stacked activity blocks." },
      { asset: "08-activity-density-agenda-after.webp", label: "After", alt: "Updated Value Log day view with a compact density map and readable activity agenda." },
      { asset: "10-activity-agenda-chapters-after.webp", label: "Detail", alt: "Updated Value Log agenda grouped into time-of-day chapters." },
    ],
  },
  {
    order: "2026-07-13-04",
    date: "Month hierarchy",
    title: "From activity heatmap to a calm month ledger",
    story: "The month view first exposed volume, then overcorrected by carrying a large score onto every empty day. The final state gives logged days their score and count while letting empty days stay quiet.",
    frames: [
      { asset: "02-month-calendar-count-before-pilot-w.webp", label: "Before", alt: "Earlier Value Log monthly activity calendar with count-based colour intensity." },
      { asset: "05-month-calendar-carried-score-before-refinement.webp", label: "Interim", alt: "Earlier Value Log monthly calendar displaying a large score on all days." },
      { asset: "06-command-centre-calendar-after.webp", label: "After", alt: "Updated Value Log command centre and monthly calendar with quiet empty days." },
    ],
  },
  {
    order: "2026-07-13-03",
    date: "Session review",
    title: "From raw intake to a reviewable record",
    story: "Inbox now makes the structured outcome the first reading task. The source narrative remains available, but no longer competes with the record that needs review.",
    frames: [
      { asset: "07-inbox-session-review-after.webp", label: "Session", alt: "Value Log Inbox showing a session-first structured review." },
      { asset: "09-inbox-session-review-after-detail.webp", label: "Detail", alt: "Value Log Inbox showing the structured activity rows within a session." },
    ],
  },
  {
    order: "2026-07-13-02",
    date: "Trends and reflection",
    title: "From a direction line to a time-aware score story",
    story: "Trend reading grew from a cross-day line into a selected-day path, a private weekly reflection, and then a chart with explicit time, score, and point-level context.",
    frames: [
      { asset: "03-trends-cross-day-before-within-day.webp", label: "Before", alt: "Earlier Value Log Trends page with cross-day score movement." },
      { asset: "11-trends-within-day-after.webp", label: "Within day", alt: "Value Log Trends page with an earlier within-day score path." },
      { asset: "13-weekly-reflection-after.webp", label: "Reflection", alt: "Value Log private weekly reflection panel." },
      { asset: "14-trends-chart-before-axis-after-capture.webp", label: "Chart baseline", alt: "Value Log Trends chart before axes and point details were added." },
      { asset: "15-weekly-trend-axis-after.webp", label: "Weekly after", alt: "Value Log weekly Wellbeing Score chart with axes." },
      { asset: "16-within-day-trend-axis-after.webp", label: "Within-day after", alt: "Value Log within-day Wellbeing Score chart with full-day time axis." },
    ],
  },
  {
    order: "2026-07-13-01",
    date: "Projection trust",
    title: "From “published” to visible synchronization health",
    story: "A status label alone does not communicate freshness. The profile now makes the last result, recent projection activity, and expected schedule inspectable.",
    frames: [
      { asset: "04-profile-published-before-sync-health.webp", label: "Before", alt: "Earlier Value Log profile card with published status only." },
      { asset: "12-profile-sync-health-after.webp", label: "After", alt: "Updated Value Log profile synchronization health and recent activity." },
    ],
  },
  {
    order: "2026-07-14-05",
    date: "14 July baseline · Today",
    title: "A clear starting point for daily orientation",
    story: "These approved baseline views preserve the daily context before navigation was simplified. The after pair will be added from the authenticated production release, not recreated from an empty local screen.",
    frames: [
      { asset: "2026-07-14/01-today-calendar-before-review-navigation.webp", label: "Calendar baseline", alt: "Value Log Today page with calendar and next best action before Review navigation." },
      { asset: "2026-07-14/02-today-day-detail-before-review-navigation.webp", label: "Day baseline", alt: "Value Log selected-day detail before Review navigation." },
    ],
  },
  {
    order: "2026-07-14-04",
    date: "14 July baseline · Insights",
    title: "Reflection remains grounded in readable evidence",
    story: "Weekly and within-day views are preserved here as the baseline for the next reading-order refinement. The score remains a reflective signal, never a target or reward.",
    frames: [
      { asset: "2026-07-14/03-insights-weekly-before-review-navigation.webp", label: "Weekly baseline", alt: "Value Log weekly Insights view before Review navigation." },
      { asset: "2026-07-14/04-insights-within-day-before-review-navigation.webp", label: "Within-day baseline", alt: "Value Log within-day Insights view before Review navigation." },
    ],
  },
  {
    order: "2026-07-14-03",
    date: "14 July baseline · Review",
    title: "Two queues become one review workspace",
    story: "The baseline preserves the existing strengths: a readable session inbox and role-scoped community confirmation. The new Review workspace brings them together without merging their distinct acts.",
    frames: [
      { asset: "2026-07-14/07-inbox-before-review-unification.webp", label: "Sessions baseline", alt: "Value Log Inbox session list before the unified Review workspace." },
      { asset: "2026-07-14/05-confirm-community-before-review-unification.webp", label: "Community baseline", alt: "Value Log community confirmation page before the unified Review workspace." },
      { asset: "2026-07-14/06-confirm-community-groups-before-review-unification.webp", label: "Bulk review baseline", alt: "Value Log role-scoped bulk confirmation controls before the unified Review workspace." },
    ],
  },
  {
    order: "2026-07-14-02",
    date: "14 July baseline · Method",
    title: "Detailed safeguards stay available, without crowding the daily path",
    story: "Method remains a durable reference for calculation, replay, and privacy. The change is one of wayfinding: it moves behind the persistent `~` menu while remaining one intentional action away.",
    frames: [
      { asset: "2026-07-14/08-method-top-before-menu-navigation.webp", label: "Method baseline", alt: "Value Log Method page before the compact navigation menu." },
      { asset: "2026-07-14/09-method-calculation-before-menu-navigation.webp", label: "Calculation reference", alt: "Value Log Method calculation reference." },
      { asset: "2026-07-14/10-method-safeguards-before-menu-navigation.webp", label: "Safeguards reference", alt: "Value Log Method replay and privacy safeguards." },
    ],
  },
  {
    order: "2026-07-14-01",
    date: "14 July baseline · Changelog",
    title: "The record of change becomes part of the product",
    story: "The public changelog already showed product evolution. This baseline records the next step: a richer visual history that keeps what changed, why it changed, and the before/after evidence together.",
    frames: [
      { asset: "2026-07-14/11-changelog-top-before-review-navigation.webp", label: "Opening baseline", alt: "Value Log public changelog opening before the Review workspace chapter." },
      { asset: "2026-07-14/12-changelog-gallery-before-review-navigation.webp", label: "Gallery baseline", alt: "Value Log public changelog gallery before the Review workspace chapter." },
      { asset: "2026-07-14/13-changelog-timeline-before-review-navigation.webp", label: "Timeline baseline", alt: "Value Log public changelog timeline before the Review workspace chapter." },
    ],
  },
];

export function EvolutionGallery() {
  return <section className="evolution-gallery" aria-labelledby="evolution-gallery-title">
    <header>
      <p className="meta">Complete visual record</p>
      <h2 id="evolution-gallery-title">How the private pilot has evolved</h2>
      <p>Newest chapters appear first. Each keeps the actual screen evolution visible: what felt unclear, what changed, and how the reading experience improved.</p>
    </header>
    <div className="evolution-chapters">
      {[...chapters].sort((a, b) => b.order.localeCompare(a.order)).map((chapter) => <article className="evolution-chapter" key={chapter.title}>
        <div className="evolution-chapter-copy">
          <p className="meta">{chapter.date}</p>
          <h3>{chapter.title}</h3>
          <p>{chapter.story}</p>
        </div>
        <div className={`evolution-frames frames-${chapter.frames.length}`}>
          {chapter.frames.map((frame, index) => <figure key={frame.asset}>
            <figcaption>{frame.label}{index < chapter.frames.length - 1 && chapter.frames.length > 1 ? <span aria-hidden="true"> →</span> : null}</figcaption>
            <div className="evolution-frame-image">
              <Image alt="Historical screenshot omitted from public source review" fill sizes="(max-width: 760px) 92vw, (max-width: 1120px) 42vw, 30vw" src="/review-placeholder.svg" />
            </div>
          </figure>)}
        </div>
      </article>)}
    </div>
    <p className="evolution-gallery-disclosure">Illustrative demo content from an owner-authorized private pilot account. Text, values, dates, names, and activity labels are shown to demonstrate interface evolution only; they are not representative data, independent evidence, or outcome claims.</p>
  </section>;
}
