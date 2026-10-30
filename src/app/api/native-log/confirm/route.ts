import { assertCapturesReady } from "@/lib/native-log/capture-storage";
import { assertNarrationCoverage } from "@/lib/native-log/coverage";
import { NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/members/http";
import { nativeConfirmSchema } from "@/lib/native-log/schema";
import {
  loadNative,
  nativeFailure,
  nativeJson,
  nativeSession,
  readNativeContent,
  rpcFailure,
} from "@/lib/native-log/server";
import { prepareNativeConfirmation } from "@/lib/native-log/confirm";
import { loadCohort, prepareCohortConfirmation } from "@/lib/cohort/server";
import { dispatchCohortReview } from "@/lib/cohort/dispatch";
import { canReviewDraft } from "@/lib/native-log/draft";
import { isDatedPolicy } from "@/lib/field-station/dated-policy";
import { prepareDayApproval } from "@/lib/field-station/approval";
import { sharedDayFor } from "@/lib/field-station/shared-day";
import {
  queueApprovedCapture,
  captureContinuationId,
} from "@/lib/native-log/capture";
import { recordNativeDiagnostic, safeErrorCode, type NativeDiagnostic } from "@/lib/native-log/diagnostics";
import type { NativeReceipt } from "@/lib/native-log/storage-core";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  let scope: { owner: string; id: string } | null = null;
  try {
    const session = await nativeSession(request, true),
      input = nativeConfirmSchema.safeParse(await nativeJson(request));
    if (!input.success) throw new Error("INVALID_INPUT");
    const { id, revision, confirmationText } = input.data,
      row = await loadNative(session, id);
    scope = { owner: session.user.id, id };
    // Each route records which submission path ran and what the person received.
    const submitted = async (route: NonNullable<NativeDiagnostic["route"]>, receipt: NativeReceipt | null) => {
      await recordNativeDiagnostic(session.user.id, id, {
        stage: "submission", outcome: "ok", route,
        ...(receipt ? { receipt: receipt.kind, counts: { activities: receipt.count, dates: receipt.dates.length } } : {}),
      });
      return privateJson({ receipt });
    };
    if (row.status === "submitted") {
      if (row.revision !== revision && row.revision !== revision + 1)
        throw new Error("REVISION_CONFLICT");
      return privateJson({ receipt: row.receipt });
    }
    if (row.revision !== revision) throw new Error("REVISION_CONFLICT");
    const content = readNativeContent(row);
    assertCapturesReady(content);
    if (content.document.mode !== session.kind)
      throw new Error("ACCOUNT_CHANGED");
    if (content.document.supersedesDraftId) {
      const parent = await loadNative(
        session,
        content.document.supersedesDraftId,
      );
      if (
        parent.status !== "submitted" ||
        parent.receipt?.kind !== "capture_review_pending" ||
        captureContinuationId(
          parent.id,
          parent.revision,
          content.continuationGeneration ?? 0,
        ) !== row.id
      )
        throw new Error("INVALID_INPUT");
    }
    let cohort =
      session.kind === "personal" ? await loadCohort(session.user.id) : null;
    const shared = session.kind === "personal" && await sharedDayFor(session.user.id);
    if (cohort && (!cohort.enrollment.active || !cohort.enrollment.review_consent)) {
      // Pausing this dated policy stops assessment; it does not remove private logging.
      if (shared && isDatedPolicy(cohort.enrollment.policy_id)) cohort = null;
      else throw new Error("UNAUTHORIZED");
    }
    // Approval captures the person's account; missing assessment facts never become guessed impacts.
    const trusted = { ...content.document, cohort: cohort?.context };
    assertNarrationCoverage(trusted, content.coverage);
    if (session.kind === "personal" && shared && (!cohort || isDatedPolicy(cohort.enrollment.policy_id))) {
      const prepared = prepareDayApproval(session.user.id, id, trusted, cohort?.enrollment.policy_id ?? null);
      const result = await adminClient().rpc(cohort ? "confirm_dated_native_log" : "confirm_member_day_log", {
        p_owner: session.user.id, p_id: id, p_revision: revision, p_digest: row.content_digest, p_confirmation: confirmationText,
        p_entries: prepared.entries, p_receipt: prepared.receipt, p_continues: content.document.continuesSourceId ?? null,
        ...(cohort ? { p_corrects: content.document.correctsRecordId ?? null, p_adopts: content.document.adoptsDraftId ?? null } : {}),
      });
      if (result.error) throw new Error(rpcFailure(result.error.message));
      if (cohort) await dispatchCohortReview(session.user.id);
      return submitted(cohort ? "dated_cohort" : "shared_day", result.data as NativeReceipt);
    }
    if (!canReviewDraft(trusted))
      return submitted("capture_review", await queueApprovedCapture(session.user.id, row, confirmationText));
    if (cohort) {
      const prepared = await prepareCohortConfirmation(
        session.user.id,
        content.document,
      );
      const result = await adminClient().rpc("confirm_cohort_log", {
        p_owner: session.user.id,
        p_id: id,
        p_revision: revision,
        p_digest: row.content_digest,
        p_confirmation: confirmationText,
        p_entries: prepared.entries,
        p_receipt: prepared.receipt,
        p_corrects: content.document.correctsRecordId ?? null,
      });
      if (result.error) throw new Error(rpcFailure(result.error.message));
      await dispatchCohortReview(session.user.id);
      return submitted("cohort", result.data as NativeReceipt);
    }
    let prepared;
    try {
      prepared = await prepareNativeConfirmation(session, content.document);
    } catch (error) {
      if (error instanceof Error && error.message === "RECOGNITION_REQUIRED")
        return submitted("capture_review", await queueApprovedCapture(session.user.id, row, confirmationText));
      throw error;
    }
    const result = await adminClient().rpc("confirm_native_log", {
      p_owner: session.user.id,
      p_id: id,
      p_revision: revision,
      p_digest: row.content_digest,
      p_mode: session.kind,
      p_entries: prepared.entries,
      p_narrative: prepared.narrative,
      p_confirmation: confirmationText,
      p_receipt: prepared.receipt,
    });
    if (result.error) throw new Error(rpcFailure(result.error.message));
    return submitted(session.kind === "pilot" ? "pilot" : "personal_entries", result.data as NativeReceipt);
  } catch (error) {
    if (scope) await recordNativeDiagnostic(scope.owner, scope.id, { stage: "submission", outcome: "failed", code: safeErrorCode(error) });
    return nativeFailure(error);
  }
}
