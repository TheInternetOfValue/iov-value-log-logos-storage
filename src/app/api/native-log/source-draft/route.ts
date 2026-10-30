import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { privateJson } from "@/lib/members/http";
import {
  nativeSession,
  nativeJson,
  loadNative,
  readNativeContent,
  writeNative,
  nativeOwnerScope,
  nativeFailure,
} from "@/lib/native-log/server";
import { loadCohort } from "@/lib/cohort/server";
import { newNativeDraft } from "@/lib/native-log/draft";
import { isDatedPolicy } from "@/lib/field-station/dated-policy";
import { coverageOpen } from "@/lib/native-log/coverage";
import { dispatchNativeProcessing } from "@/lib/native-log/dispatch";
import { sharedDayFor } from "@/lib/field-station/shared-day";
const schema = z
  .object({ action: z.enum(["adopt", "continue"]), sourceId: z.uuid() })
  .strict();
export async function POST(request: NextRequest) {
  try {
    const session = await nativeSession(request, true),
      input = schema.safeParse(await nativeJson(request));
    if (!input.success) throw new Error("INVALID_INPUT");
    if (session.kind !== "personal" || !(await sharedDayFor(session.user.id)))
      throw new Error("UNAUTHORIZED");
    const savedScope = await loadCohort(session.user.id);
    const scope = savedScope?.enrollment.active && savedScope.enrollment.review_consent ? savedScope : null;
    if (savedScope && !isDatedPolicy(savedScope.enrollment.policy_id)) throw new Error("UNAUTHORIZED");
    if (
      scope &&
      (!isDatedPolicy(scope.enrollment.policy_id) ||
        !scope.enrollment.active ||
        !scope.enrollment.review_consent)
    )
      throw new Error("UNAUTHORIZED");
    const { action, sourceId } = input.data;
    let draftId = sourceId,
      activityId: string | null = null;
    if (action === "continue") {
      const index = await session.client
        .from("native_log_day_index")
        .select("native_draft_id,activity_id,source_kind")
        .eq("owner_id", session.user.id)
        .eq("source_id", sourceId)
        .is("superseded_at", null)
        .single();
      if (index.error || !index.data) throw new Error("NOT_FOUND");
      const record = await session.client
        .from("cohort_records")
        .select("id")
        .eq("owner_id", session.user.id)
        .eq("id", sourceId)
        .maybeSingle();
      if (record.error || record.data) throw new Error("INVALID_INPUT");
      draftId = index.data.native_draft_id;
      activityId = index.data.activity_id;
    } else if (!scope) throw new Error("UNAUTHORIZED");
    const row = await loadNative(session, draftId);
    if (
      row.status !== "submitted" &&
      !(
        action === "continue" &&
        row.status === "removed" &&
        row.receipt?.sourceReferenced
      )
    )
      throw new Error("NATIVE_DRAFT_CLOSED");
    const original = readNativeContent(
      row.status === "removed" ? { ...row, status: "submitted" } : row,
    ).document;
    if (
      original.mode !== "personal" ||
      original.ownerScope !== nativeOwnerScope(session.user.id)
    )
      throw new Error("ACCOUNT_CHANGED");
    if (
      action === "adopt" &&
      (row.receipt?.kind !== "unassessed" ||
        row.receipt.dayIndexVersion === 1 ||
        !row.receipt.dates.includes("2026-10-26"))
    )
      throw new Error("INVALID_INPUT");
    const activities = activityId
      ? original.activities.filter((a) => a.id === activityId)
      : original.activities;
    if (!activities.length) throw new Error("INVALID_INPUT");
    const document = {
      ...newNativeDraft(
        original.ownerScope,
        original.date,
        original.timezone,
        "personal",
      ),
      transcript: activityId
        ? activities[0].sourceQuote || original.transcript
        : original.transcript,
      activities,
      conversation:
        activityId && activities[0].sourceReplyIds
          ? (original.conversation ?? []).filter((reply) =>
              activities[0].sourceReplyIds!.includes(reply.id),
            )
          : (original.conversation ?? []),
      processedReplyId: original.conversation?.at(-1)?.id,
      cohort: scope?.context,
      ...(action === "adopt"
        ? { adoptsDraftId: sourceId }
        : { continuesSourceId: sourceId }),
    };
    const id = randomUUID();
    await writeNative(session, id, 0, {
      document,
      parts: {},
      totalParts: null,
    });
    if (coverageOpen(document))
      await dispatchNativeProcessing(session.user.id, id, 1, "coverage");
    return privateJson({
      path: `/day?date=${document.date}&draft=${id}`,
      requiresFreshApproval: true,
    });
  } catch (error) {
    return nativeFailure(error);
  }
}
