import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { client, provider, coverage, coverageEnabled } = vi.hoisted(() => ({
  client: vi.fn(),
  provider: vi.fn(),
  coverage: vi.fn(),
  coverageEnabled: vi.fn(),
}));
vi.mock("@/lib/supabase/admin-core", () => ({ adminClient: client }));
vi.mock("./sarvam-core", () => ({ structureWithSarvam: provider }));
vi.mock("./coverage", () => ({
  coverageOpen: coverageEnabled,
  checkNarrationCoverage: coverage,
}));
import { runNativeStructure } from "./structure-worker";
import { nativeJobSignature } from "./job";
import { encryptNarrative, decryptNarrative } from "@/lib/crypto";
import { nativeOwnerScope } from "./storage-core";
import { emptyNativeActivity, newNativeDraft } from "./draft";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  lease = "33333333-3333-4333-8333-333333333333";
function setup(activities: Array<ReturnType<typeof emptyNativeActivity>> = [], extra: { conversation?: Array<{ id: string; activityId: string | null; text: string }>; unmatchedRows?: number } = {}) {
  const document = {
    ...newNativeDraft(
      nativeOwnerScope(owner),
      "2026-10-25",
      "Asia/Kolkata",
      "personal",
    ),
    transcript: "Synthetic words",
    activities,
    ...(extra.conversation ? { conversation: extra.conversation } : {}),
  };
  const e = encryptNarrative(
    JSON.stringify({ document, parts: {}, totalParts: null, ...(extra.unmatchedRows ? { unmatchedRows: extra.unmatchedRows } : {}) }),
  );
  let claimed = false;
  const row = {
    id,
    revision: 2,
    status: "draft",
    content_ciphertext: e.ciphertext,
    content_iv: e.iv,
    content_auth_tag: e.authTag,
  };
  const eq = vi.fn(),
    rpc = vi.fn<
      (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: number | boolean; error: null }>
    >(async name => ({ data: name === "consume_ingestion_rate_limit" ? true : 3, error: null }));
  const q = {
    update: vi.fn(() => q),
    eq: (...args: unknown[]) => {
      eq(...args);
      return q;
    },
    gt: () => q,
    select: () => q,
    maybeSingle: async () => {
      if (claimed) return { data: null, error: null };
      claimed = true;
      return { data: row, error: null };
    },
  };
  client.mockReturnValue({ from: () => q, rpc });
  const raw = JSON.stringify({
    owner,
    id,
    revision: 2,
    lease,
    expires: Date.now() + 120000,
  });
  return { raw, eq, rpc, q, document };
}
beforeEach(() => {
  vi.stubEnv("VALUE_LOG_NATIVE_LOGGING", "open");
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-native-job-digest-key-more-than-thirty-two",
  );
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 8).toString("base64"),
  );
  client.mockReset();
  provider.mockReset();
  coverage.mockReset();
  coverageEnabled.mockReset();
  coverageEnabled.mockReturnValue(false);
});
afterEach(() => vi.unstubAllEnvs());
describe("standalone proposal job", () => {
  it("claims owner/id/revision/lease once and saves proposals without confirming an activity", async () => {
    const h = setup();
    provider.mockResolvedValue([
      { ...emptyNativeActivity(id), activity: "Synthetic walk" },
    ]);
    await runNativeStructure(h.raw, nativeJobSignature(h.raw));
    await runNativeStructure(h.raw, nativeJobSignature(h.raw));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(h.eq).toHaveBeenCalledWith("owner_id", owner);
    expect(h.eq).toHaveBeenCalledWith("lease_token", lease);
    expect(h.eq).toHaveBeenCalledWith("revision", 2);
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual([
      "save_native_log_draft",
      "release_native_log_processing",
    ]);
  });
  it("preserves words and stores only a safe failure classification", async () => {
    const h = setup();
    provider.mockRejectedValue(new Error("PRIVATE_PROVIDER_BODY"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runNativeStructure(h.raw, nativeJobSignature(h.raw));
    const content = h.rpc.mock.calls[0][1].p_content as {
      ciphertext: string;
      iv: string;
      authTag: string;
    };
    const saved = JSON.parse(decryptNarrative(content));
    expect(saved.document.transcript).toBe("Synthetic words");
    expect(saved.processingError).toBe("PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "PRIVATE_PROVIDER_BODY",
    );
    warn.mockRestore();
  });
  it("rejects unsigned dispatch and closes new work when authoring is paused", async () => {
    const h = setup();
    await expect(runNativeStructure(h.raw, "wrong")).rejects.toThrow(
      "UNAUTHORIZED",
    );
    expect(provider).not.toHaveBeenCalled();
    vi.stubEnv("VALUE_LOG_NATIVE_LOGGING", "closed");
    await runNativeStructure(h.raw, nativeJobSignature(h.raw));
    expect(h.q.update).not.toHaveBeenCalled();
  });
});

it("a signed completeness-only job checks the copied version without regenerating or approving its facts", async () => {
  const activity = {
    ...emptyNativeActivity(id),
    activity: "Synthetic walk",
    sourceQuote: "Synthetic words",
  };
  const h = setup([activity]);
  coverageEnabled.mockReturnValue(true);
  coverage.mockResolvedValue({
    version: 1,
    sourceDigest: "a",
    proposalDigest: "b",
    checkedAt: "now",
    complete: true,
    missing: 0,
  });
  const raw = JSON.stringify({ ...JSON.parse(h.raw), operation: "coverage" });
  await runNativeStructure(raw, nativeJobSignature(raw));
  expect(provider).not.toHaveBeenCalled();
  expect(coverage).toHaveBeenCalledTimes(1);
  const call = h.rpc.mock.calls.find((c) => c[0] === "save_native_log_draft")!;
  const stored = JSON.parse(
    decryptNarrative(
      call[1].p_content as Parameters<typeof decryptNarrative>[0],
    ),
  );
  expect(stored.document.activities).toEqual([activity]);
  expect(stored.document.reviewedRevision).toBeNull();
  expect(stored.coverage.complete).toBe(true);
});

it("stores how many rows a fresh table left out, and a follow-up keeps that count", async () => {
  const stored = (h: ReturnType<typeof setup>) => {
    const call = h.rpc.mock.calls.find((c) => c[0] === "save_native_log_draft")!;
    return JSON.parse(decryptNarrative(call[1].p_content as Parameters<typeof decryptNarrative>[0]));
  };
  const walk = { ...emptyNativeActivity(id), activity: "Synthetic walk", sourceQuote: "Synthetic words" };
  const fresh = setup();
  provider.mockImplementation(async (_draft: unknown, _signal: unknown, report: { unmatched: number }) => { report.unmatched = 2; return [walk]; });
  await runNativeStructure(fresh.raw, nativeJobSignature(fresh.raw));
  expect(stored(fresh).unmatchedRows).toBe(2);
  provider.mockReset();
  const followUp = setup([walk], { conversation: [{ id: "44444444-4444-4444-8444-444444444444", activityId: null, text: "Also lunch" }], unmatchedRows: 2 });
  provider.mockImplementation(async (_draft: unknown, _signal: unknown, report: { unmatched: number }) => { report.unmatched = 1; return [walk]; });
  await runNativeStructure(followUp.raw, nativeJobSignature(followUp.raw));
  expect(stored(followUp).unmatchedRows).toBe(2);
});
