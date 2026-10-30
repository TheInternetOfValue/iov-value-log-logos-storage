// Server-only integrity state. Audio and words never enter operational logs.
import { narrativeDigest } from "@/lib/crypto";
import {
  captureBlocks,
  captureStatus,
  type CaptureStatus,
  type AudioPart,
  type CaptureManifest,
} from "./capture-health";
import type { NativeStoredContent } from "./schema";
function fingerprint(
  parts: Record<string, AudioPart>,
  total: number,
  manifest?: CaptureManifest,
) {
  return narrativeDigest(
    "native-capture-review:v1:" +
      JSON.stringify({
        total,
        manifest,
        parts: Object.keys(parts)
          .sort((a, b) => Number(a) - Number(b))
          .map((index) => [
            index,
            parts[index].hash,
            parts[index].text,
            parts[index].durationMs,
          ]),
      }),
  );
}
function recordings(content: NativeStoredContent) {
  return [
    ...(content.totalParts !== null
      ? [
          {
            key: "initial",
            parts: content.parts,
            total: content.totalParts,
            manifest: content.captureManifest,
          },
        ]
      : []),
    ...Object.entries(content.voiceTurns ?? {}).map(([key, turn]) => ({
      key,
      ...turn,
    })),
  ];
}
export function captureSummaries(
  content: NativeStoredContent,
): CaptureStatus[] {
  return recordings(content).map((recording) =>
    captureStatus(
      recording.key,
      recording.parts,
      recording.total,
      recording.manifest,
      content.captureReviews?.[recording.key]?.digest ===
        fingerprint(recording.parts, recording.total, recording.manifest),
    ),
  );
}
export function assertCapturesReady(content: NativeStoredContent) {
  const blocked = captureSummaries(content).find(
    captureBlocks,
  );
  if (blocked)
    throw new Error(
      blocked.state === "empty"
        ? "NO_TRANSCRIBED_WORDS"
        : blocked.state === "uploading"
          ? "INCOMPLETE_RECORDING"
          : "CAPTURE_REVIEW_REQUIRED",
    );
}
export function reviewCapturedWords(
  content: NativeStoredContent,
  key: string,
  discardEmpty = false,
): NativeStoredContent {
  const recording = recordings(content).find((item) => item.key === key);
  const status = captureSummaries(content).find((item) => item.key === key);
  if (!recording || !status || (!discardEmpty && status.withWords === 0))
    throw new Error("NO_TRANSCRIBED_WORDS");
  if (discardEmpty && (status.withWords > 0 || key === "initial"))
    throw new Error("INVALID_INPUT");
  if (status.reviewed) return content;
  const turn = content.voiceTurns?.[key];
  const text = Object.entries(recording.parts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, part]) => part.text)
    .join(" ")
    .trim();
  const conversation = [...(content.document.conversation ?? [])];
  if (turn && text && !conversation.some((item) => item.id === key)) {
    if (conversation.length >= 40) throw new Error("INVALID_INPUT");
    conversation.push({ id: key, activityId: turn.activityId, text });
  }
  return {
    ...content,
    captureReviews: {
      ...content.captureReviews,
      [key]: {
        digest: fingerprint(
          recording.parts,
          recording.total,
          recording.manifest,
        ),
        at: new Date().toISOString(),
      },
    },
    document: {
      ...content.document,
      conversation,
      revision: content.document.revision + 1,
      reviewedRevision: null,
    },
  };
}

export function validateCapturePart(
  manifest: CaptureManifest | undefined,
  total: number,
  index: number,
  durationMs: number,
) {
  if (
    manifest &&
    (Math.ceil(manifest.decodedMs / 25000) !== total ||
      Math.abs(
        durationMs - Math.min(25000, manifest.decodedMs - index * 25000),
      ) > 100)
  )
    throw new Error("INVALID_INPUT");
}
