import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { client, provider, context, replay } = vi.hoisted(() => ({
  client: vi.fn(),
  provider: vi.fn(),
  context: vi.fn(),
  replay: vi.fn(),
}));
vi.mock("@/lib/supabase/admin-core", () => ({ adminClient: client }));
vi.mock("@/lib/native-log/sarvam-core", () => ({
  structuredSarvam: provider,
  SARVAM_CHAT_MODEL: "sarvam-105b-conversations",
}));
vi.mock("./storage", async (original) => ({
  ...(await original<typeof import("./storage")>()),
  loadCohort: context,
  replayCohort: replay,
}));
import { runCohortReview, reviewSignature } from "./review-worker";
import { encryptNarrative, decryptNarrative } from "@/lib/crypto";
const owner = "10000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000002";
function setup(quota = true) {
  const activity = {
    id,
    occurrenceId: id,
    start: "2026-10-25T08:00:00Z",
    end: "2026-10-25T09:00:00Z",
    activity: "Synthetic walk",
    node: "Physiology",
    quote: "I walked and felt slightly better.",
    context: "",
    proof: "",
    workCommunity: null,
    lane: null,
    direction: "positive",
    intensity: "low",
    confidence: "observed",
    sleepRest: false,
  };
  const record = {
    id,
    owner_id: owner,
    content: encryptNarrative(JSON.stringify(activity)),
    lease_context_revision: 1,
  };
  const eq = vi.fn(),
    query = {
      select: () => query,
      or: () => query,
      eq: (...args: unknown[]) => {
        eq(...args);
        return query;
      },
      order: () => query,
      limit: async () => ({ data: [{ id }], error: null }),
      update: vi.fn(() => query),
      then: (done: (x: unknown) => unknown) =>
        Promise.resolve(done({ data: null, error: null })),
    };
  let claimed = false;
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_cohort_review") {
      if (claimed) return { data: null, error: null };
      claimed = true;
      return {
        data: {
          record,
          delegation: { id },
          agent: { operator_did: "did:iov:member:synthetic", version: 1 },
        },
        error: null,
      };
    }
    return {
      data: name === "consume_ingestion_rate_limit" ? quota : true,
      error: null,
    };
  });
  client.mockReturnValue({ from: () => query, rpc });
  context.mockResolvedValue({
    enrollment: {
      active: true,
      review_consent: true,
      house_id: "house_of_sis",
      timezone: "Asia/Kolkata",
      permissions_revision: 1,
      boundary_at: "2026-10-25T00:00:00Z",
      policy_id: "field-station-assumed-700-v1",
    },
    context: { workCommunities: [] },
    communities: [{ id: "house_of_sis" }],
  });
  provider.mockResolvedValue({
    decisions: [
      {
        recordId: id,
        supportedNode: "Physiology",
        decision: {
          outcome: "reviewed",
          rationale: "The participant explicitly reported this effect.",
          question: "",
          evidenceQuotes: [activity.quote],
        },
      },
    ],
  });
  const raw = JSON.stringify({ owner, expires: Date.now() + 120000 });
  return { raw, record, rpc, query, eq };
}
beforeEach(() => {
  vi.stubEnv("VALUE_LOG_COHORT_REVIEW", "open");
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-review-operation-key-over-thirty-two",
  );
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 7).toString("base64"),
  );
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("reviews only a claimed immutable approval and keeps system/operator/delegation identities distinct", async () => {
  const h = setup();
  await runCohortReview(h.raw, reviewSignature(h.raw));
  await runCohortReview(h.raw, reviewSignature(h.raw));
  expect(provider).toHaveBeenCalledTimes(1);
  expect(provider.mock.calls[0][3]).toMatchObject({
    timezone: "Asia/Kolkata",
    wellbecomingCommunity: "house_of_sis",
  });
  expect(provider.mock.calls[0][3].records[0].activity).not.toHaveProperty(
    "node",
  );
  const finish = h.rpc.mock.calls.find(
    ([name]) => name === "finish_cohort_review",
  );
  expect(finish).toBeDefined();
  const input = (finish as unknown as [string, Record<string, unknown>])[1];
  expect(input.p_owner).toBe(owner);
  expect(input.p_digest).toBe(h.record.content.digest);
  expect(input.p_delegation).toBe(id);
  const decision = JSON.parse(
    decryptNarrative(input.p_content as Parameters<typeof decryptNarrative>[0]),
  );
  expect(decision.actor).toBe("system:field-station-reviewer:v1");
  expect(decision.operatorDid).toBe("did:iov:member:synthetic");
  expect(decision.assurance).toBe("participant_report_automated_policy_review");
  expect(decision).not.toHaveProperty("salary");
});
it("keeps records pending on provider failure and releases only its own lease without logging content", async () => {
  const h = setup();
  provider.mockRejectedValue(new Error("PRIVATE_NARRATIVE_FROM_PROVIDER"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await runCohortReview(h.raw, reviewSignature(h.raw));
  expect(
    h.rpc.mock.calls.some(([name]) => name === "finish_cohort_review"),
  ).toBe(false);
  expect(h.query.update).toHaveBeenCalledWith(
    expect.objectContaining({
      lease_token: null,
      lease_until: null,
      retry_after: expect.any(String),
    }),
  );
  expect(h.eq).toHaveBeenCalledWith("owner_id", owner);
  expect(h.eq).toHaveBeenCalledWith("lease_token", expect.any(String));
  expect(JSON.stringify(warn.mock.calls)).not.toContain(
    "PRIVATE_NARRATIVE_FROM_PROVIDER",
  );
});
it("defers processing at the quota without a model call and closes new work when disabled", async () => {
  const h = setup(false);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await runCohortReview(h.raw, reviewSignature(h.raw));
  expect(provider).not.toHaveBeenCalled();
  expect(
    h.rpc.mock.calls.some(([name]) => name === "finish_cohort_review"),
  ).toBe(false);
  vi.stubEnv("VALUE_LOG_COHORT_REVIEW", "closed");
  client.mockClear();
  await runCohortReview(h.raw, reviewSignature(h.raw));
  expect(client).not.toHaveBeenCalled();
});

it("reads permissions after claiming and rejects a changed context before calling the model", async () => {
  const h = setup();
  const current = await context();
  context.mockResolvedValueOnce(current).mockImplementation(async () => {
    expect(
      h.rpc.mock.calls.some(([name]) => name === "claim_cohort_review"),
    ).toBe(true);
    return {
      ...current,
      enrollment: { ...current.enrollment, permissions_revision: 2 },
    };
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await runCohortReview(h.raw, reviewSignature(h.raw));
  expect(provider).not.toHaveBeenCalled();
  expect(
    h.rpc.mock.calls.some(([name]) => name === "finish_cohort_review"),
  ).toBe(false);
  expect(h.query.update).toHaveBeenCalled();
});
