import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { session, load, rpc, shared, queued, recorded } = vi.hoisted(() => ({
  session: vi.fn(), load: vi.fn(), rpc: vi.fn(), shared: vi.fn(), queued: vi.fn(), recorded: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: () => ({ rpc }) }));
vi.mock("@/lib/native-log/server", async () => ({ ...(await vi.importActual("@/lib/native-log/server")), nativeSession: session, loadNative: load }));
vi.mock("@/lib/cohort/server", () => ({ loadCohort: async () => null, prepareCohortConfirmation: vi.fn() }));
vi.mock("@/lib/cohort/dispatch", () => ({ dispatchCohortReview: async () => false }));
vi.mock("@/lib/field-station/shared-day", () => ({ sharedDayFor: shared }));
vi.mock("@/lib/native-log/capture", async () => ({ ...(await vi.importActual("@/lib/native-log/capture")), queueApprovedCapture: queued }));
vi.mock("@/lib/native-log/diagnostics", async () => ({ ...(await vi.importActual("@/lib/native-log/diagnostics")), recordNativeDiagnostic: recorded }));
import { NextRequest } from "next/server";
import { encryptNarrative } from "@/lib/crypto";
import { emptyNativeActivity, newNativeDraft } from "@/lib/native-log/draft";
import { nativeOwnerScope, type NativeRow } from "@/lib/native-log/storage-core";
import { POST as confirm } from "./confirm/route";

const owner = "22222222-2222-4222-8222-222222222222",
  id = "10000000-0000-4000-8000-000000000001";
function row(): NativeRow {
  const document = {
    ...newNativeDraft(nativeOwnerScope(owner), "2026-10-27", "Asia/Kolkata", "personal"),
    transcript: "I walked from 7am to 8am. I had breakfast.",
    activities: [
      { ...emptyNativeActivity("40000000-0000-4000-8000-000000000004"), activity: "Walk", sourceQuote: "I walked from 7am to 8am.", startLocal: "2026-10-27T07:00", endLocal: "2026-10-27T08:00", node: "Physiology" as const },
      // The group session's common case: a real activity whose time was not said.
      { ...emptyNativeActivity("50000000-0000-4000-8000-000000000005"), activity: "Breakfast", sourceQuote: "I had breakfast.", node: "Physiology" as const },
    ],
  };
  const e = encryptNarrative(JSON.stringify({ document, parts: {}, totalParts: null }));
  return { id, revision: 3, status: "draft", content_ciphertext: e.ciphertext, content_iv: e.iv, content_auth_tag: e.authTag, content_digest: e.digest, receipt: null, created_at: "2026-10-27T00:00:00Z", updated_at: "2026-10-27T00:00:00Z", removed_at: null };
}
const submit = () => confirm(new NextRequest("https://valuelog.theinternetofvalue.org/api/native-log/confirm", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ id, revision: 3, confirmed: true, confirmationText: "Submit Value Log" }),
}));
beforeEach(() => {
  vi.stubEnv("AUDIT_DIGEST_KEY", "synthetic-submission-route-key-over-thirty-two");
  vi.stubEnv("NARRATIVE_ENCRYPTION_KEY_BASE64", Buffer.alloc(32, 6).toString("base64"));
  for (const mock of [session, load, rpc, shared, queued, recorded]) mock.mockReset();
  session.mockResolvedValue({ kind: "personal", user: { id: owner } });
  load.mockImplementation(async () => row());
  rpc.mockImplementation(async (_name: string, args: { p_receipt: unknown }) => ({ data: args.p_receipt, error: null }));
  queued.mockResolvedValue({ kind: "capture_review_pending", ids: [], dates: ["2026-10-27"], count: 2, timezone: "Asia/Kolkata" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("ordinary-member submission with an untimed activity", () => {
  it("outside the shared day, still files the whole log as awaiting review with no day entries (incident behaviour)", async () => {
    shared.mockResolvedValue(false);
    const body = await (await submit()).json();
    expect(body.receipt.kind).toBe("capture_review_pending");
    expect(rpc).not.toHaveBeenCalled();
    expect(recorded).toHaveBeenCalledWith(owner, id, expect.objectContaining({ stage: "submission", outcome: "ok", route: "capture_review", receipt: "capture_review_pending" }));
  });
  it("for a rollout participant, saves both rows to the day and keeps breakfast untimed", async () => {
    shared.mockResolvedValue(true);
    const body = await (await submit()).json();
    expect(rpc).toHaveBeenCalledWith("confirm_member_day_log", expect.anything());
    const { p_entries } = rpc.mock.calls[0][1] as { p_entries: Array<{ start: string | null; end: string | null; date: string; outcome: string }> };
    expect(p_entries.map(e => [e.start, e.end, e.outcome])).toEqual([
      ["2026-10-27T01:30:00.000Z", "2026-10-27T02:30:00.000Z", "unassessed"],
      [null, null, "unassessed"],
    ]);
    expect(p_entries[1].date).toBe("2026-10-27");
    expect(body.receipt).toMatchObject({ kind: "unassessed", count: 2, dates: ["2026-10-27"] });
    expect(queued).not.toHaveBeenCalled();
    expect(recorded).toHaveBeenCalledWith(owner, id, expect.objectContaining({ route: "shared_day", receipt: "unassessed" }));
  });
  it("records a content-free failure code when the save is refused", async () => {
    shared.mockResolvedValue(true);
    rpc.mockResolvedValue({ data: null, error: { message: "REVISION_CONFLICT" } });
    expect((await submit()).status).toBe(409);
    expect(recorded).toHaveBeenCalledWith(owner, id, { stage: "submission", outcome: "failed", code: "REVISION_CONFLICT" });
  });
});
