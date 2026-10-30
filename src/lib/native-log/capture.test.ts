import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: client }));
import {
  queueApprovedCapture,
  captureContinuationId,
  captureContinuationIds,
  captureContinuationSlot,
} from "./capture";
import {
  nativeOwnerScope,
  readNativeContent,
  type NativeRow,
} from "./storage-core";
import { encryptNarrative, decryptNarrative } from "@/lib/crypto";
import { emptyNativeActivity, newNativeDraft } from "./draft";
const owner = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-capture-owner-key-longer-than-thirty-two",
  );
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 3).toString("base64"),
  );
  client.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
function row(): NativeRow {
  const document = {
    ...newNativeDraft(
      nativeOwnerScope(owner),
      "2026-10-25",
      "Asia/Kolkata",
      "pilot",
    ),
    transcript: "I walked at 8am. No effect was supplied.",
    activities: [
      {
        ...emptyNativeActivity(id),
        activity: "Walk",
        node: "Physiology" as const,
        startLocal: "2026-10-25T08:00",
        endLocal: "2026-10-25T08:30",
      },
    ],
  };
  const e = encryptNarrative(
    JSON.stringify({ document, parts: {}, totalParts: null }),
  );
  return {
    id,
    revision: 4,
    status: "draft",
    content_ciphertext: e.ciphertext,
    content_iv: e.iv,
    content_auth_tag: e.authTag,
    content_digest: e.digest,
    receipt: null,
    created_at: "2026-10-25T00:00:00Z",
    updated_at: "2026-10-25T00:00:00Z",
    removed_at: null,
  };
}
it("atomically captures explicit approval without inventing an impact or creating canonical records", async () => {
  const r = row(),
    eq = vi.fn(),
    or = vi.fn();
  let saved: Record<string, unknown> = {};
  const q = {
    update: (v: Record<string, unknown>) => {
      saved = v;
      return q;
    },
    eq: (...v: unknown[]) => {
      eq(...v);
      return q;
    },
    or: (...v: unknown[]) => {
      or(...v);
      return q;
    },
    select: () => q,
    maybeSingle: async () => ({ data: { ...r, ...saved }, error: null }),
  };
  const rpc = vi.fn();
  client.mockReturnValue({
    from: (table: string) => {
      expect(table).toBe("native_log_drafts");
      return q;
    },
    rpc,
  });
  const receipt = await queueApprovedCapture(
    owner,
    r,
    "I approve this account.",
    new Date("2026-10-26T00:00:00Z"),
  );
  expect(receipt?.kind).toBe("capture_review_pending");
  expect(receipt?.ids).toEqual([]);
  expect(saved.revision).toBe(5);
  expect(saved.status).toBe("submitted");
  expect(eq).toHaveBeenCalledWith("owner_id", owner);
  expect(eq).toHaveBeenCalledWith("revision", 4);
  expect(eq).toHaveBeenCalledWith("content_digest", r.content_digest);
  expect(or).toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
  const stored = JSON.parse(
    decryptNarrative({
      ciphertext: String(saved.content_ciphertext),
      iv: String(saved.content_iv),
      authTag: String(saved.content_auth_tag),
    }),
  );
  expect(stored.approval.contentDigest).toBe(r.content_digest);
  expect(stored.document.activities[0].direction).toBe("");
  expect(stored.document.reviewedRevision).toBe(stored.document.revision);
});
it("cannot approve another account's content, an invalid interval, or a stale revision", async () => {
  await expect(
    queueApprovedCapture(
      "44444444-4444-4444-8444-444444444444",
      row(),
      "approve",
    ),
  ).rejects.toThrow("ACCOUNT_CHANGED");
  const r = row();
  const content = readNativeContent(r);
  content.document.activities[0].endLocal = "2026-10-25T07:00";
  const e = encryptNarrative(JSON.stringify(content));
  const bad = {
    ...r,
    content_ciphertext: e.ciphertext,
    content_iv: e.iv,
    content_auth_tag: e.authTag,
  };
  await expect(queueApprovedCapture(owner, bad, "approve")).rejects.toThrow(
    "REVIEW_REQUIRED",
  );
  const q = {
    update: () => q,
    eq: () => q,
    or: () => q,
    select: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  client.mockReturnValue({ from: () => q });
  await expect(queueApprovedCapture(owner, r, "approve")).rejects.toThrow(
    "REVISION_CONFLICT",
  );
});
it("returns an existing immutable receipt on retry and derives one stable owner-row continuation", async () => {
  const r = row();
  r.status = "submitted";
  r.receipt = {
    kind: "capture_review_pending",
    ids: [],
    dates: ["2026-10-25"],
    count: 1,
    timezone: "Asia/Kolkata",
  };
  expect(await queueApprovedCapture(owner, r, "again")).toEqual(r.receipt);
  expect(client).not.toHaveBeenCalled();
  expect(captureContinuationId(id, 5)).toBe(captureContinuationId(id, 5));
  expect(captureContinuationId(id, 5)).not.toBe(captureContinuationId(id, 6));
});
it("recovers after a removed continuation and leaves exhausted histories readable", () => {
  const parent = { id, revision: 5 },
    ids = captureContinuationIds(parent);
  expect(captureContinuationSlot(parent, [])?.id).toBe(ids[0]);
  const removed = [{ id: ids[0], status: "removed" }];
  expect(captureContinuationSlot(parent, removed)?.generation).toBe(1);
  const draft = { id: ids[1], status: "draft" };
  expect(captureContinuationSlot(parent, [...removed, draft])?.row).toBe(draft);
  expect(
    captureContinuationSlot(
      parent,
      ids.map((id) => ({ id, status: "removed" })),
    ),
  ).toBeNull();
});
it("returns a concurrent receipt only when it approved the same content", async () => {
  const original = row();
  let approvedDigest = original.content_digest;
  const receipt = {
    kind: "capture_review_pending",
    ids: [],
    dates: ["2026-10-25"],
    count: 1,
    timezone: "Asia/Kolkata",
  };
  let reads = 0;
  const q = {
    update: () => q,
    eq: () => q,
    or: () => q,
    select: () => q,
    maybeSingle: async () => {
      if (reads++ % 2 === 0) return { data: null, error: null };
      const encrypted = encryptNarrative(
        JSON.stringify({
          ...readNativeContent(original),
          approval: { contentDigest: approvedDigest },
        }),
      );
      return {
        data: {
          ...original,
          status: "submitted",
          receipt,
          content_ciphertext: encrypted.ciphertext,
          content_iv: encrypted.iv,
          content_auth_tag: encrypted.authTag,
        },
        error: null,
      };
    },
  };
  client.mockReturnValue({ from: () => q });
  expect(await queueApprovedCapture(owner, original, "approve")).toEqual(
    receipt,
  );
  approvedDigest = "a different version";
  await expect(
    queueApprovedCapture(owner, original, "approve"),
  ).rejects.toThrow("REVISION_CONFLICT");
});
