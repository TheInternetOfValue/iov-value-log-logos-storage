"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import {
  draftSliceInputSchema, expectedValidationRole,
  type Community, type WellbeingNode,
} from "@/lib/domain";
import { canRejectDraft, canRemoveCanonicalDuplicate } from "@/lib/canonical-lifecycle";
import { earliestOpenDate, isChronologicallyEligible, isFutureItem } from "@/lib/chronology";
import { enqueueReplay } from "@/lib/replay-queue";
import { adminClient } from "@/lib/supabase/admin";
import { requireMoses, serverClient } from "@/lib/supabase/server";
import { assertTimelineIntegrity, timelineOverlapError, timelineOverlapsForOwner } from "@/lib/timeline-integrity";
import {
  FOUNDER_CALCULATION_VERSION,
  FOUNDER_POLICY_CONTENT_HASH,
  FOUNDER_POLICY_ID,
  FOUNDER_POLICY_VERSION,
  calculateFounderRollups,
  calculateFounderW,
  founderStateFromRatings,
  type FounderState,
} from "@/lib/founder-wellbeing";
import { founderWellbeingEnabled } from "@/lib/founder-mode";
import { runFounderReplay } from "@/lib/founder-replay-server";
import { MOSES_CANONICAL_DID } from "@/lib/identity";
import {
  type PerformanceImpactStatus,
} from "@/lib/founder-pilot-authority";

import { founderPilotValidationRows, appendNewFounderPilotRows } from "@/lib/founder-review-server";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

function indiaLocalTimestamp(data: FormData, localKey: string, legacyKey: string) {
  const local = text(data, localKey);
  if (local) return new Date(`${local}:00+05:30`).toISOString();
  return text(data, legacyKey);
}

export async function sendMagicLink(formData: FormData) {
  const email = text(formData, "email").toLowerCase();
  const allowed = (process.env.MOSES_EMAIL_ALLOWLIST ?? "").split(",").map((v) => v.trim().toLowerCase());
  if (!allowed.includes(email)) redirect("/login?error=not-allowed");
  const supabase = await serverClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback` } });
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await serverClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function saveFounderBootstrapBaseline(formData: FormData) {
  if (!founderWellbeingEnabled()) throw new Error("FOUNDER_WELLBEING_DISABLED");
  const { user } = await requireMoses();
  const db = adminClient();
  const ratings = Object.fromEntries(
    ["Physiology", "Emotion", "Feeling", "Thought", "Habit", "Performance"].map((component) => [component, Number(text(formData, component))]),
  ) as FounderState;
  const state = founderStateFromRatings(ratings);
  const wellbeingScore = calculateFounderW(state);
  const rollups = calculateFounderRollups(state);
  const { data: previous } = await db.from("founder_wellbeing_baseline_epochs").select("id")
    .eq("owner_id", user.id).order("effective_at", { ascending: false }).limit(1).maybeSingle();
  const { data: baseline, error } = await db.from("founder_wellbeing_baseline_epochs").insert({
    owner_id: user.id,
    subject_id: MOSES_CANONICAL_DID,
    epoch_kind: previous ? "calibration" : "bootstrap",
    method: previous ? "calibration_baseline_v0.1" : "bootstrap_baseline_v0.1",
    validation_mode: "founder_self_review",
    physiology: state.Physiology,
    emotion: state.Emotion,
    feeling: state.Feeling,
    thought: state.Thought,
    habit: state.Habit,
    performance: state.Performance,
    wellbeing_score: wellbeingScore,
    rollups,
    policy_id: FOUNDER_POLICY_ID,
    policy_version: FOUNDER_POLICY_VERSION,
    policy_content_hash: FOUNDER_POLICY_CONTENT_HASH,
    calculation_version: FOUNDER_CALCULATION_VERSION,
    effective_at: new Date().toISOString(),
    supersedes_epoch_id: previous?.id ?? null,
  }).select("id").single();
  if (error || !baseline) throw new Error(error?.message ?? "FOUNDER_BASELINE_NOT_SAVED");
  await db.from("audit_events").insert({
    owner_id: user.id,
    actor_id: user.id,
    actor_type: "observer",
    event_type: previous ? "founder_calibration_baseline_created" : "founder_bootstrap_baseline_created",
    entity_type: "founder_wellbeing_baseline_epoch",
    entity_id: baseline.id,
    metadata: { policy_id: FOUNDER_POLICY_ID, policy_version: FOUNDER_POLICY_VERSION, validation_mode: "founder_self_review" },
  });
  await runFounderReplay(user.id, previous ? "calibration_baseline_created" : "bootstrap_baseline_created");
  revalidatePath("/profile");
  redirect("/profile?baseline=saved");
}

export async function initializeFounderWellbeingState() {
  if (!founderWellbeingEnabled()) throw new Error("FOUNDER_WELLBEING_DISABLED");
  const { user } = await requireMoses();
  const result = await runFounderReplay(user.id, "founder_live_activation");
  revalidatePath("/profile");
  redirect(`/profile?founder=${result.status}`);
}

export async function publishPublicProfileProjection() {
  await requireMoses();
  const secret = process.env.PROJECTION_CRON_SECRET?.trim();
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!secret || !origin) redirect("/profile?sync=not-configured");

  const response = await fetch(`${origin}/api/internal/publish-pilot-w`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "x-iov-publication-trigger": "manual" },
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as {
    pilot_w?: { ok?: boolean; error?: string };
    community_value?: { ok?: boolean; error?: string };
    founder_wellbeing?: { ok?: boolean; error?: string; skipped?: boolean };
  } | null;

  revalidatePath("/profile");
  if (!response.ok || !result?.pilot_w?.ok || !result.community_value?.ok || !result.founder_wellbeing?.ok) {
    const publicationErrors = [result?.pilot_w?.error, result?.community_value?.error];
    if (publicationErrors.some((error) => error === "sharing_off" || error === "public_sharing_off" || error?.endsWith("_sharing_off"))) {
      redirect("/profile?sync=sharing-off");
    }
    redirect("/profile?sync=failed");
  }
  redirect("/profile?sync=success");
}

export async function saveDraft(formData: FormData) {
  const { client, user } = await requireMoses();
  const id = text(formData, "id");
  const input = draftSliceInputSchema.parse({
    start_at: indiaLocalTimestamp(formData, "start_local", "start_at"),
    end_at: indiaLocalTimestamp(formData, "end_local", "end_at"),
    timezone: text(formData, "timezone"),
    activity: text(formData, "activity"),
    proof: text(formData, "proof") || undefined,
    wellbeing_node: text(formData, "wellbeing_node"),
    slice_type: text(formData, "slice_type"),
    community: text(formData, "community"),
    sao_lane: text(formData, "sao_lane") || undefined,
    skill_level: text(formData, "skill_level") || undefined,
    impact_direction: text(formData, "impact_direction") || undefined,
    impact_intensity: text(formData, "impact_intensity") || undefined,
    confidence: text(formData, "confidence") || undefined,
    activity_occurrence_id: text(formData, "activity_occurrence_id") || undefined,
    source_attestation_id: text(formData, "source_attestation_id") || undefined,
    founder_task_id: text(formData, "founder_task_id") || undefined,
    native_skill_level: text(formData, "native_skill_level") || undefined,
    founder_performance_impact: text(formData, "founder_performance_impact") || undefined,
    founder_vcom_rate: text(formData, "founder_vcom_rate") ? Number(text(formData, "founder_vcom_rate")) : undefined,
    founder_vcom_unit: text(formData, "founder_vcom_unit") || undefined,
    founder_validation_mode: text(formData, "founder_validation_mode") || undefined,
  });
  const { error } = await client.from("draft_slices").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "drafted");
  if (error) throw new Error(error.message);
  await adminClient().from("audit_events").insert({
    owner_id: user.id, actor_id: user.id, actor_type: "observer",
    event_type: "draft_corrected", entity_type: "draft_slice", entity_id: id,
    metadata: { changed_by: "observer" },
  });
  revalidatePath(`/slices/${id}`);
  redirect("/review");
}

export async function observerDecision(formData: FormData) {
  const { client, user } = await requireMoses();
  const db = adminClient();
  const draftId = text(formData, "draft_id");
  const decision = text(formData, "decision");
  const rationale = text(formData, "rationale") || "Moses confirmed that the draft accurately represents his observation.";
  const { data: draft, error } = await client.from("draft_slices").select("*").eq("id", draftId).eq("status", "drafted").single();
  if (error || !draft || !canRejectDraft(draft.status)) throw new Error("Draft is no longer pending");
  const [{ data: openDrafts }, { data: openCanonical }] = await Promise.all([
    client.from("draft_slices").select("start_at,timezone").eq("status", "drafted").order("start_at").limit(100),
    client.from("canonical_slices").select("start_at,timezone").eq("status", "validation_pending").order("start_at").limit(100),
  ]);
  const openDate = earliestOpenDate([...(openDrafts ?? []), ...(openCanonical ?? [])]);
  if (!isChronologicallyEligible(draft, openDate)) throw new Error("Complete earlier records first so calculations remain chronological.");

  if (decision === "rejected") {
    await db.from("observer_events").insert({
      draft_slice_id: draft.id, owner_id: user.id, actor_id: user.id, decision, rationale,
    });
    await client.from("draft_slices").update({ status: "observer_rejected" }).eq("id", draft.id);
    await db.from("audit_events").insert({
      owner_id: user.id, actor_id: user.id, actor_type: "observer",
      event_type: "draft_rejected", entity_type: "draft_slice", entity_id: draft.id,
      metadata: { removed_from_operational_queue: true },
    });
  } else {
    await assertTimelineIntegrity(db, user.id, [{
      id: `draft-${draft.id}`, start_at: draft.start_at, end_at: draft.end_at, community: draft.community,
    }]);
    const protocolLinkId = randomUUID();
    const { data: canonical, error: canonicalError } = await db.from("canonical_slices").insert({
      protocol_link_id: protocolLinkId,
      revision_number: 1,
      draft_slice_id: draft.id,
      owner_id: user.id,
      start_at: draft.start_at,
      end_at: draft.end_at,
      timezone: draft.timezone,
      activity: draft.activity,
      proof: draft.proof,
      wellbeing_node: draft.wellbeing_node,
      slice_type: draft.slice_type,
      community: draft.community,
      sao_lane: draft.sao_lane,
      skill_level: draft.skill_level,
      impact_direction: draft.impact_direction,
      impact_intensity: draft.impact_intensity,
      confidence: draft.confidence,
      activity_occurrence_id: draft.activity_occurrence_id || draft.id,
      source_attestation_id: draft.source_attestation_id,
      founder_task_id: draft.founder_task_id,
      native_skill_level: draft.native_skill_level,
      founder_performance_impact: draft.founder_performance_impact,
      founder_vcom_rate: draft.founder_vcom_rate,
      founder_vcom_unit: draft.founder_vcom_unit,
      founder_validation_mode: draft.founder_validation_mode,
      status: "validation_pending",
    }).select("id").single();
    if (canonicalError || !canonical) throw new Error(canonicalError?.message ?? "Canonical slice creation failed");
    await db.from("observer_events").insert({
      draft_slice_id: draft.id, canonical_slice_id: canonical.id,
      owner_id: user.id, actor_id: user.id, decision: "approved", rationale,
    });
    await client.from("draft_slices").update({ status: "observer_approved" }).eq("id", draft.id);
  }
  revalidatePath("/");
  revalidatePath("/review");
  if (decision === "rejected") {
    const affectedDate = localDate(draft.start_at, draft.timezone);
    const [{ data: remainingDrafts }, { data: remainingPending }] = await Promise.all([
      client.from("draft_slices").select("start_at,timezone").eq("status", "drafted").order("start_at").limit(100),
      client.from("canonical_slices").select("start_at,timezone").eq("status", "validation_pending").order("start_at").limit(100),
    ]);
    const dateStillOpen = [...(remainingDrafts ?? []), ...(remainingPending ?? [])]
      .some((item) => localDate(item.start_at, item.timezone) === affectedDate);
    if (!dateStillOpen) {
      const { data: validated } = await client.from("canonical_slices").select("start_at,timezone")
        .eq("status", "validated").order("start_at").limit(500);
      const replayStart = (validated ?? []).find((item) => localDate(item.start_at, item.timezone) === affectedDate)?.start_at;
      if (replayStart) {
        try {
          await enqueueReplay(user.id, replayStart, `legacy_draft_resolved:${affectedDate}`);
        } catch {
          redirect("/review?replay=failed");
        }
      }
    }
  }
  redirect("/review");
}

export async function rejectDraft(formData: FormData) {
  const { client, user } = await requireMoses();
  const db = adminClient();
  const draftId = text(formData, "draft_id");
  const { data: draft, error } = await client.from("draft_slices").select("id,status").eq("id", draftId).eq("status", "drafted").single();
  if (error || !draft || !canRejectDraft(draft.status)) throw new Error("Draft is no longer pending");

  await db.from("observer_events").insert({
    draft_slice_id: draft.id, owner_id: user.id, actor_id: user.id, decision: "rejected",
    rationale: "Removed as a duplicate before observer approval.",
  });
  const { error: updateError } = await client.from("draft_slices").update({ status: "observer_rejected" }).eq("id", draft.id).eq("status", "drafted");
  if (updateError) throw new Error(updateError.message);
  await db.from("audit_events").insert({
    owner_id: user.id, actor_id: user.id, actor_type: "observer",
    event_type: "draft_duplicate_removed", entity_type: "draft_slice", entity_id: draft.id,
    metadata: { removed_from_operational_queue: true },
  });
  revalidatePath("/");
  revalidatePath("/privacy");
  revalidatePath("/observer");
  revalidatePath("/review");
  redirect("/review");
}

function localDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export async function removeCanonicalDuplicate(formData: FormData) {
  const { client, user } = await requireMoses();
  const db = adminClient();
  const id = text(formData, "canonical_slice_id");
  const { data: slice } = await client.from("canonical_slices").select("id,status,start_at,timezone,protocol_link_id,revision_number")
    .eq("id", id).single();
  if (!slice || !canRemoveCanonicalDuplicate(slice.status)) {
    throw new Error("This canonical activity cannot be removed as a duplicate");
  }

  const { data: removed, error } = await db.from("canonical_slices").update({ status: "superseded" })
    .eq("id", slice.id).eq("status", slice.status).select("id").maybeSingle();
  if (error || !removed) throw new Error(error?.message ?? "This canonical activity was already removed or changed");
  await db.from("audit_events").insert({
    owner_id: user.id, actor_id: user.id, actor_type: "observer",
    event_type: "canonical_duplicate_removed", entity_type: "canonical_slice", entity_id: slice.id,
    metadata: { protocol_link_id: slice.protocol_link_id, revision_number: slice.revision_number, prior_status: slice.status },
  });
  await enqueueReplay(user.id, slice.start_at, `duplicate_removed:${slice.id}`);
  revalidatePath("/");
  revalidatePath("/day");
  revalidatePath("/validator");
  revalidatePath("/review");
  revalidatePath("/profile");
  revalidatePath(`/slices/canonical/${slice.id}`);
  redirect(`/day?date=${localDate(slice.start_at, slice.timezone)}&removed=duplicate`);
}

export async function reviseCanonicalSlice(formData: FormData) {
  const { client, user } = await requireMoses();
  const db = adminClient();
  const id = text(formData, "canonical_slice_id");
  const { data: current } = await client.from("canonical_slices").select("*").eq("id", id).single();
  if (!current || !["validation_pending", "calculated", "validated", "validation_rejected"].includes(current.status)) {
    throw new Error("This canonical activity cannot be revised");
  }
  const input = draftSliceInputSchema.parse({
    start_at: indiaLocalTimestamp(formData, "start_local", "start_at"),
    end_at: indiaLocalTimestamp(formData, "end_local", "end_at"),
    timezone: text(formData, "timezone"), activity: text(formData, "activity"),
    proof: text(formData, "proof") || undefined, wellbeing_node: text(formData, "wellbeing_node"),
    slice_type: text(formData, "slice_type"), community: text(formData, "community"),
    sao_lane: text(formData, "sao_lane") || undefined, skill_level: text(formData, "skill_level") || undefined,
    impact_direction: text(formData, "impact_direction") || undefined,
    impact_intensity: text(formData, "impact_intensity") || undefined,
    confidence: text(formData, "confidence") || undefined,
    activity_occurrence_id: text(formData, "activity_occurrence_id") || current.activity_occurrence_id || undefined,
    source_attestation_id: text(formData, "source_attestation_id") || current.source_attestation_id || undefined,
    founder_task_id: text(formData, "founder_task_id") || current.founder_task_id || undefined,
    native_skill_level: text(formData, "native_skill_level") || current.native_skill_level || undefined,
    founder_performance_impact: text(formData, "founder_performance_impact") || current.founder_performance_impact || undefined,
    founder_vcom_rate: text(formData, "founder_vcom_rate") ? Number(text(formData, "founder_vcom_rate")) : current.founder_vcom_rate ?? undefined,
    founder_vcom_unit: text(formData, "founder_vcom_unit") || current.founder_vcom_unit || undefined,
    founder_validation_mode: text(formData, "founder_validation_mode") || current.founder_validation_mode || undefined,
  });
  await assertTimelineIntegrity(db, user.id, [{
    id: `revision-${current.id}`, start_at: input.start_at, end_at: input.end_at, community: input.community,
  }], [current.id]);
  const { data: revision, error } = await db.from("canonical_slices").insert({
    ...input, protocol_link_id: current.protocol_link_id, revision_number: current.revision_number + 1,
    owner_id: user.id, status: "validation_pending", supersedes_slice_id: current.id,
  }).select("id").single();
  if (error || !revision) throw new Error(error?.message ?? "Revision creation failed");
  await db.from("canonical_slices").update({ status: "superseded" }).eq("id", current.id);
  await db.from("audit_events").insert({
    owner_id: user.id, actor_id: user.id, actor_type: "observer",
    event_type: "canonical_revision_created", entity_type: "canonical_slice", entity_id: revision.id,
    metadata: { supersedes: current.id, protocol_link_id: current.protocol_link_id, revision_number: current.revision_number + 1 },
  });
  revalidatePath("/");
  revalidatePath("/review");
  redirect(`/review?date=${localDate(input.start_at, input.timezone)}&corrected=1`);
}

export async function validateSlice(formData: FormData) {
  const { client, user } = await requireMoses();
  const db = adminClient();
  const id = text(formData, "canonical_slice_id");
  const decision = text(formData, "decision");
  const { data: slice } = await client.from("canonical_slices").select("*").eq("id", id).eq("status", "validation_pending").single();
  if (!slice) throw new Error("This record is no longer awaiting human confirmation");
  if (decision === "validated") {
    const overlaps = await timelineOverlapsForOwner(db, user.id, []);
    const conflict = overlaps.find(({ first, second }) => first.id === slice.id || second.id === slice.id);
    if (conflict) throw timelineOverlapError(conflict);
  }
  if (isFutureItem(slice)) throw new Error("Future records cannot be confirmed before their start time");
  const [{ data: pending }, { data: drafts }] = await Promise.all([
    client.from("canonical_slices").select("start_at,timezone").eq("status", "validation_pending").order("start_at"),
    client.from("draft_slices").select("start_at,timezone").eq("status", "drafted").order("start_at"),
  ]);
  const earliest = earliestOpenDate([...(pending ?? []), ...(drafts ?? [])]);
  if (!isChronologicallyEligible(slice, earliest)) throw new Error("Complete earlier records first so calculations remain chronological");
  const role = expectedValidationRole(slice.wellbeing_node as WellbeingNode, slice.community as Community);
  const evidenceAdequate = formData.get("evidence_adequate") === "on";
  const classificationAdequate = formData.get("classification_adequate") === "on";
  const selfObservationIntegrity = formData.get("self_observation_integrity") === "on";
  if (decision === "validated" && (!evidenceAdequate || !classificationAdequate || (slice.slice_type === "non_performance" && !selfObservationIntegrity))) {
    throw new Error("All routed validation adequacy checks are required before validation");
  }
  if (decision !== "validated") {
    throw new Error("Founder-pilot appointment enforcement currently supports affirmative routed decisions only; corrections remain available before review");
  }
  const routed = await founderPilotValidationRows(db, user.id, {
    id: slice.id,
    slice_type: slice.slice_type,
    community: slice.community as Community,
    wellbeing_node: slice.wellbeing_node as WellbeingNode,
    proof: slice.proof,
    performance_impact_status: slice.slice_type === "performance" ? "pending" : undefined,
  }, {
    adequate: evidenceAdequate,
    classification: classificationAdequate,
    integrity: slice.slice_type === "non_performance" ? selfObservationIntegrity : null,
    rationale: text(formData, "rationale") || `Reviewed by Moses under the routed ${role} founder-pilot appointment.`,
    reviewed: text(formData, "evidence_reviewed") || slice.proof || "Observer-provided activity evidence reviewed.",
  });
  await appendNewFounderPilotRows(db, routed.rows);
  const status = routed.settles ? "validated" : "validation_pending";
  await db.from("canonical_slices").update({ status }).eq("id", id);
  if (status === "validated") {
    const [{ data: sameDayPending }, { data: sameDayDrafts }] = await Promise.all([
      client.from("canonical_slices").select("id,start_at,timezone").eq("status", "validation_pending").order("start_at"),
      client.from("draft_slices").select("id,start_at,timezone").eq("status", "drafted").order("start_at"),
    ]);
    const stillOpen = [...(sameDayPending ?? []), ...(sameDayDrafts ?? [])]
      .some((item) => localDate(item.start_at, item.timezone) === earliest);
    if (!stillOpen) {
      const { data: validated } = await client.from("canonical_slices").select("start_at,timezone").eq("status", "validated").order("start_at");
      const replayStart = (validated ?? []).find((item) => localDate(item.start_at, item.timezone) === earliest)?.start_at ?? slice.start_at;
      try {
        await enqueueReplay(user.id, replayStart, `chronological_day:${earliest}`);
      } catch {
        revalidatePath("/review");
        redirect(`/review?date=${earliest}&error=replay`);
      }
    }
  }
  revalidatePath("/");
  revalidatePath("/review");
  redirect(`/review?date=${earliest}&saved=1&authority=${encodeURIComponent(role)}&settlement=${routed.settles ? "final" : "pending"}`);
}

export async function validateBatch(formData: FormData) {
  const { client, user } = await requireMoses();
  const db = adminClient();
  const ids = formData.getAll("canonical_slice_id").map(String).filter(Boolean);
  const returnDate = text(formData, "return_date");
  if (!ids.length) redirect(`/review?date=${returnDate}&error=no-selection`);
  const { data: slices } = await client.from("canonical_slices").select("*")
    .in("id", ids).eq("status", "validation_pending").order("start_at");
  if (!slices?.length || slices.length !== ids.length) redirect(`/review?date=${returnDate}&error=stale-selection`);
  const overlaps = await timelineOverlapsForOwner(db, user.id, []);
  if (overlaps.some(({ first, second }) => ids.includes(first.id) || ids.includes(second.id))) {
    redirect(`/review?date=${returnDate}&error=timeline-overlap`);
  }

  const [{ data: pending }, { data: drafts }] = await Promise.all([
    client.from("canonical_slices").select("start_at,timezone").eq("status", "validation_pending").order("start_at"),
    client.from("draft_slices").select("start_at,timezone").eq("status", "drafted").order("start_at"),
  ]);
  const earliestDate = earliestOpenDate([...(pending ?? []), ...(drafts ?? [])]);
  if (!earliestDate || slices.some((slice) => isFutureItem(slice) || !isChronologicallyEligible(slice, earliestDate))) {
    redirect(`/review?date=${earliestDate ?? ""}&error=chronology`);
  }

  const expectedCommunity = slices[0].community;
  const expectedRole = expectedValidationRole(slices[0].wellbeing_node as WellbeingNode, expectedCommunity as Community);
  const sameAuthority = slices.every((slice) =>
    slice.community === expectedCommunity &&
    expectedValidationRole(slice.wellbeing_node as WellbeingNode, slice.community as Community) === expectedRole
  );
  if (!sameAuthority) throw new Error("Batch validation cannot mix community roles");

  const performanceImpacts = slices.flatMap((slice) => {
    if (slice.slice_type !== "performance") return [];
    const status = text(formData, `founder_performance_impact_status:${slice.id}`) as PerformanceImpactStatus;
    const impact = text(formData, `founder_performance_impact:${slice.id}`);
    const direction = text(formData, `founder_performance_impact_direction:${slice.id}`);
    if (!['applied', 'no_transition', 'pending'].includes(status)) {
      throw new Error(`Choose the HouseOfBros Performance-impact status for ${slice.activity}`);
    }
    if (founderWellbeingEnabled() && status === "applied" && (!["positive", "negative"].includes(direction) || !["low", "medium", "high"].includes(impact))) {
      throw new Error(`Applied impact requires direction and intensity for ${slice.activity}`);
    }
    return [{ id: slice.id, status, impact: status === "applied" ? impact : null, direction: status === "applied" ? direction : null }];
  });
  await Promise.all(performanceImpacts.map(({ id, status, impact, direction }) =>
    db.from("canonical_slices").update({ founder_performance_impact_status: status, founder_performance_impact: impact, impact_direction: direction }).eq("id", id).eq("status", "validation_pending")
  ));

  const routed = await Promise.all(slices.map((slice) => founderPilotValidationRows(db, user.id, {
    id: slice.id,
    slice_type: slice.slice_type,
    community: slice.community as Community,
    wellbeing_node: slice.wellbeing_node as WellbeingNode,
    proof: slice.proof,
    performance_impact_status: slice.slice_type === "performance"
      ? performanceImpacts.find((impact) => impact.id === slice.id)?.status ?? "pending"
      : undefined,
  }, {
    adequate: true,
    classification: true,
    integrity: slice.slice_type === "non_performance" ? true : null,
    rationale: `Batch-reviewed by Moses under the routed ${expectedRole} founder-pilot appointment.`,
    reviewed: slice.proof || "Observer-confirmed activity evidence reviewed.",
  })));
  const validationRows = routed.flatMap((result) => result.rows);
  await appendNewFounderPilotRows(db, validationRows);
  const settledIds = slices.filter((_, index) => routed[index].settles).map((slice) => slice.id);
  if (settledIds.length) {
    await db.from("canonical_slices").update({ status: "validated" }).in("id", settledIds).eq("status", "validation_pending");
  }

  const earliest = slices[0];
  const [{ data: remaining }, { data: remainingDrafts }] = await Promise.all([
    client.from("canonical_slices").select("id,start_at,timezone").eq("status", "validation_pending").order("start_at"),
    client.from("draft_slices").select("id,start_at,timezone").eq("status", "drafted").order("start_at"),
  ]);
  const sameDayStillOpen = [...(remaining ?? []), ...(remainingDrafts ?? [])]
    .some((item) => localDate(item.start_at, item.timezone) === earliestDate);
  if (settledIds.length === ids.length && !sameDayStillOpen) {
    const { data: validated } = await client.from("canonical_slices").select("start_at,timezone").eq("status", "validated").order("start_at");
    const replayStart = (validated ?? []).find((item) => localDate(item.start_at, item.timezone) === earliestDate)?.start_at ?? earliest.start_at;
    try {
      await enqueueReplay(user.id, replayStart, `chronological_day:${earliestDate}`);
    } catch {
      revalidatePath("/review");
      redirect(`/review?date=${earliestDate}&error=replay`);
    }
  }

  revalidatePath("/");
  revalidatePath("/review");
  redirect(`/review?date=${earliestDate}&saved=${ids.length}&authority=${encodeURIComponent(expectedRole)}&settlement=${settledIds.length === ids.length ? "final" : "pending"}`);
}

export async function retryReplay(formData: FormData) {
  const { client, user } = await requireMoses();
  const id = text(formData, "replay_run_id");
  const { data: replay } = await client.from("replay_runs").select("id,from_timestamp,status,started_at,heartbeat_at")
    .eq("id", id).in("status", ["failed", "running"]).maybeSingle();
  if (!replay?.from_timestamp) {
    revalidatePath("/review");
    redirect("/review?replay=up-to-date");
  }
  await enqueueReplay(user.id, replay.from_timestamp, `retry_of:${replay.id}`);
  revalidatePath("/review");
  redirect("/review?replay=running");
}

export async function deleteNarrative(formData: FormData) {
  const { user } = await requireMoses();
  const id = text(formData, "intake_session_id");
  const db = adminClient();
  const { data: intake } = await db.from("intake_sessions").select("id,narrative_digest").eq("id", id).eq("owner_id", user.id).single();
  if (!intake) throw new Error("Intake not found");
  await db.from("intake_sessions").update({
    narrative_ciphertext: null, narrative_iv: null, narrative_auth_tag: null,
    narrative_key_version: null, narrative_deleted_at: new Date().toISOString(),
  }).eq("id", id);
  await db.from("audit_events").insert({
    owner_id: user.id, actor_id: user.id, actor_type: "observer",
    event_type: "narrative_tombstoned", entity_type: "intake_session", entity_id: id,
    metadata: { digest_preserved: true },
  });
  revalidatePath("/privacy");
  revalidatePath("/review");
}

export async function savePilotMetric(formData: FormData) {
  const { client, user } = await requireMoses();
  const optionalInteger = (key: string) => {
    const value = text(formData, key);
    return value ? Number.parseInt(value, 10) : null;
  };
  const metricDate = text(formData, "metric_date");
  const payload = {
    owner_id: user.id,
    metric_date: metricDate,
    submission_seconds: optionalInteger("submission_seconds"),
    review_seconds: optionalInteger("review_seconds"),
    parser_fields_total: optionalInteger("parser_fields_total"),
    parser_fields_correct: optionalInteger("parser_fields_correct"),
    manual_correction_count: optionalInteger("manual_correction_count") ?? 0,
    rejected_slice_count: optionalInteger("rejected_slice_count") ?? 0,
    overlap_error_count: optionalInteger("overlap_error_count") ?? 0,
    cap_limited_count: optionalInteger("cap_limited_count") ?? 0,
    logging_delayed_or_avoided: formData.get("logging_delayed_or_avoided") === "on",
    w_believability: text(formData, "w_believability") || null,
    friction_notes: text(formData, "friction_notes") || null,
  };
  const { error } = await client.from("pilot_metrics").upsert(payload, { onConflict: "owner_id,metric_date" });
  if (error) throw new Error(error.message);
  await adminClient().from("audit_events").insert({
    owner_id: user.id, actor_id: user.id, actor_type: "observer",
    event_type: "pilot_metrics_recorded", entity_type: "pilot_day", entity_id: metricDate,
    metadata: { w_believability: payload.w_believability },
  });
  revalidatePath("/day");
}
