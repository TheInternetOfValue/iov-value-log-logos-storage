"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { cohortSnapshot } from "@/lib/cohort/storage";
import "./cohort.css";
import { CohortMemberships } from "./CohortMemberships";
import { CohortExport } from "./CohortExport";
import { isDatedPolicy, DATED_QA_POLICY } from "@/lib/field-station/ids";
type Snapshot = NonNullable<Awaited<ReturnType<typeof cohortSnapshot>>>;
export function CohortDashboard(props: Parameters<typeof CohortDashboardSnapshot>[0]) {
  const state = props.initial.enrollment;
  return <CohortDashboardSnapshot key={`${state.owner_id}:${state.revision}:${state.calculated_revision}:${state.current_replay_id ?? "initial"}`} {...props} />;
}

function CohortDashboardSnapshot({
  initial,
  binding,
  view = "summary",
  day,
}: {
  initial: Snapshot;
  binding: string;
  view?: "summary" | "review" | "profile";
  day?: string;
}) {
  const [data, setData] = useState(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const headers = {
    "content-type": "application/json",
    "x-value-log-session": binding,
  };
  async function action(input: unknown, path = "/api/cohort/review") {
    setBusy(true);
    try {
      const r = await fetch(path, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      const fresh = await fetch("/api/cohort", {
        cache: "no-store",
        headers: { "x-value-log-session": binding },
      });
      const body = await fresh.json();
      if (!fresh.ok || !body.cohort)
        throw new Error("Your saved view could not refresh. Try again.");
      setData(body.cohort);
      setMessage("Saved.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function correct(recordId: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/cohort/correct", {
          method: "POST",
          headers,
          body: JSON.stringify({ recordId }),
        }),
        body = await r.json();
      if (!r.ok) throw new Error(body.error);
      location.assign(body.path);
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  }
  const unresolved = data.records.some(
    (r) => !["reviewed", "superseded"].includes(r.review_status),
  );
  const needsReply = data.records.some(
    (r) => r.review_status === "clarification",
  );
  const needsMoses = data.records.some((r) => r.review_status === "escalated");
  const calculating =
    data.processing.calculationEnabled &&
    !unresolved &&
    data.enrollment.calculated_revision !== data.enrollment.revision;
  const waiting =
    data.records.some((r) => r.review_status === "pending") || calculating;
  useEffect(() => {
    if (!waiting || !data.enrollment.active) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void fetch("/api/cohort/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-value-log-session": binding,
        },
        body: JSON.stringify({ action: "process" }),
        signal: controller.signal,
      })
        .then(() =>
          fetch("/api/cohort", {
            headers: { "x-value-log-session": binding },
            cache: "no-store",
            signal: controller.signal,
          }),
        )
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (body?.cohort) setData(body.cohort);
        })
        .catch(() => {});
    }, 20000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [waiting, binding, data.enrollment.active]);
  const state = data.state;
  const nonPerformanceOnly = isDatedPolicy(data.enrollment.policy_id);
  const dateFor = (instant: number) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: data.enrollment.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instant));
  const visibleRecords = data.records.filter(
    (r) =>
      r.review_status !== "superseded" &&
      (!day ||
        (dateFor(Date.parse(r.start_at)) <= day &&
          dateFor(Date.parse(r.end_at) - 1) >= day)),
  );
  const replyCount = visibleRecords.filter((r) => r.review_status === "clarification").length;
  const pendingCount = visibleRecords.filter((r) => r.review_status === "pending" || r.review_status === "escalated").length;
  const reviewedCount = visibleRecords.filter((r) => r.review_status === "reviewed").length;
  return (
    <section className={`cohort-panel cohort-view-${view}`} aria-label="My Field Station wellbeing">
      {view === "review" ? <div className="review-at-glance" aria-label="Activity review summary">
        <div><strong>{replyCount}</strong><span>Need your reply</span></div>
        <div><strong>{pendingCount}</strong><span>In review</span></div>
        <div><strong>{reviewedCount}</strong><span>Reviewed</span></div>
      </div> : null}
      <div className="cohort-score-heading">
        <div>
          <p className="meta">
            {data.enrollment.policy_id === DATED_QA_POLICY ? "Test policy · fictional logs · " : "Field Station · "}{" "}
            {data.communities.find((c) => c.id === data.enrollment.house_id)
              ?.name ?? "Wellbecoming"}
          </p>
          <h2>
            Wellbeing score <span>· provisional</span>
          </h2>
        </div>
        <strong className="cohort-score">
          {state.score.toFixed(3)}
          <small>/ 1000</small>
        </strong>
      </div>
      {view === "profile" ? <p>
        Your latest calculated state starts from six assumed values of 700.
        Reviewed observations move this experimental score.{" "}
        <Link href="/profile">See the starting assumptions</Link>.
      </p> : null}
      {unresolved ? (
        <p role="status">
          {needsReply
            ? "Some records need your reply to the questions in Insights."
            : needsMoses
              ? "Some records are waiting for Moses to review."
              : !data.processing.reviewEnabled
                ? "Automated review is temporarily paused."
                : !data.processing.operatorReady
                  ? "Review is waiting for the pilot reviewer to be ready."
                  : "Review is pending."}{" "}
          Your last calculated score stays visible.
          {!needsReply && !needsMoses
            ? " Processing resumes here when capacity is available."
            : ""}
        </p>
      ) : null}
      {!data.enrollment.active ? (
        <p role="status">
          Further review and calculation are paused. Your saved records remain
          available.
        </p>
      ) : null}
      {view === "profile" ? <dl className="cohort-components">
        {Object.entries(state.state).map(([node, value]) => (
          <div key={node} className={`tone-${node.toLowerCase()}`}>
            <dt>{node}</dt>
            <dd>{Number(value).toFixed(3)}</dd>
          </div>
        ))}
      </dl> : null}
      {view === "summary" ? (
        <p>
          <Link href="/review">Follow my logs in Insights →</Link>
        </p>
      ) : view === "review" ? (
        <>
          <h3>Your activities</h3>
          <p className="review-list-intro">Open an activity to correct it or ask about a decision.</p>
          {!visibleRecords.length ? (
            <p>
              {day ? "No reviewed activities for this day." : "Nothing confirmed yet."}{" "}
              <Link href="/day#voice">Tell your day</Link> when you are ready.
            </p>
          ) : null}
          <ol className="cohort-records">
            {visibleRecords.map((r) => {
              const event = state.events.find((e) => e.recordId === r.id),
                review = data.reviews.findLast((e) => e.record_id === r.id);
              return (
                <li key={r.id} id={`record-${r.id}`}>
                  <p className="meta">
                    {new Date(r.start_at).toLocaleString(undefined, {
                      timeZone: data.enrollment.timezone,
                    })}{" "}
                    · {r.activity.node}
                  </p>
                  <h3>{r.activity.activity}</h3>
                  <p className="cohort-status">
                    {r.review_status === "reviewed"
                      ? event
                        ? "Calculated"
                        : !data.processing.calculationEnabled
                          ? "Reviewed · calculation temporarily paused"
                          : unresolved
                            ? "Reviewed · waiting for earlier records"
                            : "Reviewed · awaiting calculation"
                      : r.review_status === "pending"
                        ? "Waiting for review"
                        : r.review_status === "clarification"
                          ? "Needs your reply"
                          : "Waiting for Moses"}
                  </p>
                  {review ? (
                    <p>
                      {review.content.rationale}
                      {review.content.question
                        ? ` ${review.content.question}`
                        : ""}
                      <small className="meta">
                        {" "}
                        ·{" "}
                        {review.actor_id.startsWith("system:")
                          ? "Automated policy review"
                          : "Participant or human review"}
                      </small>
                    </p>
                  ) : null}
                  {event ? (
                    <p>
                      {r.review_status !== "reviewed"
                        ? "Previously calculated movement (under review)"
                        : "Score movement"}{" "}
                      {event.delta > 0 ? "+" : ""}
                      {event.delta.toFixed(3)} ·{" "}
                      {event.performanceValue !== null
                        ? `${event.currency} ${Number(event.performanceValue).toFixed(2)} Performance value · non-payable`
                        : event.valuationReason === "salary_rate_unavailable"
                          ? "Valuation unavailable: no applicable salary rate"
                          : "No monetary valuation for this activity"}
                    </p>
                  ) : null}
                  <details>
                    <summary>Correct or appeal this record</summary>
                    <p>
                      The saved decision remains in history; changed facts
                      require your fresh approval.
                    </p>
                    <button
                      className="secondary"
                      disabled={busy || !data.enrollment.active}
                      onClick={() => void correct(r.id)}
                    >
                      Prepare a corrected version
                    </button>
                    <p>Or explain a disputed decision for Moses to review.</p>
                    <form
                      data-inline-feedback="true"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const text = new FormData(e.currentTarget).get(
                          "reason",
                        );
                        if (typeof text === "string")
                          void action({
                            action: "appeal",
                            recordId: r.id,
                            reason: text,
                          });
                      }}
                    >
                      <label>
                        Your explanation
                        <textarea name="reason" required maxLength={2000} />
                      </label>
                      <button
                        className="secondary"
                        disabled={busy || !data.enrollment.active}
                      >
                        Send to Moses
                      </button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {view === "profile" ? (
        <>
          <details>
            <summary>Starting assumptions and calculation policy</summary>
            <p>
              Each of the six components began at an assumed 700. This
              experimental baseline is not a completed assessment or ratified
              Genesis. HouseOfSis and HouseOfBros use identical mathematics;
              salary never changes wellbeing.
            </p>
            <p>
              Starting boundary:{" "}
              {new Date(data.enrollment.boundary_at).toLocaleString(undefined, {
                timeZone: data.enrollment.timezone,
              })}{" "}
              ({data.enrollment.timezone}). Pilot chronology keeps this timezone
              even if you later change the timezone for private notes.
            </p>
            <p>
              Accepted review permissions:{" "}
              {new Date(data.enrollment.consent_at).toLocaleString(undefined, {
                timeZone: data.enrollment.timezone,
              })}
              . Calculation policy: {data.enrollment.policy_id}. Missing time
              stays unknown and creates no penalty.
            </p>
          </details>
          {!nonPerformanceOnly ? <details>
            <summary>My salary-based rate</summary>
            {data.rateVersions.length ? (
              <ul>
                {data.rateVersions.map((r, index) => (
                  <li key={r.id} id={`record-${r.id}`}>
                    {index === 0 ? "Latest" : "Earlier"}: {r.salary.currency}{" "}
                    {r.salary.annualGross} annual gross → {r.rate.currency}{" "}
                    {Number(r.rate.hourly).toFixed(2)}/hour · effective{" "}
                    {new Date(r.effectiveAt).toLocaleString(undefined, {
                      timeZone: data.enrollment.timezone,
                    })}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No salary supplied. Wellbeing movement remains available;
                Performance valuation is unavailable.
              </p>
            )}
            <p>
              Your private rate is gross annual cash salary ÷ 2,080. A change
              applies prospectively; previous reviewed events retain their rate
              version. This does not award a skill level or change wellbeing.
            </p>
            <form
              data-inline-feedback="true"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  {
                    action: "rate",
                    salary: {
                      annualGross: f.get("annualGross"),
                      currency: f.get("currency"),
                    },
                  },
                  "/api/cohort",
                );
              }}
            >
              <label>
                Gross annual cash salary
                <input
                  name="annualGross"
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,2})?"
                />
              </label>
              <label>
                Currency
                <input
                  name="currency"
                  defaultValue="INR"
                  required
                  pattern="[A-Z]{3}"
                  maxLength={3}
                />
              </label>
              <button disabled={busy}>Save a new rate version</button>
            </form>
          </details> : <p>Work remains private and unassessed. The Performance component stays at its assumed 700; this policy does not collect salary or calculate monetary value.</p>}
          <details>
            <summary>Pilot permissions and data</summary>
            <p>
              Review uses your approved records as participant-reported
              evidence. It does not claim independent witnessing, employer
              approval or a skill credential. Salary-based valuation never
              changes your starting wellbeing score.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action(
                  { action: "consent", consent: !data.enrollment.active },
                  "/api/cohort",
                )
              }
            >
              {data.enrollment.active
                ? "Pause further review"
                : "Resume review"}
            </button>
            <CohortExport binding={binding} />
          </details>
          <details>
            <summary>Community membership</summary>
            <ul>
              {data.communities.map((c) => (
                <li key={c.id}>
                  {c.name}{" "}
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        { action: "leave_membership", community: c.id },
                        "/api/cohort",
                      )
                    }
                  >
                    {c.kind === "wellbecoming"
                      ? "Leave community and pause pilot"
                      : "Leave community"}
                  </button>
                </li>
              ))}
            </ul>
            <p>
              Leaving a community keeps existing records. Leaving your
              Wellbecoming community pauses the pilot and needs a new invitation
              to rejoin.
            </p>
            <CohortMemberships binding={binding} />
          </details>
        </>
      ) : null}
      <p role="status">{message}</p>
    </section>
  );
}
