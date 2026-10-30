import { z } from "zod";
import { localDateFor } from "@/lib/format";

const isoWithZone = z.string().datetime({ offset: true });
const approvalSchema = z.object({
  confirmed: z.literal(true),
  confirmation_text: z.string().trim().min(1).max(500),
}).strict();

const planStatusSchema = z.enum(["planned", "changed", "cancelled"]);
const responsiblePartySchema = z.enum(["founder", "ai_codex", "shared"]);

export const dailyPlanBlockSchema = z.object({
  start_at: isoWithZone,
  end_at: isoWithZone,
  timezone: z.literal("Asia/Kolkata"),
  responsible_party: responsiblePartySchema.default("founder"),
  founder_activity: z.string().trim().min(1).max(500),
  ai_codex_activity: z.string().trim().max(500).optional(),
  intended_outcome: z.string().trim().max(500).optional(),
  context: z.string().trim().max(160).optional(),
  status: planStatusSchema.default("planned"),
}).superRefine((block, ctx) => {
  if (new Date(block.end_at) <= new Date(block.start_at)) ctx.addIssue({ code: "custom", path: ["end_at"], message: "end_at must follow start_at" });
});

export const dailyPlanInputSchema = z.object({
  idempotency_key: z.string().trim().min(12).max(200),
  plan_date: z.string().date(),
  expected_plan_id: z.string().uuid().nullable().optional(),
  daily_focus: z.string().trim().max(240).optional(),
  status: planStatusSchema.default("planned"),
  blocks: z.array(dailyPlanBlockSchema).min(1).max(48),
  approval: approvalSchema,
}).strict().superRefine((plan, ctx) => {
  const sorted = [...plan.blocks].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  for (let index = 1; index < sorted.length; index += 1) {
    if (new Date(sorted[index - 1].end_at) > new Date(sorted[index].start_at)) ctx.addIssue({ code: "custom", path: ["blocks"], message: "planned blocks must not overlap" });
  }
  for (const [index, block] of plan.blocks.entries()) {
    if (block.start_at.slice(0, 10) !== plan.plan_date || block.end_at.slice(0, 10) !== plan.plan_date) ctx.addIssue({ code: "custom", path: ["blocks", index], message: "planned blocks must stay within plan_date" });
  }
});

export const cinematicDayReelInputSchema = z.object({
  idempotency_key: z.string().trim().min(12).max(200),
  reel_date: z.string().date(),
  evidence_cutoff_at: isoWithZone.optional(),
  expected_reel_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  duration_seconds: z.coerce.number().int().min(20).max(90),
  script_markdown: z.string().trim().min(1).max(12000),
  approval: approvalSchema,
}).strict();

export function cinematicReelTemporalError(
  reel: Pick<z.infer<typeof cinematicDayReelInputSchema>, "reel_date" | "evidence_cutoff_at">,
  now = new Date(),
) {
  const today = localDateFor(now.toISOString());
  if (reel.reel_date > today) return "future_reel_date";
  if (reel.reel_date === today && !reel.evidence_cutoff_at) return "evidence_cutoff_required";
  if (!reel.evidence_cutoff_at) return null;
  if (localDateFor(reel.evidence_cutoff_at) !== reel.reel_date) return "evidence_cutoff_date_mismatch";
  if (new Date(reel.evidence_cutoff_at).getTime() > now.getTime()) return "evidence_cutoff_in_future";
  return null;
}

export function dailyPlanTemporalError(
  plan: Pick<z.infer<typeof dailyPlanInputSchema>, "plan_date" | "status" | "blocks">,
  now = new Date(),
) {
  if (plan.status === "cancelled") return null;
  const today = localDateFor(now.toISOString());
  if (plan.plan_date < today) return "past_plan_date";
  if (plan.plan_date === today && plan.blocks.some((block) => new Date(block.start_at).getTime() <= now.getTime())) return "plan_must_start_in_future";
  return null;
}

const eventKindSchema = z.enum(["recorded", "refund", "correction"]);
export const campaignEventInputSchema = z.object({
  idempotency_key: z.string().trim().min(12).max(200),
  campaign_id: z.string().uuid(),
  occurred_at: isoWithZone,
  summary: z.string().trim().min(1).max(500),
  evidence_reference: z.string().trim().max(1000).optional(),
  canonical_slice_id: z.string().uuid().optional(),
  event_kind: eventKindSchema.default("recorded"),
  reverses_event_id: z.string().uuid().optional(),
  movements: z.array(z.object({ campaign_metric_id: z.string().uuid(), delta: z.coerce.number().finite().refine((value) => value !== 0, "delta must not be zero") }).strict()).min(1).max(12),
  approval: approvalSchema,
}).strict().superRefine((event, ctx) => {
  if (event.event_kind === "correction" && !event.reverses_event_id) ctx.addIssue({ code: "custom", path: ["reverses_event_id"], message: "a correction must name the event it corrects" });
});

export type DailyPlanInput = z.infer<typeof dailyPlanInputSchema>;
export type CinematicDayReelInput = z.infer<typeof cinematicDayReelInputSchema>;
export type CampaignEventInput = z.infer<typeof campaignEventInputSchema>;
