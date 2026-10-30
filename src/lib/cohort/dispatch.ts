import "server-only";
import { valueLogOrigin } from "@/lib/app-origin";
import { reviewSignature } from "./review-worker";
import { cohortReviewOpen, cohortCalculationOpen } from "./storage";
import { anyDatedStageOpen } from "@/lib/field-station/dated-policy";
export async function dispatchCohortReview(owner: string) {
  if (!cohortReviewOpen() && !cohortCalculationOpen() && !anyDatedStageOpen("REVIEW") && !anyDatedStageOpen("CALCULATION")) return false;
  const body = JSON.stringify({ owner, expires: Date.now() + 120000 });
  try {
    const response = await fetch(
      `${valueLogOrigin()}/.netlify/functions/cohort-review-background`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-cohort-job": reviewSignature(body),
        },
        body,
        signal: AbortSignal.timeout(5000),
      },
    );
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
