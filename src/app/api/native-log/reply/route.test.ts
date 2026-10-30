import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { load, write, stt, allow } = vi.hoisted(() => ({
  load: vi.fn(),
  write: vi.fn(),
  stt: vi.fn(),
  allow: vi.fn(),
}));
vi.mock("@/lib/native-log/server", async () => ({
  ...(await vi.importActual("@/lib/native-log/server")),
  nativeSession: async () => ({
    kind: "personal",
    user: { id: "22222222-2222-4222-8222-222222222222" },
  }),
  loadNative: load,
  writeNative: write,
  withNativeProcessing: async (
    _session: unknown,
    _row: unknown,
    op: (lease: string) => Promise<unknown>,
  ) => op("synthetic-lease"),
  providerAllowance: allow,
}));
vi.mock("@/lib/native-log/sarvam", async () => ({
  ...(await vi.importActual("@/lib/native-log/sarvam")),
  transcribeWithSarvam: stt,
}));
import { NextRequest } from "next/server";
import { pcmWave } from "@/lib/native-log/audio";
import { encryptNarrative } from "@/lib/crypto";
import { newNativeDraft } from "@/lib/native-log/draft";
import { POST } from "./route";
const id = "10000000-0000-4000-8000-000000000001",
  turn = "30000000-0000-4000-8000-000000000003";
let content: Record<string, unknown>, revision: number;
function current() {
  const e = encryptNarrative(JSON.stringify(content));
  return {
    id,
    revision,
    status: "draft",
    content_ciphertext: e.ciphertext,
    content_iv: e.iv,
    content_auth_tag: e.authTag,
  };
}
async function request(index: number, total: number, rev = revision) {
  const audio = await pcmWave([new Float32Array(16000)], 16000, 0, 1),
    form = new FormData();
  for (const [k, v] of Object.entries({
    id,
    revision: String(rev),
    replyId: turn,
    activityId: "",
    index: String(index),
    total: String(total),
    consent: "true",
  }))
    form.set(k, v);
  form.set("audio", audio, "synthetic.wav");
  return new NextRequest(
    "https://valuelog.theinternetofvalue.org/api/native-log/reply",
    { method: "POST", body: form },
  );
}
beforeEach(() => {
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-voice-turn-digest-longer-than-thirty-two",
  );
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 5).toString("base64"),
  );
  revision = 2;
  content = {
    document: {
      ...newNativeDraft(
        "a".repeat(64),
        "2026-10-25",
        "Asia/Kolkata",
        "personal",
      ),
      transcript: "Original private account",
    },
    parts: {},
    totalParts: null,
  };
  load.mockReset();
  write.mockReset();
  stt.mockReset();
  allow.mockReset();
  load.mockImplementation(async () => current());
  write.mockImplementation(
    async (
      _s: unknown,
      _id: string,
      _rev: number,
      next: Record<string, unknown>,
    ) => {
      content = next;
      return ++revision;
    },
  );
});
afterEach(() => vi.unstubAllEnvs());
it("assembles one global voice turn from multiple chunks and does not charge or append twice on retry", async () => {
  stt
    .mockResolvedValueOnce("The walk ended")
    .mockResolvedValueOnce("at nine am.");
  expect((await POST(await request(0, 2))).status).toBe(200);
  expect(
    (content.document as { conversation: unknown[] }).conversation,
  ).toEqual([]);
  expect((await POST(await request(0, 2))).status).toBe(200);
  expect(stt).toHaveBeenCalledTimes(1);
  const last = await POST(await request(1, 2)),
    body = await last.json();
  expect(last.status).toBe(200);
  expect(body.document.conversation).toEqual([
    { id: turn, activityId: null, text: "The walk ended at nine am." },
  ]);
  expect(body.document.reviewedRevision).toBeNull();
  expect(allow).toHaveBeenCalledTimes(2);
  expect((await POST(await request(1, 2))).status).toBe(200);
  expect(stt).toHaveBeenCalledTimes(2);
});
it("rejects a stale reply before processing and retains the original writing", async () => {
  expect((await POST(await request(0, 1, 1))).status).toBe(409);
  expect(stt).not.toHaveBeenCalled();
  expect((content.document as { transcript: string }).transcript).toBe(
    "Original private account",
  );
});
