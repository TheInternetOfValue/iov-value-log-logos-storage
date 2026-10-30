import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PILOT_W_LIMITATIONS, PILOT_W_METHOD_VERSION } from "@/lib/identity";

export const pilotWProjectionSchema = z.object({
  did: z.string().regex(/^did:iov:member:[0-9a-f-]{36}$/),
  public_profile_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  pilot_w_current: z.number().min(100).max(1000),
  delta_24h: z.number(),
  delta_7d: z.number(),
  input_window: z.object({ start: z.string().datetime(), end: z.string().datetime() }),
  calculator_version: z.literal(PILOT_W_METHOD_VERSION),
  aggregate_provenance_hash: z.string().regex(/^[a-f0-9]{64}$/),
  source_application: z.literal("iov-value-log"),
  updated_at: z.string().datetime(),
  experimental: z.literal(true),
  limitations: z.array(z.string()).min(1),
});

export type PilotWProjection = z.infer<typeof pilotWProjectionSchema>;

export function projectionHash(inputHashes: string[]) {
  return createHash("sha256").update([...inputHashes].sort().join("\n")).digest("hex");
}

export function buildProjectionSignature(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyProjectionSignature(secret: string, timestamp: string, body: string, supplied: string) {
  const expected = Buffer.from(buildProjectionSignature(secret, timestamp, body), "hex");
  const received = Buffer.from(supplied, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function projectionLimitations() {
  return [...PILOT_W_LIMITATIONS];
}
