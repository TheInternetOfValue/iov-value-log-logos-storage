import {
  nativeOwnerScope,
  readNativeContent,
  type NativeRow,
} from "@/lib/native-log/storage-core";
import type { CohortActivity } from "./policy";

/** Removal hides the draft; referenced approved evidence remains in the audit history. */
export function readApprovedSource(owner: string, row: NativeRow) {
  if (
    row.receipt?.kind !== "cohort_review_pending" ||
    row.receipt.sourceReferenced !== true ||
    row.status === "draft"
  )
    throw new Error("APPROVED_SOURCE_UNAVAILABLE");
  const content = readNativeContent({ ...row, status: "submitted" });
  if (content.document.ownerScope !== nativeOwnerScope(owner))
    throw new Error("ACCOUNT_CHANGED");
  return content.document;
}
export function resolveActivitySource(
  owner: string,
  row: NativeRow,
  activity: CohortActivity,
) {
  const ref = activity.sourceReference;
  if (!ref || ref.draftId !== row.id)
    throw new Error("APPROVED_SOURCE_UNAVAILABLE");
  const document = readApprovedSource(owner, row);
  if (document.revision !== ref.documentRevision)
    throw new Error("APPROVED_SOURCE_UNAVAILABLE");
  const replies = (document.conversation ?? []).filter((reply) =>
    ref.replyIds.includes(reply.id),
  );
  if (
    replies.length !== new Set(ref.replyIds).size ||
    replies.some(
      (reply) => reply.activityId && reply.activityId !== activity.occurrenceId,
    )
  )
    throw new Error("APPROVED_SOURCE_UNAVAILABLE");
  return {
    activity: {
      ...activity,
      followUpAnswers: replies.map(({ id, text }) => ({ id, text })),
    },
    source: { id: row.id, replies },
  };
}
