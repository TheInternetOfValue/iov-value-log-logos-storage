import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  captureBlocks,
  captureStatus,
  type CaptureManifest,
  type AudioPart,
} from "./capture-health";
import {
  assertCapturesReady,
  captureSummaries,
  reviewCapturedWords,
  validateCapturePart,
} from "./capture-storage";
import { newNativeDraft } from "./draft";
import type { NativeStoredContent } from "./schema";
const manifest: CaptureManifest = {
  version: 1,
  elapsedMs: 125000,
  decodedMs: 125000,
  stopReason: "user",
  mimeType: "audio/webm",
};
const words = (text: string): AudioPart => ({
  hash: text.padEnd(64, "a"),
  text,
  durationMs: 25000,
});
function content(): NativeStoredContent {
  return {
    document: {
      ...newNativeDraft(
        "a".repeat(64),
        "2026-10-26",
        "Asia/Kolkata",
        "personal",
      ),
      transcript: "Synthetic words",
    },
    totalParts: 5,
    parts: {
      "0": words("Synthetic words"),
      "1": words("More words"),
      "2": words(""),
      "3": words(""),
      "4": words(""),
    },
    captureManifest: manifest,
  };
}
beforeEach(() =>
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-capture-review-digest-key-over-thirty-two",
  ),
);
afterEach(() => vi.unstubAllEnvs());
describe("recording integrity, separate from activity assessment", () => {
  it("does not treat the observed five-of-five/three-blank pattern as a ready recording", () => {
    const c = content(),
      state = captureSummaries(c)[0];
    expect(state).toMatchObject({
      done: 5,
      total: 5,
      withWords: 2,
      emptyParts: [2, 3, 4],
      state: "needs_review",
    });
    expect(() => assertCapturesReady(c)).toThrow("CAPTURE_REVIEW_REQUIRED");
  });
  it("blocks missing sequential parts, including a hole with the same object count", () => {
    const c = content();
    delete c.parts["1"];
    c.parts["8"] = words("foreign index");
    expect(captureSummaries(c)[0].done).toBe(4);
    expect(() => assertCapturesReady(c)).toThrow("INCOMPLETE_RECORDING");
  });
  it("lets an empty correction reply stand aside while an empty first recording still blocks", () => {
    const short = { ...manifest, elapsedMs: 918, decodedMs: 900 };
    const reply = captureStatus("f304dbe9-007b-4157-ad25-85559b4b8dcd", { 0: words("") }, 1, short);
    expect(reply.state).toBe("empty");
    expect(captureBlocks(reply)).toBe(false);
    expect(captureBlocks(captureStatus("initial", { 0: words("") }, 1, short))).toBe(true);
    expect(captureBlocks(captureStatus("f304dbe9-007b-4157-ad25-85559b4b8dcd", {}, 2, short))).toBe(true);
  });
  it("detects the timer/audio discrepancy independently of provider success", () => {
    expect(
      captureStatus("initial", { 0: words("A full sentence") }, 1, {
        ...manifest,
        elapsedMs: 600000,
        decodedMs: 25000,
      }).issues,
    ).toContain("duration_mismatch");
  });
  it("permits a natural short silence within a complete long recording", () => {
    const parts = Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => [
        String(i),
        words(i === 10 ? "" : "Synthetic activity"),
      ]),
    );
    expect(
      captureStatus("initial", parts, 24, {
        ...manifest,
        elapsedMs: 599999,
        decodedMs: 600000,
      }).state,
    ).toBe("ready");
  });
  it("records a deliberate revision-bound choice and invalidates it when recorded content changes", () => {
    const c = content(),
      reviewed = reviewCapturedWords(c, "initial");
    expect(() => assertCapturesReady(reviewed)).not.toThrow();
    expect(reviewed.document.transcript).toBe(c.document.transcript);
    expect(reviewed.document.reviewedRevision).toBeNull();
    reviewed.parts["2"] = words("New captured facts");
    expect(captureSummaries(reviewed)[0].reviewed).toBe(false);
  });
  it("can deliberately preserve only received words after a lost upload, without inventing the remainder", () => {
    const c = content();
    delete c.parts["4"];
    const reviewed = reviewCapturedWords(c, "initial");
    expect(captureSummaries(reviewed)[0]).toMatchObject({
      state: "ready",
      done: 4,
      total: 5,
      reviewed: true,
    });
    expect(reviewed.parts["4"]).toBeUndefined();
  });
  it("never approves entirely empty audio and does not invent a neutral activity", () => {
    const c = content();
    c.parts = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [String(i), words("")]),
    );
    expect(() => reviewCapturedWords(c, "initial")).toThrow(
      "NO_TRANSCRIBED_WORDS",
    );
    expect(c.document.activities).toHaveLength(0);
  });
  it("keeps an unfinished voice turn distinct, and creates its partial message only after deliberate review", () => {
    const c = reviewCapturedWords(content(), "initial"),
      key = "10000000-0000-4000-8000-000000000001";
    c.voiceTurns = {
      [key]: {
        activityId: null,
        total: 3,
        parts: { 0: words("An explicit correction") },
      },
    };
    expect(() => assertCapturesReady(c)).toThrow("INCOMPLETE_RECORDING");
    const reviewed = reviewCapturedWords(c, key);
    expect(reviewed.document.conversation).toEqual([
      { id: key, activityId: null, text: "An explicit correction" },
    ]);
    expect(() => assertCapturesReady(reviewed)).not.toThrow();
    expect(
      reviewCapturedWords(reviewed, key).document.conversation,
    ).toHaveLength(1);
  });
  it("checks the actual WAV duration against the complete recording manifest", () => {
    expect(() => validateCapturePart(manifest, 5, 4, 25000)).not.toThrow();
    expect(() => validateCapturePart(manifest, 5, 4, 1000)).toThrow(
      "INVALID_INPUT",
    );
    expect(() => validateCapturePart(manifest, 4, 0, 25000)).toThrow(
      "INVALID_INPUT",
    );
  });
});
