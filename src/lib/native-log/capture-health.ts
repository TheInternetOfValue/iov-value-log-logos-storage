export const MAX_CAPTURE_SECONDS = 600;
export const MAX_CAPTURE_PARTS = 25;
export const MAX_VOICE_WORDS_CHARACTERS = 50000;
export type CaptureManifest = {
  version: 1;
  elapsedMs: number | null;
  decodedMs: number;
  stopReason: "user" | "limit" | "interrupted" | "size" | "file";
  mimeType: string;
};
export type AudioPart = { hash: string; text: string; durationMs?: number };
export type CaptureStatus = {
  key: string;
  state: "uploading" | "empty" | "needs_review" | "ready";
  done: number;
  total: number;
  withWords: number;
  emptyParts: number[];
  decodedMs: number | null;
  elapsedMs: number | null;
  issues: string[];
  reviewed: boolean;
};
export function captureStatus(
  key: string,
  parts: Record<string, AudioPart>,
  total: number,
  manifest?: CaptureManifest,
  reviewed = false,
): CaptureStatus {
  const sequence = Array.from(
    { length: total },
    (_, index) => parts[String(index)],
  );
  const done = sequence.filter(Boolean).length;
  const withWords = sequence.filter((part) => part?.text.trim()).length;
  const blank = sequence.filter((part) => part && !part.text.trim()).length;
  let trailingBlank = 0;
  if (done === total)
    for (const part of [...sequence].reverse()) {
      if (part?.text.trim()) break;
      trailingBlank++;
    }
  const issues: string[] = [];
  if (done !== total) issues.push("missing_parts");
  if (
    manifest?.elapsedMs !== null &&
    manifest?.elapsedMs !== undefined &&
    Math.abs(manifest.elapsedMs - manifest.decodedMs) >
      Math.max(3000, manifest.elapsedMs * 0.1)
  )
    issues.push("duration_mismatch");
  if (manifest?.stopReason === "interrupted") issues.push("interrupted");
  if (manifest?.stopReason === "limit") issues.push("recording_limit");
  if (manifest?.stopReason === "size") issues.push("size_limit");
  if (blank >= 2 && (blank / total >= 0.5 || trailingBlank >= 2))
    issues.push("unrecognised_sections");
  return {
    key,
    state: reviewed
      ? "ready"
      : withWords === 0
        ? done === total
          ? "empty"
          : "uploading"
        : done !== total
          ? "uploading"
          : issues.length
            ? "needs_review"
            : "ready",
    done,
    total,
    withWords,
    emptyParts: sequence.flatMap((part, index) =>
      part && !part.text.trim() ? [index] : [],
    ),
    decodedMs: manifest?.decodedMs ?? null,
    elapsedMs: manifest?.elapsedMs ?? null,
    issues,
    reviewed,
  };
}
/** An empty correction reply adds nothing, so it never holds back the table built from the first recording. */
export function captureBlocks(capture: CaptureStatus) {
  return capture.state !== "ready" && !(capture.state === "empty" && capture.key !== "initial");
}
export function captureMessage(capture: CaptureStatus) {
  if (capture.state === "empty")
    return "No words came back from this recording. If the audio is still in this tab, try processing it again; otherwise record again.";
  if (capture.issues.includes("duration_mismatch"))
    return "The audio duration differs from the recording timer. Check the captured words; listen to the original audio if you still have it.";
  if (capture.issues.includes("interrupted"))
    return "Recording was interrupted. Check the captured words and listen to the audio if it is still available.";
  if (capture.issues.includes("recording_limit"))
    return "Recording stopped at ten minutes. Check the captured words, then speak again to add anything remaining.";
  if (capture.issues.includes("size_limit"))
    return "Recording stopped at its size limit. Check the captured words before continuing.";
  if (capture.issues.includes("missing_parts"))
    return "Some of this recording has not finished processing. Keep this tab open and retry; your saved words remain.";
  return "Much of this recording returned no words. Listen to your audio before using the captured words.";
}
