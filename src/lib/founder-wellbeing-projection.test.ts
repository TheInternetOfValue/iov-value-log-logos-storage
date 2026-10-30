import { describe, expect, it } from "vitest";
import {
  founderPerformanceProjectionValueFromDatabase,
  founderWellbeingProjectionSchema,
} from "./founder-wellbeing-projection";

const projection = {
  did: "did:iov:member:10000000-0000-4000-8000-000000000001",
  public_profile_slug: "moses-sam-paul-johnraj",
  projection_revision: "1b0910db-664a-43c2-a75f-2dd89d00e8eb",
  replay_run_id: "5bd8f818-b29f-4b9e-b70f-97cfb07d9be1",
  replay_verification_id: "1887d318-3ea0-4b12-922d-067c385f35ea",
  replay_promotion_id: "f874ab37-5a6c-40ee-8052-0bbfd17653cf",
  baseline_epoch_id: "b60da984-aff7-4a6a-9ee5-57b69335273e",
  wellbeing_score: 771,
  delta_24h: 0.12,
  delta_7d: 0.82,
  movement_24h_window: { start: "2026-07-27T12:00:00.000Z", end: "2026-07-28T12:00:00.000Z" },
  movement_7d_window: { start: "2026-07-21T12:00:00.000Z", end: "2026-07-28T12:00:00.000Z" },
  movement_calculated_at: "2026-07-28T12:00:00.000Z",
  components: { Physiology: 800, Emotion: 750, Feeling: 700, Thought: 880, Habit: 800, Performance: 700 },
  rollups: { PhysicalHealth: 800, MentalHealth: 802.5, FinancialHealth: 725 },
  performance_values: [],
  community_recognitions: [
    { community_code: "house_of_bros", community_name: "HouseOfBros", community_type: "wellbeing_and_wellbecoming", relationship: "founder", recognition_status: "genesis_ratified", validation_mode: "founder_self_review", external_review_claimed: false, movement_24h: 0.12, movement_7d: 0.82, movement_unit: "W", limitations: ["Issuer-specific founder state."] },
    { community_code: "gfe", community_name: "Growth Flow Engineering", community_type: "skill_based", relationship: "founder", skill_system_id: "gfe-skill-system", native_level: "GFE-3.3.3", level_name: "L3", recognition_status: "self_ratified", validation_mode: "founder_self_review", external_review_claimed: false, routes: ["Learning", "Earning", "OrgBuilding"], activity_24h_minutes: 0, activity_7d_minutes: 120, limitations: ["No external validation claimed."] },
    { community_code: "iov", community_name: "IoV Research Foundation", community_type: "research_and_skill", relationship: "founder", skill_system_id: "iov-systems-modeling-founder-v0.1", native_level: "SM3", level_name: "Architect", recognition_status: "founder_attested", validation_mode: "founder_self_review", external_review_claimed: false, routes: ["Learning", "Earning", "OrgBuilding"], activity_24h_minutes: 60, activity_7d_minutes: 300, limitations: ["Founder-pilot attestation."] },
  ],
  policy_id: "hob-wellbecoming-founder-v0.1",
  policy_version: "0.1.0",
  policy_content_hash: "e1601b1804716f9ab39314340386d6280993c36db7cb85c364d7a2607477f471",
  calculation_version: "founder-wellbeing-v0.1.1-fixed12",
  genesis: {
    status: "genesis_ratified",
    baseline_method: "identity_observation_genesis_v0.1",
    identity_snapshot_reference: "wis-moses-4ff8695f06afe7e4",
    observation_window: {
      reference: "gow-moses-20260629-20260728-bc6669326852",
      start_date: "2026-06-29",
      end_date: "2026-07-28",
      eligible_day_count: 25,
      activity_count: 337,
      recorded_minutes: 25825,
    },
    issuer_id: "house_of_bros",
    policy_id: "hob-wellbeing-identity-genesis-v0.1",
    policy_version: "0.1.0",
    baseline_epoch_id: "b60da984-aff7-4a6a-9ee5-57b69335273e",
    ratified_at: "2026-07-28T12:00:00.000Z",
    pre_genesis_evidence_replayed: false,
    qualification_delta_w: 0,
  },
  validation_mode: "founder_self_review",
  source_application: "iov-value-log",
  updated_at: "2026-07-28T12:00:00.000Z",
  limitations: ["Founder policy only."],
} as const;

describe("founder Genesis private projection", () => {
  it("carries qualification provenance without raw Identity or Value Log evidence", () => {
    expect(founderWellbeingProjectionSchema.parse(projection).genesis?.status).toBe("genesis_ratified");
    const serialized = JSON.stringify(projection.genesis);
    expect(serialized).not.toContain("private_evidence_references");
    expect(serialized).not.toContain("activity_description");
    expect(serialized).not.toContain("component_evidence");
  });

  it("can represent a pre-qualification founder projection as private and pending", () => {
    expect(founderWellbeingProjectionSchema.parse({ ...projection, genesis: null }).genesis).toBeNull();
  });

  it("keeps current movement and community-native recognitions typed and separate", () => {
    const parsed = founderWellbeingProjectionSchema.parse(projection);
    expect(parsed.delta_24h).toBe(0.12);
    expect(parsed.community_recognitions.find((item) => item.community_code === "gfe")).toMatchObject({ native_level: "GFE-3.3.3", level_name: "L3" });
    expect(parsed.community_recognitions.find((item) => item.community_code === "iov")).toMatchObject({ native_level: "SM3", level_name: "Architect" });
  });

  it("normalizes database numerics and timestamps into canonical projection strings", () => {
    const value = founderPerformanceProjectionValueFromDatabase({
      source_community: "iov",
      community_rate_amount: 750,
      community_rate_unit: "USD_per_hour",
      vcom_event_amount: 1125,
      vcom_event_unit: "USD",
      vcperformance_event_amount: 867.375,
      vcperformance_event_unit: "USD",
      protocol_finality_status: "final",
      payability_status: "non_payable",
      finality_authority_version_id: "1887d318-3ea0-4b12-922d-067c385f35ea",
      finalized_at: "2026-07-31 09:08:30.346743+00",
    });
    expect(value).toMatchObject({
      community_rate_amount: "750.000000000000",
      vcom_event_amount: "1125.000000000000",
      vcperformance_event_amount: "867.375000000000",
      finalized_at: "2026-07-31T09:08:30.346Z",
    });
    expect(founderWellbeingProjectionSchema.parse({
      ...projection,
      performance_values: [value],
    }).performance_values).toHaveLength(1);
  });
});
