import Link from "next/link";
import { initializeFounderWellbeingState, publishPublicProfileProjection, saveFounderBootstrapBaseline, signOut } from "@/app/actions";
import { PageIntro } from "@/components/PageIntro";
import { SubmitButton } from "@/components/SubmitButton";
import { PrivateIdentityProfile } from "@/components/PrivateIdentityProfile";
import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { memberWritingOpen } from "@/lib/members/admission";
import { MemberProfile } from "@/components/members/MemberProfile";
import { redirect } from "next/navigation";
import {
  MOSES_CANONICAL_DID,
  publicIdentityUrl,
  wellbeingIdentityHomeUrl,
} from "@/lib/identity";
import {
  aggregateCommunityValue,
  communityCatalog,
  type ActiveCreditEvent,
  type ActiveWEvent,
} from "@/lib/community-value";
import { formatLocalDateTime } from "@/lib/format";
import { ownerIdentityProjection } from "@/lib/owner-identity-projection";
import { founderWellbeingMode } from "@/lib/founder-mode";
import { cohortSnapshot } from "@/lib/cohort/server";
import { CohortDashboard } from "@/components/cohort/CohortDashboard";
import { scoreBranchForOccurrence } from "@/lib/score-cutover";

export const dynamic = "force-dynamic";

function activeRows<T extends { id: string }>(calculations: T[], reversals: Array<{ reversal_of: string | null }>) {
  const reversed = new Set(reversals.map((row) => row.reversal_of).filter(Boolean));
  return calculations.filter((row) => !reversed.has(row.id));
}

type PublicationAudit = {
  event_type: string;
  created_at: string;
  metadata: { status?: number; trigger?: "manual" | "scheduled" } | null;
};

function nextScheduledSync() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(18, 45, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return formatLocalDateTime(next.toISOString(), "Asia/Kolkata");
}

function publicationEventLabel(eventType: string) {
  return `Canonical founder projection ${eventType.endsWith("_failed") ? "failed" : "published"}`;
}


export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ sync?: string; baseline?: string; founder?: string }>;
}) {
  const query = await searchParams;
  const session = await memberPageSession();
  if (session.kind === "personal") {
    if (!session.onboarded) redirect("/onboarding");
    const cohort = await cohortSnapshot(session.user.id);
    return (
      <>
        <MemberProfile
          name={session.name}
          timezone={session.timezone}
          binding={memberWriteBinding(session.user.id)}
          writing={memberWritingOpen()}
          assessed={Boolean(cohort)}
        >
        {cohort ? (
          <CohortDashboard
            initial={cohort}
            binding={memberWriteBinding(session.user.id)}
            view="profile"
          />
        ) : null}
        </MemberProfile>
      </>
    );
  }
  const { client, user } = session;
  const [
    { data: member },
    { data: binding },
    { data: transitions },
    { data: wReversals },
    { data: credits },
    { data: creditReversals },
    { data: rates },
    { data: publicationAudits },
    { data: pilotMetrics },
    { data: learningAudits },
    { data: replayRuns },
  ] = await Promise.all([
    client.from("members").select("display_name,timezone").eq("id", user.id).single(),
    client.from("member_identity_bindings").select("did,authority,bound_at").eq("owner_id", user.id).maybeSingle(),
    client.from("w_transitions").select("id,post_slice_w,applied_change,input_hash,created_at,canonical_slices!inner(community,start_at,end_at),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").order("created_at").limit(2000),
    client.from("w_transitions").select("reversal_of,replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").limit(2000),
    client.from("credit_events").select("id,formula_result,input_hash,created_at,canonical_slices!inner(community,start_at,end_at),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").order("created_at").limit(2000),
    client.from("credit_events").select("reversal_of,replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").limit(2000),
    client.from("community_rate_versions").select("version").order("effective_from", { ascending: false }).limit(1),
    client.from("audit_events").select("event_type,created_at,metadata")
      .in("event_type", ["founder_wellbeing_projection_published", "founder_wellbeing_projection_failed"])
      .order("created_at", { ascending: false }).limit(20),
    client.from("pilot_metrics").select("metric_date,manual_correction_count,overlap_error_count,rejected_slice_count,submission_seconds,review_seconds").order("metric_date", { ascending: false }).limit(30),
    client.from("audit_events").select("event_type,created_at").in("event_type", ["gpt_intake_created", "canonical_revision_created", "canonical_duplicate_removed", "chronological_replay_completed", "chronological_replay_failed"]).order("created_at", { ascending: false }).limit(200),
    client.from("replay_runs").select("status,started_at,completed_at").order("started_at", { ascending: false }).limit(30),
  ]);
  const ownerProjection = await ownerIdentityProjection();
  const founderMode = founderWellbeingMode();
  const { data: founderState } = founderMode === "legacy"
    ? { data: null }
    : await client.from("current_founder_wellbeing_state")
      .select("replay_run_id,baseline_epoch_id,physiology,emotion,feeling,thought,habit,performance,w_after,effective_at,mode")
      .eq("owner_id", user.id).eq("mode", founderMode).maybeSingle();
  const { data: founderBaseline } = founderState?.baseline_epoch_id
    ? await client.from("founder_wellbeing_baseline_epochs")
      .select("id,epoch_kind,method,physiology,emotion,feeling,thought,habit,performance,wellbeing_score,rollups,effective_at,policy_version")
      .eq("id", founderState.baseline_epoch_id).maybeSingle()
    : { data: null };
  const { data: founderValues } = founderState?.replay_run_id
    ? await client.from("founder_wellbeing_value_events").select("vcperformance_event_amount")
      .eq("replay_run_id", founderState.replay_run_id).eq("event_kind", "performance")
    : { data: [] };
  const valuedFounderPerformance = (founderValues ?? [])
    .filter((event) => event.vcperformance_event_amount !== null)
    .map((event) => Number(event.vcperformance_event_amount));
  const founderPerformanceCredits = valuedFounderPerformance.length
    ? valuedFounderPerformance.reduce((sum, value) => sum + value, 0)
    : null;
  const { data: genesisStatus } = founderMode === "legacy"
    ? { data: null }
    : await client.from("current_founder_genesis_status")
      .select("baseline_status,baseline_method,ratified_at,eligible_day_count")
      .eq("owner_id", user.id).eq("baseline_epoch_id", founderState?.baseline_epoch_id ?? "").maybeSingle();

  const activeW = activeRows(transitions ?? [], wReversals ?? []).filter((event) => {
    if (!founderBaseline) return true;
    const relation = Array.isArray(event.canonical_slices) ? event.canonical_slices[0] : event.canonical_slices;
    return relation && scoreBranchForOccurrence(relation.start_at, founderBaseline.effective_at) === "historical_pilot";
  });
  const activeCredits = activeRows(credits ?? [], creditReversals ?? []).filter((event) => {
    if (!founderBaseline) return true;
    const relation = Array.isArray(event.canonical_slices) ? event.canonical_slices[0] : event.canonical_slices;
    return relation && scoreBranchForOccurrence(relation.start_at, founderBaseline.effective_at) === "historical_pilot";
  });
  const communityAggregates = aggregateCommunityValue(
    activeW as ActiveWEvent[],
    activeCredits as ActiveCreditEvent[],
  );
  const recentPublicationActivity = ((publicationAudits ?? []) as PublicationAudit[]).slice(0, 7);
  const corrections = (learningAudits ?? []).filter((event) => ["canonical_revision_created", "canonical_duplicate_removed"].includes(event.event_type)).length;
  const overlapsCaught = (pilotMetrics ?? []).reduce((sum, metric) => sum + Number(metric.overlap_error_count ?? 0), 0);
  const completedReplays = (replayRuns ?? []).filter((run) => run.status === "completed" && run.completed_at);
  const replayMinutes = completedReplays.map((run) => (new Date(run.completed_at!).getTime() - new Date(run.started_at).getTime()) / 60_000).filter(Number.isFinite);
  const averageReplay = replayMinutes.length ? replayMinutes.reduce((sum, value) => sum + value, 0) / replayMinutes.length : null;
  const reviewSeconds = (pilotMetrics ?? []).map((metric) => Number(metric.review_seconds)).filter(Number.isFinite);
  const averageReviewMinutes = reviewSeconds.length ? reviewSeconds.reduce((sum, value) => sum + value, 0) / reviewSeconds.length / 60 : null;

  return <section>
    <PageIntro title="My Wellbeing Identity">Your private identity portrait, Value Log state, contribution history, and publication controls.</PageIntro>
    {query.sync === "success" ? <div className="success"><strong>Owner projection synchronized.</strong> The live canonical founder state was delivered to Word Wallet; Word Wallet disclosure choices remain authoritative.</div> : null}
    {query.sync === "sharing-off" ? <div className="warning"><strong>Sharing is off.</strong> Enable the relevant live card in My Wellbeing Identity, then complete a fresh Value Log sync.</div> : null}
    {query.sync === "failed" ? <div className="warning"><strong>Synchronization did not complete.</strong> Confirm both publication consents are active, then try again.</div> : null}
    {query.sync === "not-configured" ? <div className="warning"><strong>Synchronization is not configured.</strong> Check the Value Log deployment variables.</div> : null}
    {query.baseline === "saved" ? <div className="success"><strong>Founder baseline saved.</strong> The six reviewed components now begin a new prospective epoch; historical records remain unchanged.</div> : null}
    {query.founder === "completed" ? <div className="success"><strong>Founder WellbeingState activated.</strong> The displayed score now comes from the completed append-only replay branch.</div> : null}
    {founderMode !== "legacy" ? <FounderBaselineCard baseline={founderBaseline} currentState={founderState} genesisStatus={genesisStatus} mode={founderMode} /> : null}
    <PrivateIdentityProfile projection={ownerProjection} currentW={founderState ? Number(founderState.w_after) : null} performanceCredits={founderPerformanceCredits} />
    <div className="grid two profile-grid">
      <section className="card">
        <p className="meta">Identity authority</p>
        <h2>{member?.display_name ?? "Moses"}</h2>
        <dl className="definition-list">
          <div><dt>Canonical DID</dt><dd>{binding?.did ?? MOSES_CANONICAL_DID}</dd></div>
          <div><dt>Authority</dt><dd>{binding?.authority ?? "Word Wallet Web"}</dd></div>
          <div><dt>Timezone</dt><dd>{member?.timezone ?? "Asia/Kolkata"}</dd></div>
        </dl>
        <div className="actions">
          <a className="button secondary" href={publicIdentityUrl()}>View public identity</a>
          <a className="button secondary" href={wellbeingIdentityHomeUrl()}>Manage my Wellbeing Identity</a>
        </div>
      </section>
      <section className="card">
        <p className="meta">Private pilot learning</p>
        <h2>Process quality</h2>
        <dl className="definition-list">
          <div><dt>Recorded intakes</dt><dd>{(learningAudits ?? []).filter((event) => event.event_type === "gpt_intake_created").length}</dd></div>
          <div><dt>Audited corrections</dt><dd>{corrections}</dd></div>
          <div><dt>Overlap catches</dt><dd>{overlapsCaught}</dd></div>
          <div><dt>Replay outcome</dt><dd>{completedReplays.length} complete{averageReplay !== null ? ` · ${averageReplay.toFixed(1)} min average` : ""}</dd></div>
          <div><dt>Time to confirm</dt><dd>{averageReviewMinutes === null ? "Not yet available" : `${averageReviewMinutes.toFixed(1)} min average`}</dd></div>
        </dl>
        <p className="meta">Private, read-only signals from existing audit, replay, and pilot-metric records. No third-party analytics.</p>
      </section>
      <section className="card">
        <p className="meta">Historical pre-Genesis record</p>
        <h2>HouseOfBros Pilot W</h2>
        {(() => {
          const value = communityAggregates.find((item) => item.code === "house_of_bros");
          if (!value || value.kind !== "wellbecoming") return null;
          return <dl className="definition-list">
            <div><dt>Last 30 days</dt><dd>{value.last_30_days.net_w >= 0 ? "+" : ""}{value.last_30_days.net_w.toFixed(3)} W · {Math.round(value.last_30_days.calculated_minutes)} min</dd></div>
            <div><dt>All recorded</dt><dd>{value.lifetime.net_w >= 0 ? "+" : ""}{value.lifetime.net_w.toFixed(3)} W · {Math.round(value.lifetime.calculated_minutes)} min</dd></div>
            <div><dt>Positive / negative</dt><dd>+{value.lifetime.positive_w.toFixed(3)} / {value.lifetime.negative_w.toFixed(3)} W</dd></div>
          </dl>;
        })()}
        <a className="button secondary" href={communityCatalog.house_of_bros.href}>Open community</a>
      </section>
      <section className="card">
        <p className="meta">Historical pre-Genesis record</p>
        <h2>Pilot Performance credits</h2>
        <div className="community-profile-list">
          {communityAggregates.filter((item) => item.kind === "skill_based").map((value) => {
            const catalog = communityCatalog[value.code];
            return <article key={value.code}>
              <h3>{catalog.label}</h3>
              <p className="meta">{catalog.focus}</p>
              <dl className="definition-list">
                <div><dt>Last 30 days</dt><dd>{value.last_30_days.credits.toFixed(2)} credits · {Math.round(value.last_30_days.calculated_minutes)} min</dd></div>
                <div><dt>All recorded</dt><dd>{value.lifetime.credits.toFixed(2)} credits · {Math.round(value.lifetime.calculated_minutes)} min</dd></div>
              </dl>
              <a href={catalog.href}>Open community</a>
            </article>;
          })}
        </div>
        <p className="meta">Rate table: {rates?.[0]?.version ?? "No active rate version"} · credits are non-monetary reference units.</p>
      </section>
      <section className="card">
        <p className="meta">Public profile synchronization</p>
        <h2>Canonical founder projection</h2>
        <p className="meta">Scheduled daily at 00:15 IST · next expected {nextScheduledSync()}.</p>
        {recentPublicationActivity.length ? <section className="sync-history" aria-labelledby="sync-history-heading">
          <h3 id="sync-history-heading">Recent projection activity</h3>
          {recentPublicationActivity.map((event) => <div className={event.event_type.endsWith("_failed") ? "failed" : ""} key={`${event.event_type}-${event.created_at}`}>
            <strong>{publicationEventLabel(event.event_type)}</strong>
            <span>{formatLocalDateTime(event.created_at, "Asia/Kolkata")} IST · {event.metadata?.trigger ?? "unknown trigger"}{event.metadata?.status ? ` · ${event.metadata.status}` : ""}</span>
          </div>)}
        </section> : <p className="meta">No local projection attempts have been recorded yet.</p>}
        <p>Sharing is managed in My Wellbeing Identity. This sends only the latest canonical HouseOfBros founder projection; historical Pilot W remains frozen and is not republished.</p>
        <form action={publishPublicProfileProjection}>
          <SubmitButton
            className="button"
            idle="Sync public profile now"
            pending="Synchronizing canonical founder state…"
          />
        </form>
        <p className="meta">Revocation removes the public projection without deleting private Value Log history.</p>
      </section>
    </div>
    <form action={signOut} className="profile-signout"><button className="secondary">Sign out</button></form>
  </section>;
}

function FounderBaselineCard({ baseline, currentState, genesisStatus, mode }: {
  baseline: null | {
    epoch_kind: string; method: string; physiology: number; emotion: number; feeling: number;
    thought: number; habit: number; performance: number; wellbeing_score: number;
    rollups: { PhysicalHealth?: number; MentalHealth?: number; FinancialHealth?: number };
    effective_at: string; policy_version: string;
  };
  currentState: null | {
    replay_run_id: string;
    physiology: number; emotion: number; feeling: number; thought: number; habit: number;
    performance: number; w_after: number; effective_at: string; mode: string;
  };
  genesisStatus: null | { baseline_status: string; baseline_method: string; ratified_at: string; eligible_day_count: number };
  mode: string;
}) {
  if (baseline) {
    const state = currentState ?? baseline;
    const score = currentState ? currentState.w_after : baseline.wellbeing_score;
    return <section className="card founder-baseline">
    <p className="meta">HouseOfBros WellbeingScore · Founder Policy v0.1</p>
    <p className="stat">{Number(score).toFixed(2)} / 1000</p>
    <p>{currentState ? "Replayed current state" : `${baseline.epoch_kind === "bootstrap" ? "Bootstrap" : "Calibration"} baseline`} · {baseline.method} · {mode === "founder_v0_1_live" ? "Live" : "Preview"}</p>
    {genesisStatus?.baseline_status === "genesis_ratified" ? <p><strong>Genesis ratified</strong> · Identity + {genesisStatus.eligible_day_count} observed days · {genesisStatus.baseline_method}</p> : <p className="meta">Genesis qualification pending.</p>}
    <dl className="definition-list">
      <div><dt>Physiology</dt><dd>{Number(state.physiology).toFixed(2)}</dd></div>
      <div><dt>Emotion</dt><dd>{Number(state.emotion).toFixed(2)}</dd></div>
      <div><dt>Feeling</dt><dd>{Number(state.feeling).toFixed(2)}</dd></div>
      <div><dt>Thought</dt><dd>{Number(state.thought).toFixed(2)}</dd></div>
      <div><dt>Habit</dt><dd>{Number(state.habit).toFixed(2)}</dd></div>
      <div><dt>Performance</dt><dd>{Number(state.performance).toFixed(2)}</dd></div>
    </dl>
    <p className="meta">Effective {formatLocalDateTime(currentState?.effective_at ?? baseline.effective_at, "Asia/Kolkata")} IST. A score of 100 is the lower bound of this measurement scale, not a statement about human worth.</p>
    {!currentState ? <form action={initializeFounderWellbeingState}>
      <SubmitButton className="button" idle="Activate replayed founder state" pending="Building canonical state…" />
    </form> : null}
    {genesisStatus ? <div className="actions"><Link className="button secondary" href="/profile/genesis">Open private Genesis review</Link></div> : null}
  </section>;
  }

  return <section className="card founder-baseline">
    <p className="meta">HouseOfBros WellbeingScore · Founder Policy v0.1</p>
    <h2>Create the six-component bootstrap baseline</h2>
    <p>Review where you are now. Enter every component from 1.0 to 10.0. Saving multiplies each rating by 100 and begins a new prospective founder epoch; it does not reinterpret legacy 843, Pilot W, or normalized history.</p>
    <form action={saveFounderBootstrapBaseline}>
      <div className="grid two">
        {["Physiology", "Emotion", "Feeling", "Thought", "Habit", "Performance"].map((component) => <label key={component}>
          <span>{component}</span>
          <input name={component} type="number" min="1" max="10" step="0.1" required inputMode="decimal" />
        </label>)}
      </div>
      <p className="meta">Validation mode: founder_self_review · Method: bootstrap_baseline_v0.1 · All six are required.</p>
      <SubmitButton className="button" idle="Create bootstrap baseline" pending="Creating baseline…" />
    </form>
  </section>;
}
