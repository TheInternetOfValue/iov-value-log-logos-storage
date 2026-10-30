// Trusted server and Netlify worker core. Never import from browser code.
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin-core";
import { ProviderContractError } from "./provider-contract";

/**
 * Durable, content-free operational evidence for native logging. The host keeps
 * no historical worker logs and drafts are encrypted, so each stage outcome is
 * appended to the owner's audit ledger. Only the whitelisted fields below can be
 * stored: no words, audio, quotations, model text, keys or identifiers other
 * than the owner's own draft id.
 */
const code = z.string().regex(/^[A-Za-z0-9_]{1,48}$/);
const count = z.number().int().min(0).max(1_000_000);
const diagnosticSchema = z
  .object({
    stage: z.enum(["transcription", "structure", "coverage", "submission"]),
    outcome: z.enum(["ok", "failed"]),
    code: code.optional(),
    kind: z.enum(["initial", "reply"]).optional(),
    route: z.enum(["shared_day", "dated_cohort", "cohort", "capture_review", "pilot", "personal_entries"]).optional(),
    receipt: z.enum(["validation_pending", "unassessed", "cohort_review_pending", "capture_review_pending"]).optional(),
    part: z.object({ index: count, total: count }).strict().optional(),
    audio: z.object({ durationMs: count, peakDbfs: z.number().int().min(-120).max(0), rmsDbfs: z.number().int().min(-120).max(0) }).strict().optional(),
    provider: z
      .object({
        stage: code,
        finishReason: code.optional(),
        issueCodes: z.array(code).max(10).optional(),
        completionTokens: count.optional(),
      })
      .strict()
      .optional(),
    counts: z.record(code, count).optional(),
    elapsedMs: count.optional(),
  })
  .strict();
export type NativeDiagnostic = z.infer<typeof diagnosticSchema>;

/** Safe provider facts only; never the response body or a field value. */
export function providerFacts(error: unknown): NativeDiagnostic["provider"] {
  if (!(error instanceof ProviderContractError)) return undefined;
  const { stage, finishReason, issues, completionTokens } = error.diagnostic;
  return {
    stage,
    ...(finishReason ? { finishReason } : {}),
    ...(issues?.length ? { issueCodes: [...new Set(issues.map((issue) => issue.code))].filter((c) => code.safeParse(c).success).slice(0, 10) } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
  };
}

/** An internal error code (never an arbitrary message) or UNAVAILABLE. */
export function safeErrorCode(error: unknown) {
  return error instanceof Error && /^[A-Z][A-Z_]{1,47}$/.test(error.message) ? error.message : "UNAVAILABLE";
}

/** Peak and RMS level of 16-bit mono PCM WAV, in whole dBFS. Distinguishes silence from an empty transcription without retaining sound. */
export function waveLevel(wave: Buffer) {
  let peak = 0,
    squares = 0;
  const samples = Math.floor((wave.length - 44) / 2);
  for (let offset = 44; offset + 1 < wave.length; offset += 2) {
    const value = Math.abs(wave.readInt16LE(offset)) / 32768;
    if (value > peak) peak = value;
    squares += value * value;
  }
  const dbfs = (value: number) => Math.max(-120, Math.min(0, Math.round(20 * Math.log10(Math.max(value, 1e-6)))));
  return { peakDbfs: dbfs(peak), rmsDbfs: dbfs(samples ? Math.sqrt(squares / samples) : 0) };
}

/** Best effort: diagnostics must never interrupt capture, preparation or submission. */
export async function recordNativeDiagnostic(owner: string, draftId: string, diagnostic: NativeDiagnostic) {
  try {
    const checked = diagnosticSchema.safeParse(diagnostic);
    if (!checked.success || !z.uuid().safeParse(owner).success || !z.uuid().safeParse(draftId).success) return;
    const { error } = await adminClient().from("audit_events").insert({
      owner_id: owner,
      actor_type: "system",
      event_type: "native_log_diagnostic",
      entity_type: "native_log",
      entity_id: draftId,
      metadata: checked.data,
    });
    if (error) console.warn("native_log_diagnostic_unrecorded", { stage: checked.data.stage });
  } catch {
    console.warn("native_log_diagnostic_unrecorded", { stage: diagnostic.stage });
  }
}
