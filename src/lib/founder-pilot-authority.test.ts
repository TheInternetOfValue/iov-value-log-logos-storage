import { describe, expect, it } from "vitest";
import registry from "@/data/ecosystem-registry.v0.1.json";
import {
  ECOSYSTEM_REGISTRY_SHA256,
  ECOSYSTEM_REGISTRY_VERSION,
  appointmentAuthorizes,
  registryEntity,
  requiredDecisions,
  type FounderAppointment,
} from "@/lib/founder-pilot-authority";

const identityRef = "did:iov:member:10000000-0000-4000-8000-000000000001";
const activeFrom = "2026-07-29T00:00:00.000Z";

function appointment(overrides: Partial<FounderAppointment> = {}): FounderAppointment {
  return {
    id: "8b9234e6-3aa5-4ccc-b9bc-fedd665836cc",
    identity_ref: identityRef,
    entity_id: "house_of_bros",
    role: "house_of_bros_validator",
    review_mode: "founder_self_review",
    settlement_authority: true,
    subject_scope: "self",
    scopes: ["non_performance_review", "node:Physiology", "node:Emotion", "node:Feeling", "node:Thought", "node:Habit", "performance_impact_review"],
    status: "active",
    valid_from: activeFrom,
    registry_version: ECOSYSTEM_REGISTRY_VERSION,
    ...overrides,
  };
}

describe("founder-pilot ecosystem authority", () => {
  it("pins the three canonical registry entities and source hash", () => {
    expect(registry.registry_version).toBe("0.1.0");
    expect(registry.entities.map((entity) => [entity.id, entity.entity_type])).toEqual([
      ["iov", "foundation"],
      ["gfe", "skill_community"],
      ["house_of_bros", "wellbecoming_community"],
    ]);
    expect(ECOSYSTEM_REGISTRY_SHA256).toBe("dcc1c25fe726880fdcaae7ec584cfd887bc8136e26cc2293bdd34acc1d66d310");
    expect(() => registryEntity("unknown")).toThrow("UNKNOWN_ECOSYSTEM_ENTITY");
  });

  it("requires HouseOfBros review for five non-Performance nodes", () => {
    for (const node of ["Physiology", "Emotion", "Feeling", "Thought", "Habit"] as const) {
      const requirement = requiredDecisions({ slice_type: "non_performance", community: "house_of_bros" })[0];
      expect(appointmentAuthorizes({ appointment: appointment(), actorIdentityRef: identityRef, subjectIdentityRef: identityRef, requirement, node, now: new Date("2026-07-30") })).toBe(true);
    }
  });

  it("separates source review from HouseOfBros Performance-impact review", () => {
    const iov = requiredDecisions({ slice_type: "performance", community: "iov", performance_impact_status: "applied" });
    expect(iov.map((item) => [item.entityId, item.operation, item.decision])).toEqual([
      ["iov", "performance_source_review", "validated"],
      ["house_of_bros", "performance_impact_review", "validated"],
    ]);
    expect(appointmentAuthorizes({ appointment: appointment(), actorIdentityRef: identityRef, subjectIdentityRef: identityRef, requirement: iov[0], node: "Performance", now: new Date("2026-07-30") })).toBe(false);
    expect(appointmentAuthorizes({ appointment: appointment(), actorIdentityRef: identityRef, subjectIdentityRef: identityRef, requirement: iov[1], node: "Performance", now: new Date("2026-07-30") })).toBe(true);
  });

  it("records source review without forcing a transition while impact remains pending", () => {
    const pending = requiredDecisions({ slice_type: "performance", community: "iov", performance_impact_status: "pending" });
    expect(pending).toEqual([{ entityId: "iov", role: "iov_validator", operation: "performance_source_review", decision: "validated" }]);
    const noTransition = requiredDecisions({ slice_type: "performance", community: "iov", performance_impact_status: "no_transition" });
    expect(noTransition.map((item) => item.operation)).toEqual(["performance_source_review", "performance_impact_review"]);
  });

  it("requires final GFE founder authority and rejects the superseded provisional appointment or another subject", () => {
    const requirement = requiredDecisions({ slice_type: "performance", community: "gfe", performance_impact_status: "applied" })[0];
    const gfe = appointment({
      id: "a8c9e734-1700-4657-ac80-43a0bda00ca4",
      entity_id: "gfe",
      role: "gfe_validator",
      review_mode: "founder_self_review_provisional",
      settlement_authority: false,
      scopes: ["performance_source_review"],
    });
    expect(requirement.decision).toBe("validated");
    expect(appointmentAuthorizes({ appointment: gfe, actorIdentityRef: identityRef, subjectIdentityRef: identityRef, requirement, node: "Performance", now: new Date("2026-07-30") })).toBe(false);
    expect(appointmentAuthorizes({ appointment: { ...gfe, review_mode: "founder_self_review", settlement_authority: true }, actorIdentityRef: identityRef, subjectIdentityRef: identityRef, requirement, node: "Performance", now: new Date("2026-07-30") })).toBe(true);
    expect(appointmentAuthorizes({ appointment: gfe, actorIdentityRef: identityRef, subjectIdentityRef: "did:iov:member:someone-else", requirement, node: "Performance", now: new Date("2026-07-30") })).toBe(false);
  });
});
