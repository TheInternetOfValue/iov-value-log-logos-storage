import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin-core", () => ({ adminClient: admin }));
import {
  loadCohort,
  prepareCohortConfirmation,
  readCipher,
  replayCohort,
} from "./storage";
import { emptyNativeActivity, newNativeDraft } from "@/lib/native-log/draft";
import { calculateCohortReplay, type CohortActivity } from "./policy";
import { encryptNarrative, narrativeDigest } from "@/lib/crypto";
import type { CohortReplayPatch } from "./replay-storage";
const owner = "10000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000002";
function setup({
  error = null as { code: string } | null,
  calculated = 0,
  pending = false,
} = {}) {
  const tables: string[] = [],
    range = vi.fn();
  admin.mockReturnValue({
    from: (table: string) => {
      tables.push(table);
      const data =
        table === "cohort_enrollments"
          ? {
              owner_id: owner,
              policy_id: "field-station-assumed-700-v1",
              house_id: "house_of_sis",
              timezone: "Asia/Kolkata",
              active: true,
              review_consent: true,
              boundary_at: "2026-10-25T00:00:00Z",
              revision: 2,
              calculated_revision: calculated,
            }
          : table === "cohort_memberships"
            ? [{ community_id: "house_of_sis" }]
            : table === "cohort_communities"
              ? [
                  {
                    id: "house_of_sis",
                    name: "HouseOfSis",
                    kind: "wellbecoming",
                  },
                ]
              : pending
                ? [{ id }]
                : [];
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        in: () => q,
        lte: () => q,
        order: () => q,
        range: () => {
          range();
          return q;
        },
        limit: () => q,
        maybeSingle: async () => ({ data: error ? null : data, error }),
        then: (done: (value: unknown) => unknown) =>
          Promise.resolve(done({ data, error: null })),
      };
      return q;
    },
  });
  return { tables, range };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VALUE_LOG_COHORT_ENROLLMENT", "closed");
  vi.stubEnv("VALUE_LOG_COHORT_REVIEW", "closed");
  vi.stubEnv("VALUE_LOG_COHORT_CALCULATION", "closed");
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-storage-key-over-thirty-two-characters",
  );
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 9).toString("base64"),
  );
});
afterEach(() => vi.unstubAllEnvs());
it("allows only an absent pre-migration table to fall back when closed, never an outage", async () => {
  setup({ error: { code: "PGRST205" } });
  expect(await loadCohort(owner)).toBeNull();
  setup({ error: { code: "57014" } });
  await expect(loadCohort(owner)).rejects.toThrow("UNAVAILABLE");
  vi.stubEnv("VALUE_LOG_COHORT_ENROLLMENT", "open");
  setup({ error: { code: "PGRST205" } });
  await expect(loadCohort(owner)).rejects.toThrow("UNAVAILABLE");
});
it("retains grounding answers and direct edits in the immutable confirmation and normalises neutral intensity", async () => {
  setup();
  const scope = (await loadCohort(owner))!;
  const d = {
    ...newNativeDraft("a".repeat(64), "2026-10-25", "Asia/Kolkata", "personal"),
    transcript: "Synthetic walk",
    cohort: scope.context,
    activities: [
      {
        ...emptyNativeActivity(id),
        activity: "Synthetic walk",
        node: "Physiology" as const,
        startLocal: "2026-10-25T08:00",
        endLocal: "2026-10-25T09:00",
        direction: "neutral" as const,
        intensity: "low" as const,
        confidence: "observed" as const,
        manualFields: ["direction" as const],
      },
    ],
    conversation: [{ id, activityId: id, text: "I noticed no change." }],
  };
  const prepared = await prepareCohortConfirmation(owner, d),
    a = readCipher<CohortActivity>(prepared.entries[0].content);
  expect(a.followUpAnswers).toEqual([{ id, text: "I noticed no change." }]);
  expect(a.manualFields).toEqual(["direction"]);
  expect(a.intensity).toBeNull();
  expect(prepared.receipt.kind).toBe("cohort_review_pending");
  await expect(
    prepareCohortConfirmation(owner, {
      ...d,
      cohort: { ...scope.context, houseId: "house_of_bros" },
    }),
  ).rejects.toThrow("REVIEW_REQUIRED");
});
it("does not read complete history when unchanged or an earlier record is unresolved", async () => {
  vi.stubEnv("VALUE_LOG_COHORT_CALCULATION", "open");
  const a = setup({ calculated: 2 });
  await replayCohort(owner);
  expect(a.tables).not.toContain("cohort_records");
  expect(a.range).not.toHaveBeenCalled();
  const b = setup({ pending: true });
  await replayCohort(owner);
  expect(b.tables).toContain("cohort_records");
  expect(b.tables).not.toContain("cohort_review_events");
  expect(b.range).not.toHaveBeenCalled();
});

it("verifies a sparse replay before promotion and retains the full output digest", async () => {
  vi.stubEnv("VALUE_LOG_COHORT_CALCULATION", "open");
  const first: CohortActivity = {
    id,
    occurrenceId: id,
    activity: "Synthetic walk",
    quote: "I walked from eight to nine and noticed no change.",
    start: "2026-10-25T08:00:00Z",
    end: "2026-10-25T09:00:00Z",
    node: "Physiology",
    context: "",
    proof: "",
    direction: "neutral",
    intensity: null,
    confidence: "observed",
    sleepRest: false,
    workCommunity: null,
    lane: null,
  };
  const second = {
    ...first,
    id: "10000000-0000-4000-8000-000000000003",
    occurrenceId: "10000000-0000-4000-8000-000000000003",
    start: "2026-10-25T09:00:00Z",
    end: "2026-10-25T10:00:00Z",
  };
  const inputs = [first, second].map((activity, index) => ({
    recordId: activity.id,
    reviewId: `review-${index}`,
    activity,
    rate: null,
  }));
  const old = calculateCohortReplay(inputs.slice(0, 1)),
    output = calculateCohortReplay(inputs);
  const records = inputs.map((r) => ({
    id: r.recordId,
    owner_id: owner,
    review_status: "reviewed",
    start_at: r.activity.start,
    content: encryptNarrative(JSON.stringify(r.activity)),
    rate_policy_id: null,
  }));
  const rpc = vi.fn().mockResolvedValue({ error: null });
  admin.mockReturnValue({
    rpc,
    from: (table: string) => {
      let unresolved = false;
      const data =
        table === "cohort_enrollments"
          ? {
              owner_id: owner,
              active: true,
              review_consent: true,
              house_id: "house_of_sis",
              timezone: "Asia/Kolkata",
              boundary_at: "2026-10-25T00:00:00Z",
              revision: 4,
              calculated_revision: 2,
              current_replay_id: "old",
              policy_id: "field-station-assumed-700-v1",
            }
          : table === "cohort_memberships"
            ? [{ community_id: "house_of_sis" }]
            : table === "cohort_communities"
              ? [
                  {
                    id: "house_of_sis",
                    name: "HouseOfSis",
                    kind: "wellbecoming",
                  },
                ]
              : table === "cohort_records"
                ? records
                : table === "cohort_review_events"
                  ? inputs.map((r, i) => ({
                      id: r.reviewId,
                      record_id: r.recordId,
                      outcome: "reviewed",
                      input_digest: records[i].content.digest,
                      created_at: `2026-10-25T10:0${i}:00Z`,
                    }))
                  : table === "cohort_replay_runs"
                    ? [
                        {
                          id: "old",
                          content: encryptNarrative(JSON.stringify(old)),
                          created_at: "2026-10-25T10:00:00Z",
                          output_digest: narrativeDigest(JSON.stringify(old)),
                        },
                      ]
                    : [];
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        in: () => {
          unresolved = true;
          return q;
        },
        order: () => q,
        range: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data, error: null }),
        then: (done: (r: unknown) => unknown) =>
          Promise.resolve(
            done({
              data: unresolved && table === "cohort_records" ? [] : data,
              error: null,
            }),
          ),
      };
      return q;
    },
  });
  await replayCohort(owner);
  expect(rpc).toHaveBeenCalledOnce();
  const [name, args] = rpc.mock.calls[0];
  expect(name).toBe("promote_cohort_replay");
  expect(args.p_revision).toBe(4);
  expect(args.p_output).toBe(narrativeDigest(JSON.stringify(output)));
  const patch = readCipher<CohortReplayPatch>(args.p_content);
  expect(patch.format).toBe("cohort-replay-patch-v1");
  expect(patch.parentReplayId).toBe("old");
  expect(patch.events.map((e) => e.recordId)).toEqual([second.id]);
});
