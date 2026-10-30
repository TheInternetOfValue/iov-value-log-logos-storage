import { captureManifestSchema } from "@/lib/native-log/capture-manifest";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  nativeSession,
  nativeBytes,
  nativeFailure,
  loadNative,
  readNativeContent,
  nativeView,
  writeNative,
  withNativeProcessing,
  providerAllowance,
} from "@/lib/native-log/server";
import { transcribeWithSarvam, validateWave } from "@/lib/native-log/sarvam";
import { MAX_VOICE_WORDS_CHARACTERS } from "@/lib/native-log/capture-health";
import {
  captureSummaries,
  validateCapturePart,
} from "@/lib/native-log/capture-storage";
import { privateJson } from "@/lib/members/http";
import { recordNativeDiagnostic, safeErrorCode, waveLevel } from "@/lib/native-log/diagnostics";
import { createHash } from "node:crypto";
export const runtime = "nodejs";
// Same budget as the initial transcription: a 25-second part may take up to the provider's 20-second limit.
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    const session = await nativeSession(request, true, true),
      bytes = await nativeBytes(request, 1000000);
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
    const parsed = z
      .object({
        id: z.uuid(),
        revision: z.coerce.number().int().min(1),
        replyId: z.uuid(),
        activityId: z.union([z.uuid(), z.literal("")]).optional(),
        index: z.coerce.number().int().min(0).max(24).default(0),
        total: z.coerce.number().int().min(1).max(25).default(1),
        consent: z.literal("true"),
        capture: z.string().max(1000).optional(),
        retryEmpty: z.enum(["true", "false"]).optional(),
      })
      .strict()
      .safeParse(
        Object.fromEntries([...form].filter(([key]) => key !== "audio")),
      );
    const audio = form.get("audio");
    if (
      !parsed.success ||
      !(audio instanceof Blob) ||
      audio.type !== "audio/wav" ||
      [...form.keys()].some((key) => form.getAll(key).length !== 1)
    )
      throw new Error("INVALID_INPUT");
    const { id, revision, replyId, activityId, index, total } = parsed.data;
    if (index >= total) throw new Error("INVALID_INPUT");
    const pcm = Buffer.from(await audio.arrayBuffer()),
      durationMs = Math.round(validateWave(pcm) * 1000);
    let manifest;
    try {
      manifest = parsed.data.capture
        ? captureManifestSchema.parse(JSON.parse(parsed.data.capture))
        : undefined;
    } catch {
      throw new Error("INVALID_INPUT");
    }
    validateCapturePart(manifest, total, index, durationMs);
    const row = await loadNative(session, id),
      content = readNativeContent(row),
      old = content.voiceTurns?.[replyId];
    const hash = createHash("sha256").update(pcm).digest("hex"),
      previous = old?.parts[String(index)];
    if (
      previous?.hash === hash &&
      (previous.text.trim() || parsed.data.retryEmpty !== "true")
    )
      return privateJson(nativeView(row));
    if (row.revision !== revision) throw new Error("REVISION_CONFLICT");
    if (row.status !== "draft") throw new Error("NATIVE_DRAFT_CLOSED");
    if (
      (activityId &&
        !content.document.activities.some((item) => item.id === activityId)) ||
      (content.document.conversation?.length ?? 0) >= 40
    )
      throw new Error("INVALID_INPUT");
    if (
      old &&
      (old.total !== total ||
        old.activityId !== (activityId || null) ||
        (old.manifest &&
          manifest &&
          JSON.stringify(old.manifest) !== JSON.stringify(manifest)))
    )
      throw new Error("TRANSCRIPT_CHANGED");
    if (
      content.captureReviews?.[replyId] ||
      content.document.processedReplyId === replyId ||
      (previous && previous.hash !== hash)
    )
      throw new Error("TRANSCRIPT_CHANGED");
    if (!previous && index !== Object.keys(old?.parts ?? {}).length)
      throw new Error("INVALID_INPUT");
    return await withNativeProcessing(session, row, async (lease) => {
      const started = Date.now(),
        part = { index, total },
        audioFacts = { durationMs, ...waveLevel(pcm) };
      let text: string;
      try {
        await providerAllowance(session, "stt");
        text = await transcribeWithSarvam(pcm, request.signal);
      } catch (error) {
        await recordNativeDiagnostic(session.user.id, id, { stage: "transcription", outcome: "failed", kind: "reply", code: safeErrorCode(error), part, audio: audioFacts, elapsedMs: Date.now() - started });
        throw error;
      }
      await recordNativeDiagnostic(session.user.id, id, { stage: "transcription", outcome: "ok", kind: "reply", ...(text.trim() ? {} : { code: "NO_WORDS" }), part, audio: audioFacts, elapsedMs: Date.now() - started });
      const turn = {
        activityId: activityId || null,
        total,
        manifest: old?.manifest ?? manifest,
        parts: {
          ...(old?.parts ?? {}),
          [String(index)]: { hash, text, durationMs },
        },
      };
      const complete = Array.from(
        { length: total },
        (_, i) => turn.parts[String(i)],
      ).every(Boolean);
      const message = complete
        ? Array.from({ length: total }, (_, i) => turn.parts[String(i)].text)
            .join(" ")
            .trim()
        : "";
      if (message.length > MAX_VOICE_WORDS_CHARACTERS)
        throw new Error("PAYLOAD_TOO_LARGE");
      const document = {
        ...content.document,
        conversation: [
          ...(content.document.conversation ?? []).filter(
            (item) => item.id !== replyId,
          ),
          ...(message
            ? [{ id: replyId, activityId: activityId || null, text: message }]
            : []),
        ],
        revision: content.document.revision + 1,
        reviewedRevision: null,
      };
      const updated = {
        ...content,
        document,
        voiceTurns: { ...(content.voiceTurns ?? {}), [replyId]: turn },
      };
      const next = await writeNative(session, id, revision, updated, lease);
      console.info("native_audio_part", {
        kind: "reply",
        index,
        total,
        durationMs,
        hasWords: Boolean(text.trim()),
        retry: Boolean(previous),
      });
      return privateJson({
        id,
        revision: next,
        document,
        captures: captureSummaries(updated),
        status: "draft",
        receipt: null,
      });
    });
  } catch (error) {
    return nativeFailure(error);
  }
}
