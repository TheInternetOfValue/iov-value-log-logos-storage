import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/auth";
import { reelEvidenceEligibility } from "@/lib/cinematic-reel-evidence";
import { requireGptOwner } from "@/lib/gpt-api";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const access = await requireGptOwner(request);
  if ("error" in access) return access.error;
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !datePattern.test(date)) return apiError(422, "invalid_date");
  const [{ data: plans }, { data: campaigns }, { data: reels }] = await Promise.all([
    access.db.from("current_daily_plans").select("id,plan_key,version,plan_date,daily_focus,status,approved_at").eq("owner_id", access.ownerId).eq("plan_date", date).limit(1),
    access.db.from("campaigns").select("id,name,north_star_label,starts_on,ends_on").eq("owner_id", access.ownerId).eq("status", "active").lte("starts_on", date).gte("ends_on", date).limit(1),
    access.db.from("current_cinematic_day_reels").select("id,reel_key,version,reel_date,title,duration_seconds,script_markdown,evidence_cutoff_at,approved_at").eq("owner_id", access.ownerId).eq("reel_date", date).limit(1),
  ]);
  const plan = plans?.[0] ?? null;
  const campaign = campaigns?.[0] ?? null;
  const [{ data: blocks }, { data: metrics }, { data: slices }] = await Promise.all([
    plan ? access.db.from("daily_plan_blocks").select("id,start_at,end_at,timezone,responsible_party,founder_activity,ai_codex_activity,intended_outcome,context,status,display_order").eq("daily_plan_id", plan.id).order("display_order") : Promise.resolve({ data: [] }),
    campaign ? access.db.from("campaign_metrics").select("id,key,label,unit,display_order").eq("campaign_id", campaign.id).eq("owner_id", access.ownerId).eq("is_active", true).order("display_order") : Promise.resolve({ data: [] }),
    access.db.from("current_time_slices").select("id,start_at,end_at,activity,status").gte("start_at", `${date}T00:00:00+05:30`).lte("start_at", `${date}T23:59:59.999+05:30`).order("start_at"),
  ]);
  const metricIds = (metrics ?? []).map((metric) => metric.id);
  const [{ data: targets }, { data: movements }] = await Promise.all([
    metricIds.length ? access.db.from("campaign_metric_targets").select("id,campaign_metric_id,target_value,version,effective_at").eq("owner_id", access.ownerId).in("campaign_metric_id", metricIds).order("version", { ascending: false }) : Promise.resolve({ data: [] }),
    metricIds.length ? access.db.from("campaign_event_metric_movements").select("campaign_metric_id,delta").eq("owner_id", access.ownerId).in("campaign_metric_id", metricIds) : Promise.resolve({ data: [] }),
  ]);
  const latestTarget = new Map<string, unknown>();
  for (const target of targets ?? []) if (!latestTarget.has(target.campaign_metric_id)) latestTarget.set(target.campaign_metric_id, target.target_value);
  const totals = new Map<string, number>();
  for (const movement of movements ?? []) totals.set(movement.campaign_metric_id, (totals.get(movement.campaign_metric_id) ?? 0) + Number(movement.delta));
  return NextResponse.json({
    ok: true,
    requested_date: date,
    plan: plan ? { ...plan, blocks: blocks ?? [] } : null,
    cinematic_day_reel: reels?.[0] ?? null,
    campaign: campaign ? { ...campaign, metrics: (metrics ?? []).map((metric) => ({ ...metric, target_value: latestTarget.get(metric.id) ?? null, total: totals.get(metric.id) ?? 0 })) } : null,
    activities: (slices ?? []).map((slice) => ({
      ...slice,
      ...reelEvidenceEligibility(slice.status),
    })),
  }, { headers: { "cache-control": "no-store" } });
}
