import { assertCapturesReady } from "./capture-storage";
import { randomUUID } from "node:crypto";
import { adminClient } from "@/lib/supabase/admin-core";
import {
  nativeColumns,
  nativeOwnerScope,
  readNativeContent,
  writeNative,
  type NativeRow,
} from "./storage-core";
import { structureWithSarvam } from "./sarvam-core";
import { verifiedNativeJob } from "./job";
import { loadCohort } from "@/lib/cohort/storage";
import { coverageOpen, checkNarrationCoverage } from "./coverage";
import { nativeProviderAllowance } from "./allowance";
import { providerFacts, recordNativeDiagnostic } from "./diagnostics";
export async function runNativeStructure(raw: string, signature: string) {
  const job = verifiedNativeJob(raw, signature);
  if (process.env.VALUE_LOG_NATIVE_LOGGING !== "open") return;
  const db = adminClient(),
    workerLease = randomUUID();
  // Rotating the signed dispatch lease is an atomic one-use claim. Retries cannot pay twice.
  const claim = await db
    .from("native_log_drafts")
    .update({
      lease_token: workerLease,
      lease_until: new Date(Date.now() + 150000).toISOString(),
    })
    .eq("owner_id", job.owner)
    .eq("id", job.id)
    .eq("revision", job.revision)
    .eq("status", "draft")
    .eq("lease_token", job.lease)
    .gt("lease_until", new Date().toISOString())
    .select(nativeColumns)
    .maybeSingle();
  if (claim.error) throw new Error("UNAVAILABLE");
  if (!claim.data) return;
  const content = readNativeContent(claim.data as unknown as NativeRow);
  const started = Date.now(),
    stage = job.operation === "coverage" ? "coverage" as const : "structure" as const;
  try {
    assertCapturesReady(content);
    if (
      content.document.ownerScope !== nativeOwnerScope(job.owner) ||
      !content.document.transcript.trim()
    )
      throw new Error("INVALID_INPUT");
    const scope =
      content.document.mode === "personal" ? await loadCohort(job.owner) : null;
    const trusted = {
      ...content.document,
      cohort: scope?.enrollment.active && scope.enrollment.review_consent ? scope.context : undefined,
    };
    const processingDeadline = AbortSignal.timeout(125000);
    const report = { unmatched: 0 };
    const activities = job.operation === "coverage" ? trusted.activities : await structureWithSarvam(trusted, processingDeadline, report);
    // A fresh table from the narration replaces the count; a follow-up keeps it (its own misses show where it was typed).
    const fresh = job.operation !== "coverage" && !(trusted.conversation?.length && trusted.activities.length);
    const unmatchedRows = fresh ? report.unmatched : content.unmatchedRows;
    const document = {
      ...trusted,
      activities,
      processedReplyId: trusted.conversation?.at(-1)?.id,
      revision: content.document.revision + 1,
      reviewedRevision: null,
    };
    let coverage = content.coverage;
    if (coverageOpen(document)) {
      await nativeProviderAllowance(job.owner, "chat");
      coverage = await checkNarrationCoverage(document, processingDeadline);
    }
    await writeNative(
      { kind: document.mode, user: { id: job.owner } },
      job.id,
      job.revision,
      { ...content, document, coverage, unmatchedRows: unmatchedRows || undefined, processingError: coverageOpen(document) && !coverage?.complete ? "OMISSION_REVIEW_REQUIRED" : undefined },
      workerLease,
    );
    await recordNativeDiagnostic(job.owner, job.id, {
      stage,
      outcome: "ok",
      ...(coverageOpen(document) && !coverage?.complete ? { code: "OMISSION_REVIEW_REQUIRED" } : {}),
      counts: { activitiesBefore: content.document.activities.length, activitiesAfter: activities.length, replies: document.conversation?.length ?? 0, unmatchedRows: report.unmatched },
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        "INCOMPLETE_RECORDING",
        "CAPTURE_REVIEW_REQUIRED",
        "NO_TRANSCRIBED_WORDS",
        "PROVIDER_TIMEOUT",
        "PROVIDER_RESPONSE",
        "PROVIDER_UNAVAILABLE",
        "PROVIDER_ALLOWANCE",
        "OMISSION_REVIEW_REQUIRED",
      ].includes(error.message)
        ? error.message
        : "PROVIDER_UNAVAILABLE";
    const provider = providerFacts(error);
    console.warn("native_log_structure_failed", { code, providerStage: provider?.stage });
    await recordNativeDiagnostic(job.owner, job.id, {
      stage,
      outcome: "failed",
      code,
      provider,
      counts: { activitiesBefore: content.document.activities.length, replies: content.document.conversation?.length ?? 0 },
      elapsedMs: Date.now() - started,
    });
    // Persist only a safe outcome code; the person can resume without losing words.
    try {
      await writeNative(
        { kind: content.document.mode, user: { id: job.owner } },
        job.id,
        job.revision,
        {
          ...content,
          document: {
            ...content.document,
            revision: content.document.revision + 1,
            reviewedRevision: null,
          },
          processingError: code,
        },
        workerLease,
      );
    } catch {
      /* A removal or later revision wins over the worker. */
    }
  } finally {
    await db.rpc("release_native_log_processing", {
      p_owner: job.owner,
      p_id: job.id,
      p_token: workerLease,
    });
  }
}
