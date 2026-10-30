import Link from "next/link";
import { validateBatch } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { DraftReview } from "@/components/review/DraftReview";
import { PerformanceImpactDecision } from "@/components/review/PerformanceImpactDecision";
import { ReplayStatus } from "@/components/review/ReplayStatus";
import { TimelineConflictCard } from "@/components/review/TimelineConflictCard";
import { formatLocalDateTime, formatLocalTime } from "@/lib/format";
import { pageSession } from "@/lib/page-auth";
import { reviewDecisionSummary, type ReviewDecisionDraft, type ReviewDecisionSlice } from "@/lib/review-decisions";
import { isReplayStale } from "@/lib/replay-runtime";
import { findTimelineOverlaps } from "@/lib/timeline-integrity";

function humanRole(role: string) {
  if (role === "house_of_bros_validator") return "HouseOfBros wellbeing evidence validator";
  if (role === "gfe_validator") return "GFE Performance validator";
  return "IoV Performance validator";
}

function communityLabel(value: string) {
  if (value === "house_of_bros") return "HouseOfBros";
  if (value === "iov") return "IoV Research Foundation";
  return "Growth Flow Engineering";
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00+05:30`));
}

function classification(slice: { slice_type: string; wellbeing_node: string; sao_lane?: string | null; skill_level?: string | null }) {
  return slice.slice_type === "performance" ? ["Performance", slice.sao_lane, slice.skill_level].filter(Boolean).join(" · ") : slice.wellbeing_node;
}

export async function CommunityReview({ error, corrected, saved, authority, settlement }: { error?: string; corrected?: string; saved?: string; authority?: string; settlement?: string }) {
  const { client } = await pageSession();
  const [{ data: pending }, { data: drafts }, { data: activeTimeline }, { data: replay }, { data: recentValidations }] = await Promise.all([
    client.from("canonical_slices").select("id,status,start_at,end_at,timezone,activity,proof,wellbeing_node,slice_type,community,sao_lane,skill_level,impact_direction,founder_performance_impact,founder_performance_impact_status").eq("status", "validation_pending").order("start_at").limit(500),
    client.from("draft_slices").select("id,start_at,timezone").eq("status", "drafted").order("start_at").limit(500),
    client.from("canonical_slices").select("id,start_at,end_at,community,activity,status").order("start_at").limit(5000),
    client.from("replay_runs").select("id,status,started_at,completed_at,from_timestamp,failure_message,affected_count,heartbeat_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("validation_events").select("id,role,community,created_at,canonical_slices(activity,start_at,timezone)").eq("decision", "validated").order("created_at", { ascending: false }).limit(20),
  ]);
  const conflicts = findTimelineOverlaps(activeTimeline ?? []);
  const stoppedReplay = replay && (replay.status === "failed" || (replay.status === "running" && isReplayStale(replay))) && replay.from_timestamp ? replay : null;
  const summary = reviewDecisionSummary({
    pending: (pending ?? []) as ReviewDecisionSlice[],
    drafts: (drafts ?? []) as ReviewDecisionDraft[],
    hasConflict: conflicts.length > 0,
    hasRetryBlocker: Boolean(stoppedReplay),
  });
  const messages: Record<string, string> = {
    "no-selection": "No records were selected.",
    "stale-selection": "That review changed in another tab. Nothing was confirmed twice.",
    chronology: "Complete earlier records first so calculations remain chronological.",
    replay: "Your confirmation was recorded. Calculation could not start, but no approval was lost.",
    "timeline-overlap": "Timeline conflicts must be corrected before any affected record can be confirmed.",
  };
  const namedAuthority = authority ? humanRole(authority) : null;
  const availableRecords = summary.availableBatches.reduce((total, batch) => total + batch.items.length, 0);
  const blockedRecords = summary.blockedBatches.reduce((total, batch) => total + batch.items.length, 0);
  const queuedRecords = summary.queuedBatches.reduce((total, batch) => total + batch.items.length, 0);
  const summaryTitle = summary.navCount
    ? `${summary.navCount} ${summary.navCount === 1 ? "decision needs" : "decisions need"} you`
    : conflicts.length
      ? "A timeline correction needs you"
      : "Calculation needs a retry";

  return <>
    {error ? <div className="warning review-message">{messages[error] ?? "The request could not be completed. Your existing confirmation remains unchanged."}</div> : null}
    {corrected ? <div className="success review-message"><strong>Correction recorded.</strong> The replacement now needs its routed community confirmation below.</div> : null}
    {saved ? settlement !== "final"
      ? <div className="warning review-message"><strong>Source review recorded{namedAuthority ? ` under ${namedAuthority}` : ""}.</strong> Complete the separate HouseOfBros impact decision before calculation.</div>
      : <div className="success review-message"><strong>Confirmation recorded{namedAuthority ? ` under ${namedAuthority}` : ""}.</strong> Every required final decision exists, so calculation can update automatically.</div>
      : null}

    {summary.navCount || conflicts.length || stoppedReplay ? <section className="review-decision-summary" aria-labelledby="review-summary-heading">
      <div>
        <p className="meta">Oldest decisions first</p>
        <h2 id="review-summary-heading">{summaryTitle}</h2>
        {summary.approvalBatchCount ? <p>{summary.approvalRecordCount} {summary.approvalRecordCount === 1 ? "activity" : "activities"} across {summary.approvalBatchCount} community {summary.approvalBatchCount === 1 ? "authority" : "authorities"}.</p> : <p>No community confirmation is waiting.</p>}
      </div>
      {summary.oldestEligibleDate ? <dl>
        <div><dt>Oldest date</dt><dd>{readableDate(summary.oldestEligibleDate)}</dd></div>
        <div><dt>{summary.hasConflict ? "Blocked by correction" : "Available now"}</dt><dd>{summary.hasConflict ? summary.blockedBatches.length : summary.availableBatches.length} decision{(summary.hasConflict ? summary.blockedBatches.length : summary.availableBatches.length) === 1 ? "" : "s"} · {summary.hasConflict ? blockedRecords : availableRecords} logs</dd></div>
        <div><dt>Queued later</dt><dd>{summary.queuedBatches.length} decision{summary.queuedBatches.length === 1 ? "" : "s"} · {queuedRecords} logs</dd></div>
      </dl> : null}
    </section> : null}

    <TimelineConflictCard conflicts={conflicts} />
    {stoppedReplay ? <ReplayStatus initial={stoppedReplay} /> : null}

    {summary.legacyDecisionCount ? <section className="review-work-section exceptional-work">
      <div className="review-section-heading"><p className="meta">Legacy exception</p><h2>Keep or reject earlier drafts</h2><p>These one-time decisions remain auditable.</p></div>
      <DraftReview />
    </section> : null}

    {summary.availableBatches.length ? <section className="review-authority-queue" aria-labelledby="available-heading">
      <div className="review-section-heading"><p className="meta">Available now</p><h2 id="available-heading">{readableDate(summary.oldestEligibleDate!)}</h2><p>Each confirmation is made under one community-validator authority.</p></div>
      <p className="review-pilot-note"><strong>Pilot disclosure:</strong> Moses currently acts in the listed roles; these confirmations are not independent external review.</p>
      <div className="grid review-authority-groups">{summary.availableBatches.map((batch) => <form action={validateBatch} className="card stack review-community-group" key={batch.key}>
        <input type="hidden" name="return_date" value={batch.date} />
        <div className="review-authority-heading"><div><p className="meta">Confirming as</p><h2>{communityLabel(batch.community)}</h2><p>{humanRole(batch.role)}</p></div><span>{batch.items.length} {batch.items.length === 1 ? "activity" : "activities"}</span></div>
        {batch.items.some((slice) => slice.slice_type === "performance") ? <p className="performance-impact-note">No transition records no wellbeing movement; Performance valuation remains separate.</p> : null}
        <div className="review-community-rows">{batch.items.map((slice) => {
          const row = slice as ReviewDecisionSlice & { activity: string; proof: string | null; slice_type: string; sao_lane: string | null; skill_level: string | null; impact_direction: string | null; founder_performance_impact: string | null; founder_performance_impact_status: string | null };
          return <article className="review-community-row" key={row.id}>
            <input type="hidden" name="canonical_slice_id" value={row.id} />
            <time>{formatLocalTime(row.start_at, row.timezone)}<span>{formatLocalTime(row.end_at, row.timezone)}</span></time>
            <div><h3>{row.activity}</h3><p>{classification(row)}</p><p><strong>Evidence:</strong> {row.proof || "Self-reported activity evidence."}</p>{row.slice_type === "performance" ? <PerformanceImpactDecision direction={row.impact_direction} id={row.id} intensity={row.founder_performance_impact} status={row.founder_performance_impact_status} /> : null}</div>
            <Link aria-label={`Open ${row.activity}`} href={`/slices/canonical/${row.id}`}>›</Link>
          </article>;
        })}</div>
        <p className="meta">This confirms evidence and classification adequacy under the exact authority named above.{batch.community === "house_of_bros" ? " It does not externally prove subjective inner experience." : ""}</p>
        <SubmitButton idle={`Confirm ${batch.items.length} ${batch.items.length === 1 ? "activity" : "activities"}`} pending="Recording confirmation…" />
      </form>)}</div>
    </section> : null}

    {summary.queuedBatches.length ? <details className="queued-review">
      <summary>{summary.queuedBatches.length} later {summary.queuedBatches.length === 1 ? "decision is" : "decisions are"} queued</summary>
      <div>{summary.queuedBatches.map((batch) => <p key={batch.key}><strong>{readableDate(batch.date)} · {communityLabel(batch.community)}</strong><span>{batch.items.length} {batch.items.length === 1 ? "activity" : "activities"}</span></p>)}</div>
    </details> : null}

    {!summary.navCount && !conflicts.length && !stoppedReplay ? <div className="review-caught-up"><h2>All caught up</h2><p>Nothing needs your decision.</p></div> : null}

    <details className="recent-approvals"><summary>Recent settled approvals</summary><div>{recentValidations?.length ? recentValidations.map((event) => {
      const canonical = Array.isArray(event.canonical_slices) ? event.canonical_slices[0] : event.canonical_slices;
      return <article key={event.id}><div><strong>{canonical?.activity ?? "ValueLog"}</strong><span>{humanRole(event.role)}</span></div><time>{formatLocalDateTime(event.created_at)}</time></article>;
    }) : <p className="meta">No settled approvals yet.</p>}</div></details>
  </>;
}
