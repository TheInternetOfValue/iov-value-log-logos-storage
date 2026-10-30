import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { privateJson } from "@/lib/members/http";
import { cohortFailure, cohortRequest } from "@/lib/cohort/http";
import { cohortCommand, loadCohort, replayCohort } from "@/lib/cohort/server";
import { dispatchCohortReview } from "@/lib/cohort/dispatch";
import { encryptNarrative } from "@/lib/crypto";
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("process") }).strict(),
  z
    .object({
      action: z.literal("appeal"),
      recordId: z.uuid(),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export async function POST(request: NextRequest) {
  try {
    const { session, input } = await cohortRequest(request),
      checked = command.safeParse(input);
    if (!checked.success) throw new Error("INVALID_INPUT");
    const scope = await loadCohort(session.user.id);
    if (!scope?.enrollment.active || !scope.enrollment.review_consent)
      throw new Error("UNAUTHORIZED");
    if (checked.data.action === "appeal") {
      await cohortCommand(session.user.id, "appeal", {
        id: randomUUID(),
        recordId: checked.data.recordId,
        content: encryptNarrative(
          JSON.stringify({ rationale: checked.data.reason }),
        ),
      });
      console.info("cohort_appeal_created", { count: 1 });
      await replayCohort(session.user.id);
    }
    const queued = await dispatchCohortReview(session.user.id);
    return privateJson({ saved: true, queued });
  } catch (error) {
    return cohortFailure(error);
  }
}
