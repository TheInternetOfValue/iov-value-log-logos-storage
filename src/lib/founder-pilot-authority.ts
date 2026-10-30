import registry from "@/data/ecosystem-registry.v0.1.json";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Community, ValidationRole, WellbeingNode } from "@/lib/domain";

export const ECOSYSTEM_REGISTRY_VERSION = "0.1.0" as const;
export const ECOSYSTEM_REGISTRY_SHA256 = "dcc1c25fe726880fdcaae7ec584cfd887bc8136e26cc2293bdd34acc1d66d310" as const;

export type ReviewOperation = "non_performance_review" | "performance_source_review" | "performance_impact_review";
export type ReviewMode = "founder_self_review" | "founder_self_review_provisional";
export type PerformanceImpactStatus = "applied" | "no_transition" | "pending";

export type FounderAppointment = {
  id: string;
  identity_ref: string;
  entity_id: Community;
  role: ValidationRole;
  review_mode: ReviewMode;
  settlement_authority: boolean;
  subject_scope: "self";
  scopes: string[];
  status: "active" | "inactive";
  valid_from: string;
  registry_version: string;
};

export type DecisionRequirement = {
  entityId: Community;
  role: ValidationRole;
  operation: ReviewOperation;
  decision: "validated" | "provisional";
};

export function registryEntity(entityId: string) {
  const entity = registry.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`UNKNOWN_ECOSYSTEM_ENTITY:${entityId}`);
  if (entity.registry_version !== ECOSYSTEM_REGISTRY_VERSION) throw new Error("REGISTRY_VERSION_MISMATCH");
  return entity;
}

export function requiredDecisions(slice: { slice_type: string; community: Community; performance_impact_status?: PerformanceImpactStatus }): DecisionRequirement[] {
  if (slice.slice_type !== "performance") {
    return [{ entityId: "house_of_bros", role: "house_of_bros_validator", operation: "non_performance_review", decision: "validated" }];
  }
  const source = slice.community === "gfe"
    ? { entityId: "gfe" as const, role: "gfe_validator" as const, decision: "validated" as const }
    : { entityId: "iov" as const, role: "iov_validator" as const, decision: "validated" as const };
  const requirements: DecisionRequirement[] = [{ ...source, operation: "performance_source_review" }];
  if (slice.performance_impact_status !== "pending") {
    requirements.push({ entityId: "house_of_bros", role: "house_of_bros_validator", operation: "performance_impact_review", decision: "validated" });
  }
  return requirements;
}

export function appointmentAuthorizes(input: {
  appointment: FounderAppointment;
  actorIdentityRef: string;
  subjectIdentityRef: string;
  requirement: DecisionRequirement;
  node: WellbeingNode;
  now?: Date;
}) {
  const { appointment, actorIdentityRef, subjectIdentityRef, requirement, node } = input;
  registryEntity(requirement.entityId);
  if (appointment.status !== "active") return false;
  if (appointment.identity_ref !== actorIdentityRef || actorIdentityRef !== subjectIdentityRef) return false;
  if (appointment.subject_scope !== "self") return false;
  if (appointment.entity_id !== requirement.entityId || appointment.role !== requirement.role) return false;
  if (appointment.registry_version !== ECOSYSTEM_REGISTRY_VERSION) return false;
  if (new Date(appointment.valid_from) > (input.now ?? new Date())) return false;
  if (!appointment.scopes.includes(requirement.operation)) return false;
  if (requirement.operation === "non_performance_review" && !appointment.scopes.includes(`node:${node}`)) return false;
  if (requirement.decision === "validated" && !appointment.settlement_authority) return false;
  if (requirement.decision === "provisional" && appointment.settlement_authority) return false;
  return true;
}

export async function resolveFounderAppointment(
  db: Pick<SupabaseClient, "from">,
  input: { actorIdentityRef: string; subjectIdentityRef: string; requirement: DecisionRequirement; node: WellbeingNode },
) {
  const { data, error } = await db.from("founder_pilot_appointments").select("*")
    .eq("identity_ref", input.actorIdentityRef)
    .eq("entity_id", input.requirement.entityId)
    .eq("role", input.requirement.role)
    .eq("status", "active")
    .lte("valid_from", new Date().toISOString())
    .order("valid_from", { ascending: false }).limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`ACTIVE_APPOINTMENT_REQUIRED:${input.requirement.entityId}:${input.requirement.role}`);
  if (!appointmentAuthorizes({ appointment: data as FounderAppointment, ...input })) {
    throw new Error(`APPOINTMENT_SCOPE_MISMATCH:${input.requirement.entityId}:${input.requirement.operation}`);
  }
  return data as FounderAppointment;
}
