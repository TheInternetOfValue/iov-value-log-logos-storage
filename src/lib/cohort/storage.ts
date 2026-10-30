import {
  cohortReplayPatch,
  materialiseCohortReplay,
  type StoredCohortReplay,
} from "./replay-storage";
// Trusted server/background-worker core. Never import into a client component.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin-core";
import {
  decryptNarrative,
  encryptNarrative,
  narrativeDigest,
} from "@/lib/crypto";
import {
  calculateCohortReplay,
  verifyCohortReplay,
  cohortActivitySchema,
  cohortReviewBlockers,
  type CohortActivity,
  type ReviewedActivity,
  type salaryRate,
} from "./policy";
import {
  activityInstants,
  draftQuestions,
  type NativeDraft,
} from "@/lib/native-log/draft";
import { type NativeReceipt } from "@/lib/native-log/storage-core";
import { calculateDatedReplay, verifyDatedReplay, isDatedPolicy, cohortPolicyStageOpen } from "@/lib/field-station/dated-policy";

export const cohortEnrollmentOpen = () =>
  process.env.VALUE_LOG_COHORT_ENROLLMENT === "open";
export const cohortReviewOpen = () =>
  process.env.VALUE_LOG_COHORT_REVIEW === "open";
export const cohortCalculationOpen = () =>
  process.env.VALUE_LOG_COHORT_CALCULATION === "open";
type Cipher = ReturnType<typeof encryptNarrative>;
export function readCipher<T>(input: Cipher): T {
  return JSON.parse(decryptNarrative(input)) as T;
}
export type CohortEnrollment = {
  owner_id: string;
  did: string;
  house_id: string;
  timezone: string;
  boundary_at: string;
  consent_at: string;
  policy_id: string;
  review_consent: boolean;
  active: boolean;
  revision: number;
  permissions_revision: number;
  calculated_revision: number;
  current_replay_id: string | null;
};
export type CohortRecord = {
  id: string;
  owner_id: string;
  native_draft_id: string;
  occurrence_id: string;
  revision: number;
  start_at: string;
  end_at: string;
  content: Cipher;
  review_status:
    | "pending"
    | "clarification"
    | "escalated"
    | "reviewed"
    | "superseded";
  rate_policy_id: string | null;
  created_at: string;
};
export async function ownerRows<T>(
  table: string,
  owner: string,
  columns = "*",
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 25000; offset += 500) {
    const r = await adminClient()
      .from(table)
      .select(columns)
      .eq("owner_id", owner)
      .order("id")
      .range(offset, offset + 499);
    if (r.error) throw new Error("UNAVAILABLE");
    rows.push(...((r.data ?? []) as T[]));
    if ((r.data?.length ?? 0) < 500) return rows;
  }
  throw new Error("HISTORY_REQUIRES_PAGED_EXPORT"); // Never return a silently truncated history.
}
export async function loadCohort(owner: string) {
  const db = adminClient(),
    res = await db
      .from("cohort_enrollments")
      .select("*")
      .eq("owner_id", owner)
      .maybeSingle();
  // Closed-by-default feature can coexist with a pre-migration deployment.
  if (res.error) {
    if (
      !cohortEnrollmentOpen() &&
      !cohortReviewOpen() &&
      !cohortCalculationOpen() &&
      ["42P01", "PGRST205"].includes(res.error.code)
    )
      return null;
    throw new Error("UNAVAILABLE");
  }
  if (!res.data) return null;
  const enrollment = res.data as CohortEnrollment;
  const memberships = await db
    .from("cohort_memberships")
    .select("community_id")
    .eq("owner_id", owner)
    .is("revoked_at", null);
  if (memberships.error) throw new Error("UNAVAILABLE");
  const ids = (memberships.data ?? []).map((x) => String(x.community_id));
  const communities = ids.length
    ? await db
        .from("cohort_communities")
        .select("id,name,kind")
        .in("id", ids)
        .eq("active", true)
    : { data: [], error: null };
  if (communities.error) throw new Error("UNAVAILABLE");
  return {
    enrollment,
    communities: (communities.data ?? []) as Array<{
      id: string;
      name: string;
      kind: string;
    }>,
    context: {
      policyId: enrollment.policy_id,
      houseId: enrollment.house_id,
      houseName:
        (communities.data ?? []).find((c) => c.id === enrollment.house_id)
          ?.name ?? "Wellbecoming community",
      workCommunities: (communities.data ?? [])
        .filter((c) => c.kind === "work")
        .map((c) => ({ id: String(c.id), name: String(c.name) })),
    },
  };
}
export async function isCohortAdmin(owner: string) {
  const r = await adminClient().rpc("cohort_is_admin", { p_actor: owner });
  return !r.error && r.data === true;
}
export async function cohortCommand(
  owner: string,
  action: string,
  input: unknown,
) {
  const r = await adminClient().rpc("cohort_command", {
    p_actor: owner,
    p_action: action,
    p_input: input,
  });
  if (r.error) {
    const code = [
      "UNAUTHORIZED",
      "REVISION_CONFLICT",
      "INVITATION_UNAVAILABLE",
      "COHORT_FULL",
      "CONSENT_REQUIRED",
      "INVALID_INPUT",
      "RATE_LIMITED",
      "MEMBERSHIP_REQUIRED",
    ].find((c) => r.error!.message.includes(c));
    throw new Error(code ?? "UNAVAILABLE");
  }
  return r.data;
}
export async function prepareCohortConfirmation(
  owner: string,
  draft: NativeDraft,
  sourceDraftId?: string,
) {
  const cohort = await loadCohort(owner);
  if (!cohort?.enrollment.active || !cohort.enrollment.review_consent)
    throw new Error("UNAUTHORIZED");
  if (
    draft.cohort?.policyId !== cohort.enrollment.policy_id ||
    draft.cohort.houseId !== cohort.enrollment.house_id
  )
    throw new Error("REVIEW_REQUIRED");
  const document = { ...draft, cohort: cohort.context };
  if (
    !draft.transcript.trim() ||
    !draft.activities.length ||
    draftQuestions(document).length
  )
    throw new Error("REVIEW_REQUIRED");
  const entries = draft.activities.map((a) => {
    const { start, end } = activityInstants(a, draft.timezone);
    if (!start || !end) throw new Error("TIME_REQUIRES_REVIEW");
    const id = randomUUID(),
      activity = cohortActivitySchema.parse({
        id,
        occurrenceId: a.id,
        start,
        end,
        activity: a.activity,
        node: a.node,
        quote: a.sourceQuote,
        context: a.context,
        proof: [a.proof,a.timeNote].filter(Boolean).join("\n"),
        workCommunity: a.node === "Performance" ? a.community : null,
        lane: a.node === "Performance" ? a.lane : null,
        direction: a.direction || null,
        intensity: a.direction === "neutral" ? null : a.intensity || null,
        confidence: a.confidence || null,
        sleepRest: a.sleepRest,
        followUpAnswers: sourceDraftId ? undefined : (draft.conversation ?? [])
          .filter((reply) => !reply.activityId || reply.activityId === a.id)
          .map(({ id, text }) => ({ id, text })),
        sourceReference: sourceDraftId ? { draftId: sourceDraftId, documentRevision: draft.revision, replyIds: (draft.conversation ?? []).filter(reply => !reply.activityId || reply.activityId === a.id).map(reply => reply.id) } : undefined,
        manualFields: a.manualFields,
      });
    if (
      cohortReviewBlockers(
        activity,
        cohort.context.workCommunities.map((c) => c.id),
        cohort.enrollment.boundary_at,
      ).length
    )
      throw new Error("REVIEW_REQUIRED");
    return {
      id,
      occurrenceId: activity.occurrenceId,
      start,
      end,
      content: encryptNarrative(JSON.stringify(activity)),
    };
  });
  const receipt: NativeReceipt = {
    kind: "cohort_review_pending",
    ...(sourceDraftId ? { sourceReferenced: true } : {}),
    count: entries.length,
    ids: entries.map((x) => x.id),
    dates: [
      ...new Set(
        entries.map((x) =>
          new Intl.DateTimeFormat("en-CA", {
            timeZone: draft.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(x.start)),
        ),
      ),
    ],
    timezone: draft.timezone,
  };
  return { entries, receipt };
}
type ReplayRow = {
  id: string;
  content: Cipher;
  created_at: string;
  output_digest: string;
};
async function readReplayHistory(owner: string, currentId: string | null) {
  if (!currentId)
    return {
      rows: [] as ReplayRow[],
      plain: new Map<string, StoredCohortReplay>(),
      current: null,
    };
  const rows = await ownerRows<ReplayRow>(
      "cohort_replay_runs",
      owner,
      "id,content,created_at,output_digest",
    ),
    plain = new Map(
      rows.map((r) => [r.id, readCipher<StoredCohortReplay>(r.content)]),
    );
  const head = rows.find((r) => r.id === currentId);
  if (!head) throw new Error("REPLAY_CHAIN_INCOMPLETE");
  const output = materialiseCohortReplay(currentId, plain);
  if (narrativeDigest(JSON.stringify(output)) !== head.output_digest)
    throw new Error("REPLAY_VERIFICATION_FAILED");
  return { rows, plain, current: { output, createdAt: head.created_at } };
}
export async function cohortSnapshot(owner: string) {
  const cohort = await loadCohort(owner);
  if (!cohort) return null;
  const db = adminClient(),
    [records, run, reviews, rates, agent] = await Promise.all([
      ownerRows<CohortRecord>("cohort_records", owner),
      readReplayHistory(owner, cohort.enrollment.current_replay_id),
      ownerRows<{
        id: string;
        record_id: string;
        actor_id: string;
        outcome: string;
        content: Cipher;
        created_at: string;
      }>(
        "cohort_review_events",
        owner,
        "id,record_id,actor_id,outcome,content,created_at",
      ),
      ownerRows<{ id: string; effective_at: string; content: Cipher }>(
        "cohort_rate_policies",
        owner,
      ),
      db
        .from("cohort_agents")
        .select("active")
        .eq("id", "system:field-station-reviewer:v1")
        .single(),
    ]);
  if (agent.error) throw new Error("UNAVAILABLE");
  return {
    ...cohort,
    processing: {
      reviewEnabled: cohortPolicyStageOpen(cohort.enrollment.policy_id, "REVIEW"),
      calculationEnabled: cohortPolicyStageOpen(cohort.enrollment.policy_id, "CALCULATION"),
      operatorReady: agent.data?.active === true,
    },
    records: records
      .toSorted(
        (a, b) =>
          a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id),
      )
      .map((r) => ({
        ...r,
        content: undefined,
        activity: cohortActivitySchema.parse(
          readCipher<CohortActivity>(r.content),
        ),
      })),
    state: run.current?.output ?? (isDatedPolicy(cohort.enrollment.policy_id) ? calculateDatedReplay([], cohort.enrollment.policy_id) : calculateCohortReplay([])),
    rateVersions: rates
      .toSorted((a, b) => b.effective_at.localeCompare(a.effective_at))
      .map((r) => ({
        id: r.id,
        effectiveAt: r.effective_at,
        ...readCipher<{
          salary: { annualGross: string; currency: string };
          rate: ReturnType<typeof salaryRate>;
        }>(r.content),
      })),
    calculatedAt: run.current?.createdAt ?? null,
    reviews: reviews
      .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({
        ...r,
        content: readCipher<{
          rationale: string;
          question?: string;
          model?: string;
        }>(r.content),
      })),
  };
}
/** One participant's unresolved records stop only that participant's chronology. */
export async function replayCohort(owner: string) {
  const db = adminClient(),
    cohort = await loadCohort(owner);
  if (!cohort?.enrollment.active || !cohort.enrollment.review_consent) return;
  if (!cohortPolicyStageOpen(cohort.enrollment.policy_id, "CALCULATION")) return;
  if (isDatedPolicy(cohort.enrollment.policy_id)) {
    const untimed = await db.from("native_log_day_index").select("source_id").eq("owner_id", owner).eq("outcome", "clarification").eq("source_kind", "native").is("superseded_at", null).limit(1);
    if (untimed.error) throw new Error("UNAVAILABLE"); if (untimed.data?.length) return;
  }
  if (cohort.enrollment.calculated_revision === cohort.enrollment.revision)
    return;
  const unresolved = await db
    .from("cohort_records")
    .select("id")
    .eq("owner_id", owner)
    .in("review_status", ["pending", "clarification", "escalated"])
    .limit(1);
  if (unresolved.error) throw new Error("UNAVAILABLE");
  if (unresolved.data?.length) return;
  const [records, reviews, rates] = await Promise.all([
    ownerRows<CohortRecord>("cohort_records", owner),
    ownerRows<{
      id: string;
      record_id: string;
      outcome: string;
      input_digest: string;
      created_at: string;
    }>(
      "cohort_review_events",
      owner,
      "id,record_id,outcome,input_digest,created_at",
    ),
    ownerRows<{ id: string; content: Cipher }>(
      "cohort_rate_policies",
      owner,
      "id,content",
    ),
  ]);
  const activeRecords = records
    .filter((r) => r.review_status !== "superseded")
    .toSorted(
      (a, b) =>
        a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id),
    );
  if (activeRecords.some((r) => r.review_status !== "reviewed")) return; // Keep the last promoted score while a correction or appeal is pending.
  const selected: ReviewedActivity[] = [];
  for (const r of activeRecords) {
    if (r.review_status !== "reviewed") break;
    const review = reviews
      .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      .findLast(
        (x) =>
          x.record_id === r.id &&
          x.outcome === "reviewed" &&
          x.input_digest === r.content.digest,
      );
    if (!review) throw new Error("UNAVAILABLE");
    const rate = rates.find((x) => x.id === r.rate_policy_id);
    selected.push({
      recordId: r.id,
      reviewId: String(review.id),
      activity: cohortActivitySchema.parse(readCipher(r.content)),
      rate: rate
        ? readCipher<{ rate: ReturnType<typeof salaryRate> }>(rate.content).rate
        : null,
    });
  }
  const input = narrativeDigest(
      JSON.stringify({
        policy: cohort.enrollment.policy_id,
        boundary: cohort.enrollment.boundary_at,
        selected,
      }),
    ),
    output = isDatedPolicy(cohort.enrollment.policy_id) ? calculateDatedReplay(selected, cohort.enrollment.policy_id) : calculateCohortReplay(selected);
  const verify = isDatedPolicy(cohort.enrollment.policy_id) ? (value: typeof output) => verifyDatedReplay(selected, value, cohort.enrollment.policy_id) : (value: typeof output) => verifyCohortReplay(selected, value);
  if (!verify(output))
    throw new Error("REPLAY_VERIFICATION_FAILED");
  const previous = await readReplayHistory(
      owner,
      cohort.enrollment.current_replay_id,
    ),
    id = randomUUID();
  const patch = cohortReplayPatch(
    output,
    previous.current?.output ?? null,
    cohort.enrollment.current_replay_id,
  );
  previous.plain.set(id, patch);
  const verified = materialiseCohortReplay(id, previous.plain);
  if (
    JSON.stringify(verified) !== JSON.stringify(output) ||
    !verify(verified)
  )
    throw new Error("REPLAY_VERIFICATION_FAILED");
  const result = await db.rpc("promote_cohort_replay", {
    p_owner: owner,
    p_revision: cohort.enrollment.revision,
    p_id: id,
    p_input: input,
    p_output: narrativeDigest(JSON.stringify(output)),
    p_content: encryptNarrative(JSON.stringify(patch)),
  });
  if (result.error) throw new Error("UNAVAILABLE");
}
export const inviteHash = (token: string) =>
  narrativeDigest(`cohort-invitation:v1:${token}`);
export async function readInvitation(token: string, did: string) {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token))
    throw new Error("INVITATION_UNAVAILABLE");
  const db = adminClient(),
    r = await db
      .from("cohort_invitations")
      .select("id,target_did,community_ids,expires_at,revoked_at,redeemed_by")
      .eq("token_hash", inviteHash(token))
      .maybeSingle();
  if (
    r.error ||
    !r.data ||
    r.data.revoked_at ||
    Date.parse(r.data.expires_at) <= Date.now() ||
    (r.data.target_did && r.data.target_did !== did)
  )
    throw new Error("INVITATION_UNAVAILABLE");
  const cs = await db
    .from("cohort_communities")
    .select("id,name,kind")
    .eq("active", true)
    .or(
      `kind.eq.wellbecoming,id.in.(${(r.data.community_ids as string[]).filter((x) => /^[a-z][a-z0-9_-]{1,63}$/.test(x)).join(",") || "_none"})`,
    );
  if (cs.error) throw new Error("UNAVAILABLE");
  return { id: r.data.id, communities: cs.data };
}
export const cohortDecisionSchema = z
  .object({
    outcome: z.enum(["reviewed", "clarification", "escalated"]),
    rationale: z.string().min(1).max(2000),
    question: z.string().max(500),
    evidenceQuotes: z.array(z.string().min(1).max(1000)).max(10),
  })
  .strict();
