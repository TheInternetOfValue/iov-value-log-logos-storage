import { z } from "zod";

export const PARSER_SCHEMA_VERSION = "gpt-draft-v1" as const;
export const W_CALCULATOR_VERSION = "wim-legacy-v1" as const;
export const CREDIT_CALCULATOR_VERSION = "performance-credit-v1" as const;

export const wellbeingNodeSchema = z.enum([
  "Physiology", "Emotion", "Feeling", "Thought", "Habit", "Performance",
]);
export const sliceTypeSchema = z.enum(["non_performance", "performance"]);
export const communitySchema = z.enum(["house_of_bros", "iov", "gfe"]);
export const saoLaneSchema = z.enum(["Learning", "Earning", "OrgBuilding"]);
export const skillLevelSchema = z.enum(["L0", "L1", "L2", "L3", "L4"]);
export const validationRoleSchema = z.enum([
  "house_of_bros_validator", "iov_validator", "gfe_validator",
]);
export const lifecycleStatusSchema = z.enum([
  "drafted", "observer_approved", "observer_rejected", "validation_pending",
  "validated", "validation_rejected", "calculated", "reversed", "superseded",
]);
export const impactDirectionSchema = z.enum(["positive", "neutral", "negative"]);
export const impactIntensitySchema = z.enum(["low", "medium", "high"]);
export const confidenceSchema = z.enum(["observed", "inferred", "uncertain"]);

const isoWithZone = z.string().datetime({ offset: true });
const optionalText = z.string().trim().max(2_000).optional();

export const draftSliceInputSchema = z.object({
  start_at: isoWithZone,
  end_at: isoWithZone,
  timezone: z.string().trim().min(1).max(80),
  activity: z.string().trim().min(1).max(500),
  proof: optionalText,
  wellbeing_node: wellbeingNodeSchema,
  slice_type: sliceTypeSchema,
  community: communitySchema,
  sao_lane: saoLaneSchema.optional(),
  skill_level: skillLevelSchema.optional(),
  impact_direction: impactDirectionSchema.optional(),
  impact_intensity: impactIntensitySchema.optional(),
  confidence: confidenceSchema.optional(),
  activity_occurrence_id: z.string().trim().min(1).max(200).optional(),
  source_attestation_id: z.string().trim().min(1).max(200).optional(),
  founder_task_id: z.string().trim().min(1).max(200).optional(),
  native_skill_level: z.string().trim().min(1).max(80).optional(),
  founder_performance_impact: impactIntensitySchema.optional(),
  founder_vcom_rate: z.number().nonnegative().optional(),
  founder_vcom_unit: z.string().trim().min(1).max(40).optional(),
  founder_validation_mode: z.enum(["founder_self_review", "independent_review"]).optional(),
}).superRefine((slice, ctx) => {
  if (new Date(slice.end_at) <= new Date(slice.start_at)) {
    ctx.addIssue({ code: "custom", path: ["end_at"], message: "end_at must follow start_at" });
  }
  if (slice.slice_type === "performance") {
    if (slice.wellbeing_node !== "Performance") {
      ctx.addIssue({ code: "custom", path: ["wellbeing_node"], message: "Performance slices require Performance node" });
    }
    if (slice.community === "house_of_bros") {
      ctx.addIssue({ code: "custom", path: ["community"], message: "Performance routes to IoV or GFE" });
    }
    if (!slice.sao_lane || (!slice.skill_level && !slice.native_skill_level)) {
      ctx.addIssue({ code: "custom", path: ["sao_lane"], message: "Performance requires SAO lane and skill level" });
    }
  } else {
    if (slice.wellbeing_node === "Performance" || slice.community !== "house_of_bros") {
      ctx.addIssue({ code: "custom", path: ["community"], message: "Non-performance routes to HouseOfBros" });
    }
    if (!slice.impact_direction || !slice.impact_intensity || !slice.confidence) {
      ctx.addIssue({ code: "custom", path: ["impact_direction"], message: "Non-performance requires impact fields" });
    }
  }
});

export const ingestionSchema = z.object({
  idempotency_key: z.string().trim().min(12).max(200),
  source_timestamp: isoWithZone.optional(),
  parser_version: z.string().trim().min(1).max(80).default(PARSER_SCHEMA_VERSION),
  timezone: z.string().trim().min(1).max(80),
  raw_narrative: z.string().min(1).max(50_000),
  slices: z.array(draftSliceInputSchema).min(1).max(100),
  observer_confirmation: z.object({
    confirmed: z.literal(true),
    channel: z.literal("private_custom_gpt"),
    confirmation_text: z.string().trim().min(1).max(500),
  }),
}).strict();

export type DraftSliceInput = z.infer<typeof draftSliceInputSchema>;
export type IngestionInput = z.infer<typeof ingestionSchema>;
export type WellbeingNode = z.infer<typeof wellbeingNodeSchema>;
export type Community = z.infer<typeof communitySchema>;
export type ValidationRole = z.infer<typeof validationRoleSchema>;

export function completedActivityTemporalError(
  slices: Array<Pick<DraftSliceInput, "end_at">>,
  now = new Date(),
) {
  return slices.some((slice) => new Date(slice.end_at).getTime() > now.getTime())
    ? "activity_not_completed"
    : null;
}

export function expectedValidationRole(node: WellbeingNode, community: Community): ValidationRole {
  if (node !== "Performance") return "house_of_bros_validator";
  return community === "gfe" ? "gfe_validator" : "iov_validator";
}
