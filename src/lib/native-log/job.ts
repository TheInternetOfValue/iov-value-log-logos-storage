// Internal one-use job handoff: identifiers only, no transcript or provider key.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { narrativeDigest } from "@/lib/crypto";
export const nativeJobSchema = z
  .object({
    owner: z.uuid(),
    id: z.uuid(),
    revision: z.number().int().min(1),
    lease: z.uuid(),
    expires: z.number().int(),
    operation: z.literal("coverage").optional(),
  })
  .strict();
export type NativeJob = z.infer<typeof nativeJobSchema>;
export const nativeJobSignature = (raw: string) =>
  narrativeDigest(`value-log-native-job:v1:${raw}`);
export function verifiedNativeJob(
  raw: string,
  signature: string,
  now = Date.now(),
): NativeJob {
  if (
    raw.length > 1500 ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(nativeJobSignature(raw)),
    )
  )
    throw new Error("UNAUTHORIZED");
  const job = nativeJobSchema.parse(JSON.parse(raw));
  if (job.expires <= now || job.expires > now + 120000)
    throw new Error("UNAUTHORIZED");
  return job;
}
