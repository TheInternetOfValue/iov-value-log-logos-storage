import { randomUUID } from "node:crypto";
import { coverageOpen } from "@/lib/native-log/coverage";
import { dispatchNativeProcessing } from "@/lib/native-log/dispatch";
import { NextRequest } from "next/server";
import { z } from "zod";
import { cohortRequest, cohortFailure } from "@/lib/cohort/http";
import { loadCohort, readCipher, type CohortRecord } from "@/lib/cohort/server";
import { cohortActivitySchema } from "@/lib/cohort/policy";
import { adminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/members/http";
import {
  newNativeDraft,
  emptyNativeActivity,
  type NativeDraft,
} from "@/lib/native-log/draft";
import { wallTime } from "@/lib/native-log/time";
import { nativeOwnerScope, writeNative } from "@/lib/native-log/server";
import { nativeColumns, type NativeRow } from "@/lib/native-log/storage-core";
import { resolveActivitySource } from "@/lib/cohort/sources";
const inputSchema = z.object({ recordId: z.uuid() }).strict();
export async function POST(request: NextRequest) {
  try {
    const { session, input } = await cohortRequest(request),
      checked = inputSchema.safeParse(input);
    if (!checked.success) throw new Error("INVALID_INPUT");
    const cohort = await loadCohort(session.user.id);
    if (!cohort?.enrollment.active) throw new Error("UNAUTHORIZED");
    const r = await adminClient()
      .from("cohort_records")
      .select("*")
      .eq("id", checked.data.recordId)
      .eq("owner_id", session.user.id)
      .single();
    if (r.error || !r.data || r.data.review_status === "superseded")
      throw new Error("UNAUTHORIZED");
    const row = r.data as CohortRecord;
    let a = cohortActivitySchema.parse(readCipher(row.content));
    if (a.sourceReference) {
      const source = await adminClient().from("native_log_drafts").select(nativeColumns).eq("owner_id", session.user.id).eq("id", a.sourceReference.draftId).single();
      if (source.error || !source.data) throw new Error("UNAVAILABLE");
      a = resolveActivitySource(session.user.id, source.data as unknown as NativeRow, a).activity;
    }
    const
      timezone = cohort.enrollment.timezone,
      date = wallTime(Date.parse(a.start), timezone).slice(0, 10);
    const review = await adminClient()
      .from("cohort_review_events")
      .select("content")
      .eq("owner_id", session.user.id)
      .eq("record_id", row.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (review.error) throw new Error("UNAVAILABLE");
    const reviewQuestion = review.data
      ? readCipher<{ question?: string }>(review.data.content).question
      : undefined;
    const document: NativeDraft = {
      ...newNativeDraft(
        nativeOwnerScope(session.user.id),
        date,
        timezone,
        "personal",
      ),
      correctsRecordId: row.id,
      ...(typeof reviewQuestion === "string" && reviewQuestion.trim()
        ? { reviewQuestion: reviewQuestion.slice(0, 500) }
        : {}),
      cohort: cohort.context,
      transcript: a.quote || a.activity,
      conversation: (a.followUpAnswers ?? []).map((reply) => ({
        ...reply,
        activityId: a.occurrenceId,
      })),
      activities: [
        {
          ...emptyNativeActivity(a.occurrenceId),
          sourceReplyIds: a.sourceReference?.replyIds ?? a.followUpAnswers?.map(reply => reply.id),
          activity: a.activity,
          startLocal: wallTime(Date.parse(a.start), timezone),
          endLocal: wallTime(Date.parse(a.end), timezone),
          node: a.node,
          sourceQuote: a.quote,
          context: a.context,
          proof: a.proof,
          community: a.workCommunity ?? cohort.context.houseId,
          lane: a.lane ?? "",
          direction: a.direction ?? "",
          intensity: a.intensity ?? "",
          confidence: a.confidence ?? "",
          sleepRest: a.sleepRest,
          manualFields: a.manualFields,
        },
      ],
    };
    const id = randomUUID();
    await writeNative(session, id, 0, {
      document,
      parts: {},
      totalParts: null,
    });
    if (coverageOpen(document)) await dispatchNativeProcessing(session.user.id, id, 1, "coverage");
    return privateJson({ path: `/day?date=${date}&draft=${id}` });
  } catch (error) {
    return cohortFailure(error);
  }
}
