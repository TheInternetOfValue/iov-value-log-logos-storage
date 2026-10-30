import Link from "next/link";
import { IdentityStateReplay } from "@/components/IdentityStateReplay";
import { SetupRequired } from "@/components/SetupRequired";
import { isConfigured } from "@/lib/env";
import { logosDemoEnabled } from "@/lib/logos-demo";
import { buildIdentityReplay, type IdentityReplayCreditEvent, type IdentityReplayWEvent } from "@/lib/identity-replay";
import { pageSession } from "@/lib/page-auth";
import { ownerIdentityProjection } from "@/lib/owner-identity-projection";
import { founderEventsAsReplayRows, scoreBranchForOccurrence, scoreRegimeForDate, type FounderViewEvent } from "@/lib/score-cutover";

export const dynamic = "force-dynamic";
const DISPLAY_TIMEZONE = "Asia/Kolkata";

function todayInIndia() { return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function dateIsValid(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  if (!isConfigured() && !logosDemoEnabled()) return <SetupRequired />;
  const query = await searchParams;
  const date = dateIsValid(query.date) ? query.date! : todayInIndia();
  const start = `${date}T00:00:00+05:30`;
  const end = `${date}T23:59:59.999+05:30`;
  const { client } = await pageSession();
  const { data: founderRun } = await client.from("current_promoted_founder_replay")
    .select("replay_run_id,baseline_effective_at,baseline_wellbeing_score")
    .eq("mode", "founder_v0_1_live").maybeSingle();
  const baseline = founderRun ? {
    effective_at: founderRun.baseline_effective_at,
    wellbeing_score: founderRun.baseline_wellbeing_score,
  } : null;
  const [{ data: wEvents }, { data: wReversals }, { data: creditEvents }, { data: creditReversals }, { data: founderValues }] = await Promise.all([
    client.from("w_transitions").select("id,canonical_slice_id,pre_slice_w,post_slice_w,applied_change,canonical_slices!inner(id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end),
    client.from("w_transitions").select("reversal_of,canonical_slices!inner(end_at),replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end),
    client.from("credit_events").select("id,canonical_slice_id,formula_result,canonical_slices!inner(id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community),replay_runs!inner(status)").eq("event_kind", "calculation").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end),
    client.from("credit_events").select("reversal_of,canonical_slices!inner(end_at),replay_runs!inner(status)").eq("event_kind", "reversal").eq("replay_runs.status", "completed").gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end),
    founderRun ? client.from("founder_wellbeing_value_events")
      .select("id,canonical_slice_id,event_kind,vcperformance_event_amount,w_before,w_after,delta_w,protocol_finality_status,payability_status,canonical_slices!inner(id,start_at,end_at,timezone,activity,wellbeing_node,slice_type,community)")
      .eq("replay_run_id", founderRun.replay_run_id).gte("canonical_slices.end_at", start).lte("canonical_slices.end_at", end) : Promise.resolve({ data: [] }),
  ]);
  const boundary = baseline?.effective_at ?? null;
  const historicalW = boundary ? (wEvents ?? []).filter((event) => {
    const slice = Array.isArray(event.canonical_slices) ? event.canonical_slices[0] : event.canonical_slices;
    return slice && scoreBranchForOccurrence(slice.start_at, boundary) === "historical_pilot";
  }) : (wEvents ?? []);
  const historicalCredits = boundary ? (creditEvents ?? []).filter((event) => {
    const slice = Array.isArray(event.canonical_slices) ? event.canonical_slices[0] : event.canonical_slices;
    return slice && scoreBranchForOccurrence(slice.start_at, boundary) === "historical_pilot";
  }) : (creditEvents ?? []);
  const historicalReplay = buildIdentityReplay({
    date,
    wEvents: historicalW as IdentityReplayWEvent[],
    wReversalIds: (wReversals ?? []).map((row) => row.reversal_of).filter(Boolean) as string[],
    creditEvents: historicalCredits as IdentityReplayCreditEvent[],
    creditReversalIds: (creditReversals ?? []).map((row) => row.reversal_of).filter(Boolean) as string[],
  });
  const founderRows = founderEventsAsReplayRows((founderValues ?? []) as FounderViewEvent[]);
  const canonicalReplay = buildIdentityReplay({ date, wEvents: founderRows.wEvents, creditEvents: founderRows.creditEvents });
  if (baseline && scoreRegimeForDate(date, boundary!) !== "historical_pilot") {
    const orderedFounder = [...((founderValues ?? []) as FounderViewEvent[])].sort((a, b) => {
      const left = Array.isArray(a.canonical_slices) ? a.canonical_slices[0] : a.canonical_slices;
      const right = Array.isArray(b.canonical_slices) ? b.canonical_slices[0] : b.canonical_slices;
      return (left?.end_at ?? "").localeCompare(right?.end_at ?? "");
    });
    let state = Number(orderedFounder[0]?.w_before ?? baseline.wellbeing_score);
    canonicalReplay.opening_w = state;
    for (const event of canonicalReplay.transitions) {
      if (event.post_w !== null) state = event.post_w;
      event.resulting_w = state;
    }
    canonicalReplay.closing_w = state;
    canonicalReplay.net_w = state - canonicalReplay.opening_w;
    if (!canonicalReplay.transitions.length) return <section className="identity-empty-shell"><Link href={`/day?date=${date}`}>← Canonical day</Link><div><p>HouseOfBros WellbeingScore</p><h1>{Number(baseline.wellbeing_score).toFixed(2)} / 1000</h1><p>Genesis is established. No eligible canonical movement settled on this date.</p><Link className="button" href={`/day?date=${date}`}>Open canonical day</Link></div></section>;
    return <>{scoreRegimeForDate(date, boundary!) === "genesis_day" && historicalReplay.transitions.length ? <section className="genesis-cutover-summary card"><p className="meta">Earlier on 28 July · historical method</p><h2>Historical Pilot W ended here</h2><p>{historicalReplay.opening_w?.toFixed(3)} → {historicalReplay.closing_w?.toFixed(3)} W. These preserved events do not enter the canonical score.</p><div className="genesis-divider"><strong>Genesis constituted</strong><span>{Number(baseline.wellbeing_score).toFixed(2)} / 1000</span></div></section> : null}<IdentityStateReplay replay={canonicalReplay} projection={await ownerIdentityProjection()} regime="canonical_founder" /></>;
  }
  if (!historicalReplay.transitions.length) return <section className="identity-empty-shell"><Link href={`/day?date=${date}`}>← Canonical day</Link><div><p>Historical Pilot W</p><h1>No completed replay data</h1><p>This pre-Genesis day has no completed historical movement or contribution to replay. Its activity record remains available.</p><Link className="button" href={`/day?date=${date}`}>Open canonical day</Link></div></section>;
  return <IdentityStateReplay replay={historicalReplay} projection={await ownerIdentityProjection()} regime="historical_pilot" />;
}
