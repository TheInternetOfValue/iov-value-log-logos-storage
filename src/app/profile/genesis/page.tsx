import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { formatLocalDateTime } from "@/lib/format";
import { pageSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

type Coverage = { component: string; activityCount?: number; activity_count?: number; recordedMinutes?: number; recorded_minutes?: number };
type RouteCoverage = { route: string; activityCount?: number; activity_count?: number; recordedMinutes?: number; recorded_minutes?: number };

export default async function GenesisReviewPage() {
  const { client, user } = await pageSession();
  const [
    { data: status },
    { data: snapshot },
    { data: window },
    { data: dossiers },
    { data: review },
    { data: attestation },
  ] = await Promise.all([
    client.from("current_founder_genesis_status").select("*").eq("owner_id", user.id).maybeSingle(),
    client.from("founder_genesis_identity_snapshots").select("snapshot_key,source_profile_hash,protocol_version,effective_at,node_coverage,created_at").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("founder_genesis_observation_windows").select("window_key,window_start,window_end,calendar_day_count,eligible_day_count,activity_count,recorded_minutes,unknown_or_unlogged_minutes,component_coverage,performance_route_coverage,source_hash,frozen_at").eq("owner_id", user.id).order("frozen_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("founder_genesis_component_evidence").select("id,component,relevant_identity_nodes,current_component_value,observed_activity_count,observed_minutes,performance_route_coverage,suggested_min,suggested_max,suggested_range_rationale,contradiction_status,contradictions,subject_confirmed_value,created_at").eq("owner_id", user.id).order("component"),
    client.from("founder_genesis_baseline_reviews").select("review_key,baseline_method_before,baseline_status_before,baseline_method_after,baseline_status_after,reviewer_validation_mode,decision,component_change_proposed,qualification_delta_w,created_at,effective_at,ratified_at").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("founder_genesis_baseline_attestations").select("attestation_key,issuer_id,policy_id,policy_version,baseline_epoch_id,baseline_method,baseline_status,wellbeing_score,validation_mode,issued_at").eq("owner_id", user.id).order("issued_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (!snapshot || !window || !review) return <section>
    <PageIntro title="Genesis review">Your private Identity, observation and six-component baseline review.</PageIntro>
    <section className="card">
      <p className="meta">Genesis evidence</p>
      <h2>Not yet ready</h2>
      <p>A formed eight-node Wellbeing Identity, at least fourteen eligible observed days, six evidence dossiers and subject confirmation are required before HouseOfBros can issue Genesis.</p>
      <Link className="button secondary" href="/profile">Return to profile</Link>
    </section>
  </section>;

  const nodeCoverage = Array.isArray(snapshot.node_coverage) ? snapshot.node_coverage as string[] : [];
  const componentCoverage = Array.isArray(window.component_coverage) ? window.component_coverage as Coverage[] : [];
  const performanceCoverage = Array.isArray(window.performance_route_coverage) ? window.performance_route_coverage as RouteCoverage[] : [];

  return <section>
    <PageIntro title="Genesis review">The private evidence trail that constitutes the starting point for daily WellbeingScore movement.</PageIntro>
    <section className="card founder-baseline">
      <p className="meta">HouseOfBros Genesis Baseline Policy v0.1</p>
      <p className="stat">{status?.baseline_status === "genesis_ratified" ? "Genesis ratified" : review.baseline_status_after}</p>
      <p>Identity + observed life baseline · {review.baseline_method_after}</p>
      <dl className="definition-list">
        <div><dt>Composite</dt><dd>{attestation ? `${Number(attestation.wellbeing_score).toFixed(2)} / 1000` : "Pending"}</dd></div>
        <div><dt>Issuer</dt><dd>{attestation?.issuer_id ?? "HouseOfBros"}</dd></div>
        <div><dt>Policy</dt><dd>{attestation ? `${attestation.policy_id} · ${attestation.policy_version}` : "Pending"}</dd></div>
        <div><dt>Validation</dt><dd>{review.reviewer_validation_mode}</dd></div>
        <div><dt>Score movement</dt><dd>{Number(review.qualification_delta_w).toFixed(2)} W</dd></div>
        <div><dt>Ratified</dt><dd>{review.ratified_at ? `${formatLocalDateTime(review.ratified_at, "Asia/Kolkata")} IST` : "Pending"}</dd></div>
      </dl>
      <p className="meta">Qualification preserves the original epoch. It is not a Value Log event and creates no artificial score movement.</p>
    </section>

    <div className="grid two profile-grid">
      <section className="card">
        <p className="meta">1 · Wellbeing Identity formation</p>
        <h2>{nodeCoverage.length}/8 nodes addressed</h2>
        <ul>{nodeCoverage.map((node) => <li key={node}>{String(node).replace(/([a-z])([A-Z])/g, "$1 $2")}</li>)}</ul>
        <p className="meta">Snapshot {snapshot.snapshot_key} · protocol {snapshot.protocol_version} · source hash {snapshot.source_profile_hash.slice(0, 16)}…</p>
      </section>

      <section className="card">
        <p className="meta">2 · Observation window</p>
        <h2>{window.eligible_day_count} eligible days</h2>
        <dl className="definition-list">
          <div><dt>Fixed window</dt><dd>{window.window_start} to {window.window_end}</dd></div>
          <div><dt>Calculated activities</dt><dd>{window.activity_count}</dd></div>
          <div><dt>Recorded time</dt><dd>{duration(Number(window.recorded_minutes))}</dd></div>
          <div><dt>Unknown or unlogged</dt><dd>{duration(Number(window.unknown_or_unlogged_minutes))}</dd></div>
        </dl>
        <p className="meta">Recorded presence is evidence coverage, not a wellbeing-quality score.</p>
      </section>
    </div>

    <section className="card">
      <p className="meta">3 · Component coverage</p>
      <h2>Six Wellbecoming components</h2>
      <div className="grid two">
        {componentCoverage.map((row) => <article key={row.component}>
          <h3>{row.component}</h3>
          <p>{row.activityCount ?? row.activity_count ?? 0} activities · {duration(Number(row.recordedMinutes ?? row.recorded_minutes ?? 0))}</p>
        </article>)}
      </div>
      <h3>Performance routes</h3>
      <p>{performanceCoverage.map((row) => `${row.route}: ${row.activityCount ?? row.activity_count ?? 0} activities · ${duration(Number(row.recordedMinutes ?? row.recorded_minutes ?? 0))}`).join(" · ")}</p>
    </section>

    <section className="card">
      <p className="meta">4 · Evidence dossiers and confirmation</p>
      <h2>Reviewed component values</h2>
      <div className="grid two">
        {(dossiers ?? []).map((row) => <article className="genesis-dossier" key={row.id}>
          <p className="meta">{row.component}</p>
          <p className="stat">{Number(row.current_component_value).toFixed(2)}</p>
          <p>{row.observed_activity_count} observed activities · {duration(Number(row.observed_minutes))}</p>
          <p>Identity context: {(Array.isArray(row.relevant_identity_nodes) ? row.relevant_identity_nodes as string[] : []).join(", ")}</p>
          <p>Suggested range: {row.suggested_min == null ? "Not asserted; evidence supports review but not automatic scoring" : `${Number(row.suggested_min).toFixed(2)}–${Number(row.suggested_max).toFixed(2)}`}</p>
          <p>Contradictions: {row.contradiction_status === "none" ? "None found" : row.contradiction_status}</p>
          <p><strong>Subject confirmed:</strong> {row.subject_confirmed_value == null ? "Pending" : Number(row.subject_confirmed_value).toFixed(2)}</p>
        </article>)}
      </div>
    </section>

    <section className="card">
      <p className="meta">Privacy boundary</p>
      <h2>Evidence remains private</h2>
      <p>This surface shows minimized provenance and aggregate coverage. Raw Identity facets, workshop responses, consent contents, activity narratives and Value Log records are not rendered here or sent to Foundation.</p>
      <div className="actions"><Link className="button secondary" href="/profile">Return to profile</Link></div>
    </section>
  </section>;
}

function duration(minutes: number) {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${hours} hr${rest ? ` ${rest} min` : ""}`;
}
