import {
  calculateCohortReplay,
  verifyCohortReplay,
  COHORT_POLICY,
  COHORT_CALCULATION_VERSION,
  cohortReviewBlockers,
  type CohortActivity,
  type ReviewedActivity,
} from "@/lib/cohort/policy";

import { DATED_POLICY, DATED_QA_POLICY, isDatedPolicy } from "./ids";
export { DATED_POLICY, DATED_QA_POLICY, isDatedPolicy } from "./ids";
export const DATED_CALCULATION = "field-station-non-performance-v1-fixed12";
export const DATED_BOUNDARY = "2026-10-25T18:30:00.000Z";
export const DATED_WINDOW_END = "2026-10-28T18:30:00.000Z";
export const DATED_TIMEZONE = "Asia/Kolkata";
export function datedStageOpen(
  policy: string,
  stage: "ENROLLMENT" | "REVIEW" | "CALCULATION",
) {
  if (!isDatedPolicy(policy)) return false;
  const value = process.env[`VALUE_LOG_DATED_${stage}`];
  return value === "open" || (policy === DATED_QA_POLICY && value === "qa");
}
export function cohortPolicyStageOpen(
  policy: string,
  stage: "ENROLLMENT" | "REVIEW" | "CALCULATION",
) {
  return isDatedPolicy(policy)
    ? datedStageOpen(policy, stage)
    : policy === COHORT_POLICY &&
        process.env[`VALUE_LOG_COHORT_${stage}`] === "open";
}
export const anyDatedStageOpen = (
  stage: "ENROLLMENT" | "REVIEW" | "CALCULATION",
) =>
  [DATED_POLICY, DATED_QA_POLICY].some((policy) =>
    datedStageOpen(policy, stage),
  );

/** Inputs must come from verified server admission/auth evidence, never request fields. */
export function datedEligibility(input: {
  verifiedDid: string | null;
  admittedAt?: string | null;
  signedInAt?: string | null;
  persisted?: boolean;
  founder?: boolean;
}) {
  if (
    input.founder ||
    !input.verifiedDid ||
    !/^did:iov:member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      input.verifiedDid,
    )
  )
    return false;
  if (input.persisted === true) return true;
  return [input.admittedAt, input.signedInAt].some((value) => {
    if (!value) return false;
    const at = Date.parse(value);
    return (
      at >= Date.parse(DATED_BOUNDARY) && at < Date.parse(DATED_WINDOW_END)
    );
  });
}

export function datedActivityOutcome(
  activity: CohortActivity,
  now = Date.now(),
) {
  if (activity.node === "Performance") return "unassessed" as const;
  return cohortReviewBlockers(activity, [], DATED_BOUNDARY, now).length
    ? ("clarification" as const)
    : ("pending" as const);
}

/** Only already reviewed non-Performance occurrences enter this policy's replay. */
export function calculateDatedReplay(
  records: ReviewedActivity[],
  policy = DATED_POLICY,
) {
  if (!isDatedPolicy(policy)) throw new Error("UNKNOWN_POLICY");
  const eligible = records.filter((r) => r.activity.node !== "Performance");
  for (const record of eligible) {
    if (datedActivityOutcome(record.activity) !== "pending")
      throw new Error("ASSESSMENT_FACTS_REQUIRED");
  }
  // A midnight-spanning occurrence changes the state only after completion.
  const output = calculateCohortReplay(eligible, { order: "completion" });
  return { ...output, policy, calculationVersion: DATED_CALCULATION };
}
export function verifyDatedReplay(
  records: ReviewedActivity[],
  output: ReturnType<typeof calculateCohortReplay>,
  policy: string,
) {
  return (
    isDatedPolicy(policy) &&
    output.policy === policy &&
    output.calculationVersion === DATED_CALCULATION &&
    verifyCohortReplay(
      records.filter((r) => r.activity.node !== "Performance"),
      {
        ...output,
        policy: COHORT_POLICY,
        calculationVersion: COHORT_CALCULATION_VERSION,
      },
      { order: "completion" },
    )
  );
}
