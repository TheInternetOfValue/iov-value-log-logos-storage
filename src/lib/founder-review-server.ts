import type { SupabaseClient } from "@supabase/supabase-js";
import type { Community, WellbeingNode } from "@/lib/domain";
import { MOSES_CANONICAL_DID } from "@/lib/identity";
import { ECOSYSTEM_REGISTRY_VERSION, requiredDecisions, resolveFounderAppointment, type PerformanceImpactStatus } from "@/lib/founder-pilot-authority";

export async function founderPilotValidationRows(
  db: SupabaseClient,
  userId: string,
  slice: { id: string; slice_type: string; community: Community; wellbeing_node: WellbeingNode; proof?: string | null; performance_impact_status?: PerformanceImpactStatus },
  evidence: { adequate: boolean; classification: boolean; integrity: boolean | null; rationale: string; reviewed: string },
) {
  const requirements = requiredDecisions(slice);
  const rows = [];
  for (const requirement of requirements) {
    const appointment = await resolveFounderAppointment(db, {
      actorIdentityRef: MOSES_CANONICAL_DID,
      subjectIdentityRef: MOSES_CANONICAL_DID,
      requirement,
      node: slice.wellbeing_node,
    });
    rows.push({
      canonical_slice_id: slice.id,
      owner_id: userId,
      signer_id: userId,
      role: requirement.role,
      community: requirement.entityId,
      decision: requirement.decision,
      evidence_adequate: evidence.adequate,
      classification_adequate: evidence.classification,
      self_observation_integrity: requirement.operation === "non_performance_review" ? evidence.integrity : null,
      rationale: requirement.operation === "performance_impact_review"
        ? "HouseOfBros Performance-impact direction and intensity reviewed separately from source-community settlement."
        : evidence.rationale,
      evidence_reviewed: evidence.reviewed,
      appointment_id: appointment.id,
      entity_id: requirement.entityId,
      review_mode: appointment.review_mode,
      registry_version: ECOSYSTEM_REGISTRY_VERSION,
      validated_at: new Date().toISOString(),
    });
  }
  const impactComplete = slice.slice_type !== "performance" || slice.performance_impact_status !== "pending";
  return { rows, settles: impactComplete && requirements.every((requirement) => requirement.decision === "validated") };
}

export async function appendNewFounderPilotRows(db: SupabaseClient, rows: Array<{ canonical_slice_id: string; appointment_id: string } & Record<string, unknown>>) {
  if (!rows.length) return;
  const sliceIds = [...new Set(rows.map((row) => row.canonical_slice_id))];
  const appointmentIds = [...new Set(rows.map((row) => row.appointment_id))];
  const { data: existing, error: existingError } = await db.from("validation_events")
    .select("canonical_slice_id,appointment_id")
    .in("canonical_slice_id", sliceIds)
    .in("appointment_id", appointmentIds);
  if (existingError) throw new Error(existingError.message);
  const existingKeys = new Set((existing ?? []).map((row) => `${row.canonical_slice_id}:${row.appointment_id}`));
  const additions = rows.filter((row) => !existingKeys.has(`${row.canonical_slice_id}:${row.appointment_id}`));
  if (!additions.length) return;
  const { error } = await db.from("validation_events").insert(additions);
  if (error) throw new Error(error.message);
}
