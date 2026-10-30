import { NextRequest } from "next/server";
import { z } from "zod";
import { narrativeDigest } from "@/lib/crypto";
import { privateJson } from "@/lib/members/http";
import { recordNativeDiagnostic, safeErrorCode, waveLevel } from "@/lib/native-log/diagnostics";
import {
  loadNative,
  nativeBytes,
  nativeFailure,
  nativeSession,
  nativeView,
  providerAllowance,
  readNativeContent,
  withNativeProcessing,
  writeNative,
} from "@/lib/native-log/server";
import { transcribeWithSarvam, validateWave } from "@/lib/native-log/sarvam";
import { captureManifestSchema } from "@/lib/native-log/capture-manifest";
import {
  captureSummaries,
  validateCapturePart,
} from "@/lib/native-log/capture-storage";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    const session = await nativeSession(request, true, true);
    const bytes = await nativeBytes(request, 1000000);
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
    const input = z
      .object({
        id: z.uuid(),
        recordingId: z.uuid(),
        revision: z.coerce.number().int().min(1),
        index: z.coerce.number().int().min(0).max(24),
        total: z.coerce.number().int().min(1).max(25),
        consent: z.literal("true"),
        capture: z.string().max(1000).optional(),
        retryEmpty: z.enum(["true", "false"]).optional(),
      })
      .strict()
      .safeParse(
        Object.fromEntries([...form].filter(([key]) => key !== "audio")),
      );
    if ([...form.keys()].some((key) => form.getAll(key).length !== 1))
      throw new Error("INVALID_INPUT");
    const audio = form.get("audio");
    if (
      !input.success ||
      input.data.index >= input.data.total ||
      !(audio instanceof Blob) ||
      audio.type !== "audio/wav"
    )
      throw new Error("INVALID_INPUT");
    const pcm = Buffer.from(await audio.arrayBuffer()),
      durationMs = Math.round(validateWave(pcm) * 1000);
    const { id, recordingId, revision, index, total } = input.data;
    let manifest;
    try {
      manifest = input.data.capture
        ? captureManifestSchema.parse(JSON.parse(input.data.capture))
        : undefined;
    } catch {
      throw new Error("INVALID_INPUT");
    }
    validateCapturePart(manifest, total, index, durationMs);
    const row = await loadNative(session, id);
    let content = readNativeContent(row);
    const hash = narrativeDigest(pcm.toString("base64"));
    // A fresh recording can replace only an entirely empty failed capture, never saved words.
    if (
      content.recordingId &&
      content.recordingId !== recordingId &&
      !content.document.transcript.trim() &&
      !content.document.activities.length &&
      !content.document.conversation?.length &&
      Object.values(content.parts).every((part) => !part.text.trim())
    )
      content = {
        ...content,
        parts: {},
        totalParts: null,
        recordingId: undefined,
        captureManifest: undefined,
        captureReviews: undefined,
      };
    const old = content.parts[String(index)];
    if (
      content.recordingId === recordingId &&
      old?.hash === hash &&
      (old.text.trim() || input.data.retryEmpty !== "true")
    )
      return privateJson(nativeView(row));
    if (row.revision !== revision) throw new Error("REVISION_CONFLICT");
    if (
      row.status !== "draft" ||
      (content.recordingId && content.recordingId !== recordingId) ||
      (content.totalParts !== null && content.totalParts !== total)
    )
      throw new Error("INVALID_INPUT");
    if (
      content.captureManifest &&
      manifest &&
      JSON.stringify(content.captureManifest) !== JSON.stringify(manifest)
    )
      throw new Error("TRANSCRIPT_CHANGED");
    if (
      (old && (old.hash !== hash || old.text.trim())) ||
      (!old && index !== Object.keys(content.parts).length)
    )
      throw new Error("TRANSCRIPT_CHANGED");
    const originalWords = Object.entries(content.parts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, part]) => part.text)
      .join("\n");
    if (
      content.document.transcript !== originalWords ||
      content.document.activities.length ||
      content.captureReviews?.initial
    )
      throw new Error("TRANSCRIPT_CHANGED");
    return await withNativeProcessing(session, row, async (lease) => {
      const started = Date.now(),
        part = { index, total },
        audioFacts = { durationMs, ...waveLevel(pcm) };
      let text: string;
      try {
        await providerAllowance(session, "stt");
        text = await transcribeWithSarvam(pcm, request.signal);
      } catch (error) {
        await recordNativeDiagnostic(session.user.id, id, { stage: "transcription", outcome: "failed", kind: "initial", code: safeErrorCode(error), part, audio: audioFacts, elapsedMs: Date.now() - started });
        throw error;
      }
      await recordNativeDiagnostic(session.user.id, id, { stage: "transcription", outcome: "ok", kind: "initial", ...(text.trim() ? {} : { code: "NO_WORDS" }), part, audio: audioFacts, elapsedMs: Date.now() - started });
      const parts = {
        ...content.parts,
        [String(index)]: { hash, text, durationMs },
      };
      const transcript = Object.entries(parts)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, part]) => part.text)
        .join("\n");
      if (transcript.length > 50000) throw new Error("PAYLOAD_TOO_LARGE");
      const document = {
        ...content.document,
        transcript,
        activities: [],
        revision: content.document.revision + 1,
        reviewedRevision: null,
      };
      const updated = {
        ...content,
        document,
        parts,
        captureManifest: content.captureManifest ?? manifest,
        totalParts: total,
        recordingId,
        providerConsentAt: new Date().toISOString(),
      };
      const next = await writeNative(session, id, revision, updated, lease);
      console.info("native_audio_part", {
        kind: "initial",
        index,
        total,
        durationMs,
        hasWords: Boolean(text.trim()),
        retry: Boolean(old),
      });
      return privateJson({
        id,
        revision: next,
        status: "draft",
        document,
        receipt: null,
        captures: captureSummaries(updated),
        recording: { id: recordingId, manifest: updated.captureManifest },
        transcription: { done: Object.keys(parts).length, total },
      });
    });
  } catch (error) {
    return nativeFailure(error);
  }
}
