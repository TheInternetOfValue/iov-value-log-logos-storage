import { z } from "zod";
import {
  FOUNDER_CALCULATION_VERSION,
  FOUNDER_POLICY_CONTENT_HASH,
  FOUNDER_POLICY_ID,
  FOUNDER_POLICY_VERSION,
} from "@/lib/founder-wellbeing";
import { fixed12Format, fixed12FromDecimal } from "@/lib/fixed12";

const components = z.object({
  Physiology: z.number().min(100).max(1000), Emotion: z.number().min(100).max(1000),
  Feeling: z.number().min(100).max(1000), Thought: z.number().min(100).max(1000),
  Habit: z.number().min(100).max(1000), Performance: z.number().min(100).max(1000),
});
const fixed12 = z.string().regex(/^-?\d+\.\d{12}$/);

const movementWindow = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
}).strict();

const communityRecognition = z.discriminatedUnion("community_code", [
  z.object({
    community_code: z.literal("house_of_bros"),
    community_name: z.literal("HouseOfBros"),
    community_type: z.literal("wellbeing_and_wellbecoming"),
    relationship: z.literal("founder"),
    recognition_status: z.literal("genesis_ratified"),
    validation_mode: z.literal("founder_self_review"),
    external_review_claimed: z.literal(false),
    movement_24h: z.number().nullable(),
    movement_7d: z.number().nullable(),
    movement_unit: z.literal("W"),
    limitations: z.array(z.string().min(1)).min(1),
  }).strict(),
  z.object({
    community_code: z.literal("gfe"),
    community_name: z.literal("Growth Flow Engineering"),
    community_type: z.literal("skill_based"),
    relationship: z.literal("founder"),
    skill_system_id: z.literal("gfe-skill-system"),
    native_level: z.literal("GFE-3.3.3"),
    level_name: z.literal("L3"),
    recognition_status: z.literal("self_ratified"),
    validation_mode: z.literal("founder_self_review"),
    external_review_claimed: z.literal(false),
    routes: z.tuple([z.literal("Learning"), z.literal("Earning"), z.literal("OrgBuilding")]),
    activity_24h_minutes: z.number().nonnegative(),
    activity_7d_minutes: z.number().nonnegative(),
    limitations: z.array(z.string().min(1)).min(1),
  }).strict(),
  z.object({
    community_code: z.literal("iov"),
    community_name: z.literal("IoV Research Foundation"),
    community_type: z.literal("research_and_skill"),
    relationship: z.literal("founder"),
    skill_system_id: z.literal("iov-systems-modeling-founder-v0.1"),
    native_level: z.literal("SM3"),
    level_name: z.literal("Architect"),
    recognition_status: z.literal("founder_attested"),
    validation_mode: z.literal("founder_self_review"),
    external_review_claimed: z.literal(false),
    routes: z.tuple([z.literal("Learning"), z.literal("Earning"), z.literal("OrgBuilding")]),
    activity_24h_minutes: z.number().nonnegative(),
    activity_7d_minutes: z.number().nonnegative(),
    limitations: z.array(z.string().min(1)).min(1),
  }).strict(),
]);

const genesis = z.object({
  status: z.literal("genesis_ratified"),
  baseline_method: z.literal("identity_observation_genesis_v0.1"),
  identity_snapshot_reference: z.string().min(1),
  observation_window: z.object({
    reference: z.string().min(1),
    start_date: z.string().date(),
    end_date: z.string().date(),
    eligible_day_count: z.number().int().min(14),
    activity_count: z.number().int().nonnegative(),
    recorded_minutes: z.number().nonnegative(),
  }).strict(),
  issuer_id: z.string().min(1),
  policy_id: z.string().min(1),
  policy_version: z.string().min(1),
  baseline_epoch_id: z.string().uuid(),
  ratified_at: z.string().datetime(),
  pre_genesis_evidence_replayed: z.literal(false),
  qualification_delta_w: z.literal(0),
}).strict();

export const founderWellbeingProjectionSchema = z.object({
  did: z.string().regex(/^did:iov:member:[0-9a-f-]{36}$/),
  public_profile_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  projection_revision: z.string().uuid(),
  replay_run_id: z.string().uuid(),
  replay_verification_id: z.string().uuid(),
  replay_promotion_id: z.string().uuid(),
  baseline_epoch_id: z.string().uuid(),
  wellbeing_score: z.number().min(100).max(1000),
  delta_24h: z.number().nullable(),
  delta_7d: z.number().nullable(),
  movement_24h_window: movementWindow,
  movement_7d_window: movementWindow,
  movement_calculated_at: z.string().datetime(),
  components,
  rollups: z.object({ PhysicalHealth: z.number(), MentalHealth: z.number(), FinancialHealth: z.number() }),
  performance_values: z.array(z.object({
    source_community: z.enum(["gfe", "iov"]),
    community_rate_amount: fixed12,
    community_rate_unit: z.literal("USD_per_hour"),
    vcom_event_amount: fixed12,
    vcom_event_unit: z.literal("USD"),
    vcperformance_event_amount: fixed12,
    vcperformance_event_unit: z.literal("USD"),
    protocol_finality_status: z.literal("final"),
    payability_status: z.literal("non_payable"),
    finality_authority_version_id: z.string().uuid(),
    finalized_at: z.string().datetime(),
  }).strict()),
  community_recognitions: z.array(communityRecognition).length(3),
  policy_id: z.literal(FOUNDER_POLICY_ID),
  policy_version: z.literal(FOUNDER_POLICY_VERSION),
  policy_content_hash: z.literal(FOUNDER_POLICY_CONTENT_HASH),
  calculation_version: z.literal(FOUNDER_CALCULATION_VERSION),
  genesis: genesis.nullable(),
  validation_mode: z.literal("founder_self_review"),
  source_application: z.literal("iov-value-log"),
  updated_at: z.string().datetime(),
  limitations: z.array(z.string().min(1)).min(1),
}).strict();

export function founderPerformanceProjectionValueFromDatabase(value: {
  source_community: string;
  community_rate_amount: string | number;
  community_rate_unit: string;
  vcom_event_amount: string | number;
  vcom_event_unit: string;
  vcperformance_event_amount: string | number;
  vcperformance_event_unit: string;
  protocol_finality_status: string;
  payability_status: string;
  finality_authority_version_id: string;
  finalized_at: string;
}) {
  return {
    ...value,
    community_rate_amount: fixed12Format(fixed12FromDecimal(value.community_rate_amount)),
    vcom_event_amount: fixed12Format(fixed12FromDecimal(value.vcom_event_amount)),
    vcperformance_event_amount: fixed12Format(fixed12FromDecimal(value.vcperformance_event_amount)),
    finalized_at: new Date(value.finalized_at).toISOString(),
  };
}

export const founderWellbeingLimitations = [
  "Issuer-specific founder identity state under HouseOfBros Founder Policy v0.1.",
  "Not a universal human ranking or a population-level scientific model.",
  "Not a compensation, entitlement, employment, or labour-equity rule.",
  "Six component values remain private unless separately owner-approved in a future contract.",
];
