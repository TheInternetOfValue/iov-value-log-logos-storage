import { NextRequest } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { memberSession } from "@/lib/members/session";
import { adminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/members/http";
import { cohortFailure, cohortRequest } from "@/lib/cohort/http";
import {
  cohortCommand,
  cohortEnrollmentOpen,
  inviteHash,
  isCohortAdmin,
  readCipher,
  replayCohort,
  loadCohort,
  type CohortRecord,
} from "@/lib/cohort/server";
import {
  cohortActivitySchema,
  cohortReviewBlockers,
  type CohortActivity,
} from "@/lib/cohort/policy";
import { encryptNarrative } from "@/lib/crypto";
import { resolveActivitySource } from "@/lib/cohort/sources";
import { nativeColumns, type NativeRow } from "@/lib/native-log/storage-core";
import { DATED_POLICY, DATED_QA_POLICY } from "@/lib/field-station/ids";
const id = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("designate_dated_account"), did: z.string().regex(/^did:iov:member:[0-9a-f-]{36}$/), policy: z.enum([DATED_POLICY,DATED_QA_POLICY]), house: z.enum(["house_of_bros","house_of_sis"]), reference: z.string().regex(/^[A-Za-z0-9:/._-]{1,160}$/) }).strict(),
  z
    .object({
      action: z.literal("assign_operator"),
      did: z.string().regex(/^did:iov:member:[0-9a-f-]{36}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_community"),
      id,
      name: z.string().trim().min(1).max(120),
      kind: z.enum(["wellbecoming", "work"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("invite"),
      did: z
        .string()
        .regex(/^did:iov:member:[0-9a-f-]{36}$/)
        .optional(),
      communities: z.array(id).max(20),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke_membership"),
      owner: z.uuid(),
      community: id,
    })
    .strict(),
  z.object({ action: z.literal("revoke_invite"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("human_review"),
      recordId: z.uuid(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      rationale: z.string().trim().min(10).max(2000),
    })
    .strict(),
]);
export async function GET(request: NextRequest) {
  try {
    const parsed = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .safeParse(request.nextUrl.searchParams.get("page") ?? 0);
    if (!parsed.success) throw new Error("INVALID_INPUT");
    const page = parsed.data,
      offset = page * 50;
    const session = await memberSession();
    if (!(await isCohortAdmin(session.user.id)))
      throw new Error("UNAUTHORIZED");
    const db = adminClient();
    const enrollments = await db
      .from("cohort_enrollments")
      .select("owner_id,did,active,review_consent,timezone,policy_id,house_id")
      .order("owner_id")
      .range(offset, offset + 50);
    if (enrollments.error) throw new Error("UNAVAILABLE");
    const scopes = new Map<string, { active: boolean; review_consent: boolean; timezone: string }>(
      (enrollments.data ?? []).map((e) => [String(e.owner_id), e]),
    );
    const activeOwners = (enrollments.data ?? [])
      .filter((e) => e.active && e.review_consent)
      .map((e) => String(e.owner_id));
    const [communities, invitations, exceptions, requests, agent] =
      await Promise.all([
        db
          .from("cohort_communities")
          .select("id,name,kind,active")
          .order("name"),
        db
          .from("cohort_invitations")
          .select(
            "id,target_did,community_ids,expires_at,redeemed_at,revoked_at",
          )
          .order("created_at", { ascending: false })
          .range(offset, offset + 50),
        db
              .from("cohort_records")
              .select("*,cohort_enrollments!inner(active,review_consent,timezone)")
              .eq("cohort_enrollments.active", true)
              .eq("cohort_enrollments.review_consent", true)
              .in("review_status", ["escalated", "clarification"])
              .order("start_at")
              .range(offset, offset + 50),
        db
          .from("audit_events")
          .select("id,owner_id,metadata,created_at")
          .eq("event_type", "cohort_community_requested")
          .order("created_at", { ascending: false })
          .range(offset, offset + 50),
        db
          .from("cohort_agents")
          .select("active,operator_did,operator_label,accepted_at,version")
          .eq("id", "system:field-station-reviewer:v1")
          .single(),
      ]);
    if (
      communities.error ||
      invitations.error ||
      exceptions.error ||
      requests.error ||
      agent.error ||
      enrollments.error
    )
      throw new Error("UNAVAILABLE");
    const ownerIds = [
      ...new Set([
        ...activeOwners,
        ...(exceptions.data ?? []).map(row => String(row.owner_id)),
        ...(requests.data ?? []).map((r) => String(r.owner_id)),
      ]),
    ];
    const [names, bindings] = ownerIds.length
      ? await Promise.all([
          db.from("members").select("id,display_name").in("id", ownerIds),
          db
            .from("member_identity_bindings")
            .select("owner_id,did")
            .in("owner_id", ownerIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
    if (names.error || bindings.error) throw new Error("UNAVAILABLE");
    const nameFor = new Map(
        (names.data ?? []).map((m) => [
          String(m.id),
          String(m.display_name || "Participant"),
        ]),
      ),
      didFor = new Map(
        (bindings.data ?? []).map((b) => [String(b.owner_id), String(b.did)]),
      );
    const permitted = [];
    const records = exceptions.data.slice(0, 50) as Array<CohortRecord & { cohort_enrollments?: { active: boolean; review_consent: boolean; timezone: string } }>;
    for (const record of records) if (record.cohort_enrollments) scopes.set(record.owner_id, record.cohort_enrollments);
    // Bounded parallel reads keep a full exception page within the synchronous request budget.
    for (let offset = 0; offset < records.length; offset += 10) {
      const batch = await Promise.all(
        records.slice(offset, offset + 10).map(async (r) => {
          const scope = scopes.get(r.owner_id);
          if (!scope?.active || !scope.review_consent) return null;
          const review = await db
            .from("cohort_review_events")
            .select("content")
            .eq("owner_id", r.owner_id)
            .eq("record_id", r.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (review.error) throw new Error("UNAVAILABLE");
          let activity = cohortActivitySchema.parse(readCipher<CohortActivity>(r.content));
          if (activity.sourceReference) {
            const source = await db.from("native_log_drafts").select(nativeColumns).eq("owner_id", r.owner_id).eq("id", activity.sourceReference.draftId).maybeSingle();
            if (source.error || !source.data) throw new Error("UNAVAILABLE");
            // Resolve only this exception's supporting messages, never the person's whole day.
            activity = resolveActivitySource(r.owner_id, source.data as unknown as NativeRow, activity).activity;
          }
          return {
            id: r.id,
            owner: r.owner_id,
            name: nameFor.get(r.owner_id) ?? "Participant",
            digest: r.content.digest,
            status: r.review_status,
            activity,
            timezone: String(scope.timezone),
            review: review.data
              ? readCipher<{ rationale: string; question?: string }>(
                  review.data.content,
                )
              : null,
          };
        }),
      );
      permitted.push(...batch.filter((r) => r !== null));
    }
    const roster = [];
    for (const e of (enrollments.data ?? []).slice(0,50)) {
      const m = await db
        .from("cohort_memberships")
        .select("community_id")
        .eq("owner_id", e.owner_id)
        .is("revoked_at", null);
      if (m.error) throw new Error("UNAVAILABLE");
      roster.push({ ...e, communities: m.data.map((c) => c.community_id) });
    }
    return privateJson({
      page,
      more: [enrollments, invitations, exceptions, requests].some(
        (r) => (r.data?.length ?? 0) > 50,
      ),
      roster,
      communities: communities.data,
      invitations: invitations.data.slice(0, 50),
      exceptions: permitted,
      requests: (requests.data ?? []).slice(0, 50).map((r) => ({
        id: r.id,
        owner: r.owner_id,
        requestedBy: nameFor.get(String(r.owner_id)) ?? "Participant",
        did: didFor.get(String(r.owner_id)) ?? "",
        ...readCipher<{ name: string; reason: string }>(r.metadata.content),
      })),
      agent: agent.data,
    });
  } catch (error) {
    return cohortFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { session, input } = await cohortRequest(request);
    if (!(await isCohortAdmin(session.user.id)))
      throw new Error("UNAUTHORIZED");
    const checked = command.safeParse(input);
    if (!checked.success) throw new Error("INVALID_INPUT");
    const c = checked.data;
    if (c.action === "designate_dated_account") {
      const result = await adminClient().rpc("designate_dated_account", { p_actor: session.user.id, p_did: c.did, p_policy: c.policy, p_house: c.house, p_reference: c.reference });
      if (result.error) throw new Error(result.error.message.includes("POLICY_ALREADY_ACCEPTED") ? "POLICY_ALREADY_ACCEPTED" : "INVALID_INPUT");
      return privateJson({ saved: true });
    }
    if (c.action === "invite") {
      if (!cohortEnrollmentOpen()) throw new Error("WRITING_PAUSED");
      const token = randomBytes(32).toString("base64url");
      await cohortCommand(session.user.id, "invite", {
        id: randomUUID(),
        hash: inviteHash(token),
        did: c.did,
        communities: c.communities,
      });
      return privateJson({
        saved: true,
        path: `/onboarding/field-station?invite=${token}`,
      });
    }
    if (c.action === "human_review") {
      const db = adminClient(),
        r = await db
          .from("cohort_records")
          .select("*")
          .eq("id", c.recordId)
          .single();
      if (r.error || !r.data) throw new Error("UNAUTHORIZED");
      const record = r.data as CohortRecord,
        scope = await loadCohort(record.owner_id);
      if (!scope) throw new Error("UNAUTHORIZED");
      if (
        cohortReviewBlockers(
          cohortActivitySchema.parse(readCipher(record.content)),
          scope.context.workCommunities.map((x) => x.id),
          scope.enrollment.boundary_at,
        ).length
      )
        throw new Error("INVALID_INPUT");
      await cohortCommand(session.user.id, "human_review", {
        id: randomUUID(),
        recordId: c.recordId,
        digest: c.digest,
        permissionsRevision: scope.enrollment.permissions_revision,
        content: encryptNarrative(
          JSON.stringify({ rationale: c.rationale, model: null }),
        ),
      });
      await replayCohort(record.owner_id);
    } else await cohortCommand(session.user.id, c.action, c);
    return privateJson({ saved: true });
  } catch (error) {
    return cohortFailure(error);
  }
}
