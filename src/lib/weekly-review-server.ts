import "server-only";

import { createHash } from "node:crypto";
import { readCampaignMap } from "@/lib/campaign-direction";
import { adminClient } from "@/lib/supabase/admin";
import {
  buildWeeklyReviewEvidence,
  WEEKLY_REVIEW_GENERATOR_VERSION,
  WEEKLY_REVIEW_TIMEZONE,
  weeklyReviewWindows,
  weeklyReviewPacketForGpt,
  type WeeklyCampaignOutcome,
  type WeeklyCreditEvent,
  type WeeklySlice,
  type WeeklyWEvent,
} from "@/lib/weekly-review";

type JoinedSlice = WeeklySlice | WeeklySlice[] | null;
type JoinedRun = { status: string } | Array<{ status: string }> | null;
type WRow = Omit<WeeklyWEvent, "end_at" | "replay_status"> & { canonical_slices: JoinedSlice; replay_runs: JoinedRun };
type CreditRow = Omit<WeeklyCreditEvent, "start_at" | "community" | "sao_lane" | "replay_status"> & { canonical_slices: JoinedSlice; replay_runs: JoinedRun };

function joinedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function configuredOwnerId() {
  const email = (process.env.MOSES_EMAIL_ALLOWLIST ?? "").split(",")[0]?.trim().toLowerCase();
  if (!email) throw new Error("owner_not_configured");
  const db = adminClient();
  const { data, error } = await db.from("members").select("id").ilike("email", email).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("owner_not_initialized");
  return data.id as string;
}

export async function prepareWeeklyReviewPacket(now = new Date(), trigger: "scheduled" | "manual" = "scheduled") {
  const windows = weeklyReviewWindows(now);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: WEEKLY_REVIEW_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  if (today <= windows.week_end) throw new Error("review_window_not_closed");

  const ownerId = await configuredOwnerId();
  const db = adminClient();
  const [{ data: slices, error: slicesError }, { data: wRows, error: wError }, { data: creditRows, error: creditsError }, { data: campaignEvents, error: campaignError }] = await Promise.all([
    db.from("canonical_slices").select("id,protocol_link_id,revision_number,start_at,end_at,timezone,status,activity,proof,wellbeing_node,community,sao_lane,skill_level,impact_direction,impact_intensity,confidence").eq("owner_id", ownerId).order("created_at").limit(5000),
    db.from("w_transitions").select("id,canonical_slice_id,pre_slice_w,post_slice_w,applied_change,cap_limited,event_kind,reversal_of,canonical_slices!inner(end_at),replay_runs!inner(status)").eq("owner_id", ownerId).eq("replay_runs.status", "completed").order("created_at").limit(5000),
    db.from("credit_events").select("id,canonical_slice_id,formula_result,event_kind,reversal_of,canonical_slices!inner(start_at,community,sao_lane),replay_runs!inner(status)").eq("owner_id", ownerId).eq("replay_runs.status", "completed").order("created_at").limit(5000),
    db.from("campaign_events").select("id,occurred_at,summary,event_kind,reverses_event_id").eq("owner_id", ownerId).order("occurred_at").limit(1000),
  ]);
  const queryError = slicesError ?? wError ?? creditsError ?? campaignError;
  if (queryError) throw queryError;

  const eventIds = (campaignEvents ?? []).map((event) => event.id);
  const [{ data: movements, error: movementsError }, { data: metrics, error: metricsError }] = await Promise.all([
    eventIds.length ? db.from("campaign_event_metric_movements").select("campaign_event_id,campaign_metric_id,delta").eq("owner_id", ownerId).in("campaign_event_id", eventIds) : Promise.resolve({ data: [], error: null }),
    db.from("campaign_metrics").select("id,label,unit").eq("owner_id", ownerId),
  ]);
  if (movementsError ?? metricsError) throw movementsError ?? metricsError;

  const metricById = new Map((metrics ?? []).map((metric) => [metric.id, metric]));
  const reversedCampaignIds = new Set((campaignEvents ?? []).map((event) => event.reverses_event_id).filter(Boolean));
  const campaignOutcomes: WeeklyCampaignOutcome[] = (campaignEvents ?? [])
    .filter((event) => !reversedCampaignIds.has(event.id))
    .map((event) => ({
      occurred_at: event.occurred_at,
      summary: event.summary,
      movements: (movements ?? []).filter((movement) => movement.campaign_event_id === event.id).flatMap((movement) => {
        const metric = metricById.get(movement.campaign_metric_id);
        return metric ? [{ label: metric.label, unit: metric.unit, delta: Number(movement.delta) }] : [];
      }),
    }));

  const mappedW: WeeklyWEvent[] = (wRows as unknown as WRow[] ?? []).flatMap((row) => {
    const slice = joinedOne(row.canonical_slices);
    const run = joinedOne(row.replay_runs);
    return slice ? [{ ...row, end_at: slice.end_at, replay_status: run?.status ?? "unknown" }] : [];
  });
  const mappedCredits: WeeklyCreditEvent[] = (creditRows as unknown as CreditRow[] ?? []).flatMap((row) => {
    const slice = joinedOne(row.canonical_slices);
    const run = joinedOne(row.replay_runs);
    return slice ? [{ ...row, start_at: slice.start_at, community: slice.community, sao_lane: slice.sao_lane, replay_status: run?.status ?? "unknown" }] : [];
  });
  const campaignToken = process.env.AUG15_CAMPAIGN_MAP_GITHUB_TOKEN;
  const campaignMap = campaignToken ? await readCampaignMap(campaignToken) : null;
  const evidence = buildWeeklyReviewEvidence({
    slices: (slices ?? []) as WeeklySlice[],
    w_events: mappedW,
    credit_events: mappedCredits,
    campaign_outcomes: campaignOutcomes,
    campaign_map: campaignMap,
  }, windows);
  const sourceHash = stableHash(evidence);

  const { data: existing, error: existingError } = await db.from("weekly_review_packets").select("id,version,prepared_at").eq("owner_id", ownerId).eq("week_start", windows.week_start).eq("source_hash", sourceHash).maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const { error: auditError } = await db.from("audit_events").insert({
      owner_id: ownerId, actor_type: "system", event_type: "weekly_review_packet_prepared", entity_type: "weekly_review_packet", entity_id: existing.id,
      metadata: { week_start: windows.week_start, week_end: windows.week_end, version: existing.version, trigger, unchanged: true },
    });
    if (auditError) throw auditError;
    return { ok: true, packet_id: existing.id, version: existing.version, prepared_at: existing.prepared_at, week_start: windows.week_start, week_end: windows.week_end, unchanged: true };
  }

  const { data: latest, error: latestError } = await db.from("weekly_review_packets").select("version").eq("owner_id", ownerId).eq("week_start", windows.week_start).order("version", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  const { data: inserted, error: insertError } = await db.from("weekly_review_packets").insert({
    owner_id: ownerId,
    week_start: windows.week_start,
    week_end: windows.week_end,
    version: (latest?.version ?? 0) + 1,
    timezone: WEEKLY_REVIEW_TIMEZONE,
    evidence,
    campaign_context: evidence.campaign_context,
    source_hash: sourceHash,
    generator_version: WEEKLY_REVIEW_GENERATOR_VERSION,
  }).select("id,version,prepared_at").single();
  if (insertError) {
    const { data: raced } = await db.from("weekly_review_packets").select("id,version,prepared_at").eq("owner_id", ownerId).eq("week_start", windows.week_start).eq("source_hash", sourceHash).maybeSingle();
    if (!raced) throw insertError;
    const { error: racedAuditError } = await db.from("audit_events").insert({
      owner_id: ownerId, actor_type: "system", event_type: "weekly_review_packet_prepared", entity_type: "weekly_review_packet", entity_id: raced.id,
      metadata: { week_start: windows.week_start, week_end: windows.week_end, version: raced.version, trigger, unchanged: true },
    });
    if (racedAuditError) throw racedAuditError;
    return { ok: true, packet_id: raced.id, version: raced.version, prepared_at: raced.prepared_at, week_start: windows.week_start, week_end: windows.week_end, unchanged: true };
  }
  const { error: auditError } = await db.from("audit_events").insert({
    owner_id: ownerId, actor_type: "system", event_type: "weekly_review_packet_prepared", entity_type: "weekly_review_packet", entity_id: inserted.id,
    metadata: { week_start: windows.week_start, week_end: windows.week_end, version: inserted.version, trigger },
  });
  if (auditError) throw auditError;
  return { ok: true, packet_id: inserted.id, version: inserted.version, prepared_at: inserted.prepared_at, week_start: windows.week_start, week_end: windows.week_end, unchanged: false };
}

export async function recordWeeklyReviewReminder(packetId: string, delivery: "sent" | "failed", trigger: "scheduled" | "manual") {
  const ownerId = await configuredOwnerId();
  const db = adminClient();
  const { data: packet, error } = await db.from("weekly_review_packets").select("id,week_start,week_end").eq("id", packetId).eq("owner_id", ownerId).maybeSingle();
  if (error) throw error;
  if (!packet) throw new Error("packet_not_found");
  const { error: auditError } = await db.from("audit_events").insert({
    owner_id: ownerId, actor_type: "system", event_type: `weekly_review_reminder_${delivery}`, entity_type: "weekly_review_packet", entity_id: packet.id,
    metadata: { week_start: packet.week_start, week_end: packet.week_end, channel: "telegram", trigger },
  });
  if (auditError) throw auditError;
  return { ok: true };
}

export async function latestWeeklyReviewPacket(ownerId: string) {
  const db = adminClient();
  const { data: packet, error } = await db.from("weekly_review_packets")
    .select("id,week_start,week_end,version,timezone,evidence,prepared_at,generator_version")
    .eq("owner_id", ownerId).order("week_start", { ascending: false }).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!packet) return null;
  const { data: review, error: reviewError } = await db.from("current_weekly_reviews").select("id").eq("owner_id", ownerId).eq("packet_id", packet.id).limit(1).maybeSingle();
  if (reviewError) throw reviewError;
  return review ? null : weeklyReviewPacketForGpt(packet);
}
