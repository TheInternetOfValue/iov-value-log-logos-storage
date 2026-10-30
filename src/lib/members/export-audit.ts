import "server-only";
import { decryptNarrative } from "@/lib/crypto";
/** The existing owner-filtered export also includes readable, privately encrypted community requests. */
export function readMemberAudit<T extends Record<string, unknown>>(row: T) {
  if (row.event_type !== "cohort_community_requested") return row;
  const metadata = row.metadata as {
    content: { ciphertext: string; iv: string; authTag: string };
  };
  return {
    ...row,
    metadata: {
      ...metadata,
      content: JSON.parse(decryptNarrative(metadata.content)),
    },
  };
}
