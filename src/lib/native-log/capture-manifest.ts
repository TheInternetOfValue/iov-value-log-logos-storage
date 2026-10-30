// Server validation stays out of the microphone bundle.
import { z } from "zod";
import { MAX_CAPTURE_PARTS, type CaptureManifest } from "./capture-health";
export const captureManifestSchema: z.ZodType<CaptureManifest> = z
  .object({
    version: z.literal(1),
    elapsedMs: z.number().int().min(0).max(86400000).nullable(),
    decodedMs: z.number().int().positive().max(601000),
    stopReason: z.enum(["user", "limit", "interrupted", "size", "file"]),
    mimeType: z.string().max(100),
  })
  .strict();
const parts = z.record(
  z.string().regex(/^(?:[0-9]|1[0-9]|2[0-4])$/),
  z
    .object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      text: z.string().max(50000),
      durationMs: z.number().int().positive().max(28000).optional(),
    })
    .strict(),
);
export const storedCaptureSchema = z.object({
  parts,
  totalParts: z.number().int().min(1).max(MAX_CAPTURE_PARTS).nullable(),
  recordingId: z.uuid().optional(),
  captureManifest: captureManifestSchema.optional(),
  voiceTurns: z
    .record(
      z.uuid(),
      z
        .object({
          activityId: z.uuid().nullable(),
          total: z.number().int().min(1).max(MAX_CAPTURE_PARTS),
          manifest: captureManifestSchema.optional(),
          parts,
        })
        .strict(),
    )
    .refine((turns) => Object.keys(turns).length <= 40)
    .optional(),
  captureReviews: z
    .record(
      z.union([z.literal("initial"), z.uuid()]),
      z
        .object({
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          at: z.iso.datetime(),
        })
        .strict(),
    )
    .optional(),
});
