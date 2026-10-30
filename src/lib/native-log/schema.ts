import { z } from "zod";
import {
  MAX_VOICE_WORDS_CHARACTERS,
  type AudioPart,
  type CaptureManifest,
} from "./capture-health";
import {
  wellbeingNodeSchema,
  saoLaneSchema,
  impactDirectionSchema,
  impactIntensitySchema,
  confidenceSchema,
} from "@/lib/domain";
import { dateSchema } from "@/lib/members/entries";
import { MANUAL_ACTIVITY_FIELDS } from "./draft";
import { TIME_PRECISIONS } from "./vague-time";
const time = z
  .string()
  .max(16)
  .refine((value) => !value || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value));
const offset = z.string().regex(/^$|^[+-]\d{2}:\d{2}$/);
export const nativeActivitySchema = z
  .object({
    id: z.uuid(),
    activity: z.string().max(500),
    startLocal: time,
    endLocal: time,
    startOffset: offset,
    endOffset: offset,
    node: z.union([z.literal(""), wellbeingNodeSchema]),
    context: z.string().max(2000),
    proof: z.string().max(2000),
    sourceQuote: z.string().max(1000),
    timeNote: z.string().max(400).optional(),
    timePrecision: z.enum(TIME_PRECISIONS).optional(),
    timeLabel: z.string().max(200).optional(),
    startFromReply: z.boolean().optional(),
    inheritedStartFrom: z.uuid().optional(),
    sleepRest: z.boolean(),
    community: z.string().regex(/^$|^[a-z][a-z0-9_-]{1,63}$/),
    lane: z.union([z.literal(""), saoLaneSchema]),
    direction: z.union([z.literal(""), impactDirectionSchema]),
    intensity: z.union([z.literal(""), impactIntensitySchema]),
    confidence: z.union([z.literal(""), confidenceSchema]),
    manualFields: z.array(z.enum(MANUAL_ACTIVITY_FIELDS)).max(14).optional(),
    sourceReplyIds: z.array(z.uuid()).max(40).optional(),
  })
  .strict();
export const nativeDocumentSchema = z
  .object({
    version: z.literal(1),
    ownerScope: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(["pilot", "personal"]),
    date: dateSchema,
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    transcript: z.string().max(50000),
    activities: z.array(nativeActivitySchema).max(30),
    revision: z.number().int().min(0).max(2147483640),
    reviewedRevision: z.number().int().min(0).nullable(),
    conversation: z
      .array(
        z
          .object({
            id: z.uuid(),
            activityId: z.uuid().nullable(),
            text: z.string().trim().min(1).max(MAX_VOICE_WORDS_CHARACTERS),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    cohort: z
      .object({
        policyId: z.string().max(80),
        houseId: z.string().max(64),
        houseName: z.string().max(120).optional(),
        workCommunities: z
          .array(
            z
              .object({ id: z.string().max(64), name: z.string().max(120) })
              .strict(),
          )
          .max(30),
      })
      .strict()
      .optional(),
    correctsRecordId: z.uuid().optional(),
    reviewQuestion: z.string().max(500).optional(),
    supersedesDraftId: z.uuid().optional(),
    processedReplyId: z.uuid().optional(),
    adoptsDraftId: z.uuid().optional(),
    continuesSourceId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.activities.map((item) => item.id)).size ===
      value.activities.length,
  )
  .refine((value) =>
    value.activities.every(
      (activity) =>
        !activity.sourceReplyIds ||
        (new Set(activity.sourceReplyIds).size ===
          activity.sourceReplyIds.length &&
          activity.sourceReplyIds.every((id) =>
            value.conversation?.some((reply) => reply.id === id),
          )),
    ),
  );
export const nativeSaveSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().min(0).max(2147483640),
    document: nativeDocumentSchema,
    consent: z.literal(true),
  })
  .strict();
export const nativeActionSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().min(1).max(2147483640),
    consent: z.literal(true),
  })
  .strict();
export const nativeConfirmSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().min(1).max(2147483640),
    confirmed: z.literal(true),
    confirmationText: z.string().trim().min(1).max(500),
  })
  .strict();
export type NativeStoredContent = {
  document: z.infer<typeof nativeDocumentSchema>;
  parts: Record<string, AudioPart>;
  totalParts: number | null;
  recordingId?: string;
  captureManifest?: CaptureManifest;
  captureReviews?: Record<string, { digest: string; at: string }>;
  providerConsentAt?: string;
  storageConsentAt?: string;
  processingError?: string;
  /** How many proposed rows from the last fresh preparation could not be matched to the person's words. A count only. */
  unmatchedRows?: number;
  coverage?: import("./coverage").CoverageProof;
  approval?: {
    at: string;
    documentRevision: number;
    contentDigest: string;
    confirmationText: string;
  };
  voiceTurns?: Record<
    string,
    {
      activityId: string | null;
      total: number;
      manifest?: CaptureManifest;
      parts: Record<string, AudioPart>;
    }
  >;
  continuationGeneration?: number;
};
