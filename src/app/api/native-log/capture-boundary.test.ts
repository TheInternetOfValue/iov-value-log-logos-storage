import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { load, write, stt, allow, session, rpc } = vi.hoisted(() => ({
  load: vi.fn(),
  write: vi.fn(),
  stt: vi.fn(),
  allow: vi.fn(),
  session: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: () => ({ rpc }) }));
vi.mock("@/lib/native-log/server", async () => ({
  ...(await vi.importActual("@/lib/native-log/server")),
  nativeSession: session,
  loadNative: load,
  writeNative: write,
  providerAllowance: allow,
  withNativeProcessing: async (
    _s: unknown,
    _r: unknown,
    op: (lease: string) => Promise<unknown>,
  ) => op("synthetic-lease"),
}));
vi.mock("@/lib/native-log/sarvam", async () => ({
  ...(await vi.importActual("@/lib/native-log/sarvam")),
  transcribeWithSarvam: stt,
}));
import { NextRequest } from "next/server";
import { encryptNarrative } from "@/lib/crypto";
import { newNativeDraft } from "@/lib/native-log/draft";
import {
  nativeOwnerScope,
  type NativeRow,
} from "@/lib/native-log/storage-core";
import type { NativeStoredContent } from "@/lib/native-log/schema";
import { pcmWave } from "@/lib/native-log/audio";
import { POST as transcribe } from "./transcribe/route";
import { POST as reply } from "./reply/route";
import { POST as review } from "./capture-review/route";
import { POST as structure } from "./structure/route";
import { POST as confirm } from "./confirm/route";
const owner = "22222222-2222-4222-8222-222222222222",
  id = "10000000-0000-4000-8000-000000000001",
  recordingId = "30000000-0000-4000-8000-000000000003";
let content: NativeStoredContent, revision: number, status: NativeRow["status"];
function row(): NativeRow {
  const e = encryptNarrative(JSON.stringify(content));
  return {
    id,
    revision,
    status,
    content_ciphertext: e.ciphertext,
    content_iv: e.iv,
    content_auth_tag: e.authTag,
    content_digest: e.digest,
    receipt: null,
    created_at: "2026-10-26T00:00:00Z",
    updated_at: "2026-10-26T00:00:00Z",
    removed_at: null,
  };
}
function json(path: string, extra: Record<string, unknown> = {}) {
  return new NextRequest(
    `https://valuelog.theinternetofvalue.org/api/native-log/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, revision, consent: true, ...extra }),
    },
  );
}
async function audio(
  path: "transcribe" | "reply",
  index: number,
  total: number,
  options: Record<string, string> = {},
  duration = 1,
) {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    id,
    revision: String(revision),
    [path === "reply" ? "replyId" : "recordingId"]: recordingId,
    index: String(index),
    total: String(total),
    consent: "true",
    ...options,
  }))
    form.set(k, v);
  form.set(
    "audio",
    pcmWave([new Float32Array(16000 * duration)], 16000, 0, duration),
    "synthetic.wav",
  );
  return new NextRequest(
    `https://valuelog.theinternetofvalue.org/api/native-log/${path}`,
    { method: "POST", body: form },
  );
}
beforeEach(() => {
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-capture-boundary-key-over-thirty-two",
  );
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 5).toString("base64"),
  );
  revision = 1;
  status = "draft";
  content = {
    document: newNativeDraft(
      nativeOwnerScope(owner),
      "2026-10-26",
      "Asia/Kolkata",
      "personal",
    ),
    parts: {},
    totalParts: null,
  };
  for (const mock of [load, write, stt, allow, session, rpc]) mock.mockReset();
  session.mockResolvedValue({ kind: "personal", user: { id: owner } });
  load.mockImplementation(async () => row());
  write.mockImplementation(
    async (
      _s: unknown,
      _id: string,
      rev: number,
      next: NativeStoredContent,
    ) => {
      if (rev !== revision) throw new Error("REVISION_CONFLICT");
      content = next;
      return ++revision;
    },
  );
  stt.mockResolvedValue("Synthetic activity.");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("capture completeness at the API boundary", () => {
  it("never queues structuring or confirmation while a part is missing", async () => {
    expect((await transcribe(await audio("transcribe", 0, 2))).status).toBe(
      200,
    );
    expect((await structure(json("structure"))).status).toBe(409);
    const res = await confirm(
      new NextRequest(
        "https://valuelog.theinternetofvalue.org/api/native-log/confirm",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            revision,
            confirmed: true,
            confirmationText: "This is accurate.",
          }),
        },
      ),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("INCOMPLETE_RECORDING");
    expect(rpc).not.toHaveBeenCalled();
    expect(allow).toHaveBeenCalledTimes(1);
  });
  it("retries only a matching empty part, preserving successful words and duplicate-safe replies", async () => {
    stt
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("Recovered synthetic words.");
    const first = await transcribe(await audio("transcribe", 0, 1));
    expect((await first.json()).captures[0].state).toBe("empty");
    expect((await transcribe(await audio("transcribe", 0, 1))).status).toBe(
      200,
    );
    expect(stt).toHaveBeenCalledTimes(1);
    expect(
      (
        await transcribe(
          await audio("transcribe", 0, 1, { retryEmpty: "true" }),
        )
      ).status,
    ).toBe(200);
    const saved = content.document.transcript;
    expect(saved).toBe("Recovered synthetic words.");
    expect(
      (
        await transcribe(
          await audio("transcribe", 0, 1, {
            retryEmpty: "true",
            revision: "1",
          }),
        )
      ).status,
    ).toBe(200);
    expect(stt).toHaveBeenCalledTimes(2);
    expect(content.document.transcript).toBe(saved);
  });
  it("preserves all 24 sequential parts and their duration for a ten-minute recording", async () => {
    const manifest = JSON.stringify({
      version: 1,
      elapsedMs: 600000,
      decodedMs: 600000,
      stopReason: "user",
      mimeType: "audio/webm",
    });
    for (let index = 0; index < 24; index++) {
      stt.mockResolvedValueOnce(`Synthetic part ${index}.`);
      expect(
        (
          await transcribe(
            await audio("transcribe", index, 24, { capture: manifest }, 25),
          )
        ).status,
      ).toBe(200);
    }
    expect(Object.keys(content.parts)).toHaveLength(24);
    expect(content.document.transcript).toContain("Synthetic part 23.");
    expect(
      Object.values(content.parts).reduce(
        (sum, p) => sum + (p.durationMs ?? 0),
        0,
      ),
    ).toBe(600000);
    expect(stt).toHaveBeenCalledTimes(24);
    expect(
      (
        await transcribe(
          await audio(
            "transcribe",
            23,
            24,
            { capture: manifest, revision: "1" },
            25,
          ),
        )
      ).status,
    ).toBe(200);
    expect(stt).toHaveBeenCalledTimes(24);
  });
  it("accepts longer follow-up speech without the old three-part limit or 3000-character truncation", async () => {
    content.document.transcript = "Original synthetic words";
    stt.mockResolvedValue(
      "A synthetic correction with preserved details. ".repeat(20),
    );
    for (let index = 0; index < 5; index++)
      expect((await reply(await audio("reply", index, 5))).status).toBe(200);
    expect(content.document.conversation).toHaveLength(1);
    expect(content.document.conversation![0].text.length).toBeGreaterThan(3000);
    expect(content.voiceTurns![recordingId].parts["4"].text).toContain(
      "preserved details",
    );
  });
  it("requires deliberate owner review for mostly empty audio and binds it to the revision", async () => {
    stt.mockResolvedValueOnce("Captured words.").mockResolvedValue("");
    for (let i = 0; i < 3; i++)
      await transcribe(await audio("transcribe", i, 3));
    expect((await structure(json("structure"))).status).toBe(409);
    expect(
      (
        await review(
          json("capture-review", {
            captureKey: "initial",
            useCapturedWords: true,
            revision: revision - 1,
          }),
        )
      ).status,
    ).toBe(409);
    const res = await review(
      json("capture-review", { captureKey: "initial", useCapturedWords: true }),
    );
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.json()).captures[0]).toMatchObject({
      state: "ready",
      reviewed: true,
      withWords: 1,
    });
    expect(content.document.activities).toEqual([]);
    const writes = write.mock.calls.length;
    expect(
      (
        await review(
          json("capture-review", {
            captureKey: "initial",
            useCapturedWords: true,
          }),
        )
      ).status,
    ).toBe(200);
    expect(write).toHaveBeenCalledTimes(writes);
  });
  it("allows explicitly discarding only a wordless follow-up without changing the existing log", async () => {
    content.document.transcript = "Previous words";
    stt.mockResolvedValue("");
    await reply(await audio("reply", 0, 1));
    expect(
      (
        await review(
          json("capture-review", {
            captureKey: recordingId,
            useCapturedWords: true,
          }),
        )
      ).status,
    ).toBe(409);
    const res = await review(
      json("capture-review", { captureKey: recordingId, discardEmpty: true }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).captures[0]).toMatchObject({
      state: "ready",
      withWords: 0,
      reviewed: true,
    });
    expect(content.document.transcript).toBe("Previous words");
    expect(content.document.conversation).toEqual([]);
  });
  it("retains existing submitted receipt behavior without reprocessing old capture diagnostics", async () => {
    status = "submitted";
    content.totalParts = 2;
    content.parts = { 0: { hash: "a".repeat(64), text: "Already approved" } };
    const res = await confirm(
      new NextRequest(
        "https://valuelog.theinternetofvalue.org/api/native-log/confirm",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            revision,
            confirmed: true,
            confirmationText: "This is accurate.",
          }),
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(write).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses verified session/owner loading and rejects closed, unknown and unauthenticated captures", async () => {
    session.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect(
      (
        await review(
          json("capture-review", {
            captureKey: "initial",
            useCapturedWords: true,
          }),
        )
      ).status,
    ).toBe(401);
    expect(load).not.toHaveBeenCalled();
    load.mockRejectedValueOnce(new Error("NOT_FOUND"));
    expect(
      (
        await review(
          json("capture-review", {
            captureKey: "initial",
            useCapturedWords: true,
          }),
        )
      ).status,
    ).toBe(404);
    status = "removed";
    expect(
      (
        await review(
          json("capture-review", {
            captureKey: "initial",
            useCapturedWords: true,
          }),
        )
      ).status,
    ).toBe(409);
    expect(write).not.toHaveBeenCalled();
    expect(session).toHaveBeenLastCalledWith(expect.any(NextRequest), true);
  });
});
