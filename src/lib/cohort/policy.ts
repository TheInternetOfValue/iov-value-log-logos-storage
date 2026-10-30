import { MANUAL_ACTIVITY_FIELDS } from "@/lib/native-log/draft";
import { z } from "zod";
import {
  FOUNDER_BANDS,
  FOUNDER_CALCULATION_VERSION,
  FOUNDER_COMPONENTS,
  FOUNDER_WEIGHTS,
  calculateFounderTransition,
  calculateFounderW,
  type FounderState,
} from "@/lib/founder-wellbeing";
import {
  fixed12Divide,
  fixed12Format,
  fixed12FromDecimal,
  fixed12Multiply,
  fixed12Subtract,
  fixed12Number,
} from "@/lib/fixed12";
import { wellbeingNodeSchema, saoLaneSchema } from "@/lib/domain";

export const COHORT_POLICY = "field-station-assumed-700-v1";
export const COHORT_REVIEWER = "system:field-station-reviewer:v1";
export const COHORT_OPERATOR = "review-operator@example.invalid";
export const COHORT_WEIGHTS = FOUNDER_WEIGHTS;
export const COHORT_CALCULATION_VERSION = "field-station-wellbeing-v1-fixed12";
export const COHORT_ARITHMETIC_SOURCE = "founder-wellbeing-v0.1.1-fixed12";
if (String(FOUNDER_CALCULATION_VERSION) !== COHORT_ARITHMETIC_SOURCE)
  throw new Error("COHORT_POLICY_REVIEW_REQUIRED");
export const initialCohortState = (): FounderState =>
  Object.fromEntries(
    FOUNDER_COMPONENTS.map((node) => [node, 700]),
  ) as FounderState;
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((value) => {
    try {
      return Intl.supportedValuesOf("currency").includes(value);
    } catch {
      return false;
    }
  });
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const salarySchema = z
  .object({ annualGross: money, currency: currencySchema })
  .strict();
export function salaryRate(salary: z.infer<typeof salarySchema>) {
  const checked = salarySchema.parse(salary);
  return {
    hourly: fixed12Format(
      fixed12Divide(
        fixed12FromDecimal(checked.annualGross),
        fixed12FromDecimal(2080),
      ),
    ),
    currency: checked.currency,
    basis: "gross_annual_cash_divided_by_2080" as const,
  };
}
export const cohortActivitySchema = z
  .object({
    id: z.uuid(),
    occurrenceId: z.uuid(),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    activity: z.string().trim().min(1).max(500),
    node: wellbeingNodeSchema,
    quote: z.string().max(3000),
    context: z.string().max(2000),
    proof: z.string().max(2000),
    workCommunity: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{1,63}$/)
      .nullable(),
    lane: saoLaneSchema.nullable(),
    direction: z.enum(["positive", "neutral", "negative"]).nullable(),
    intensity: z.enum(["low", "medium", "high"]).nullable(),
    confidence: z.enum(["observed", "inferred", "uncertain"]).nullable(),
    sleepRest: z.boolean(),
    followUpAnswers: z
      .array(z.object({ id: z.uuid(), text: z.string().max(50000) }).strict())
      .max(40)
      .optional(),
    sourceReference: z
      .object({
        draftId: z.uuid(),
        documentRevision: z.number().int().min(0),
        replyIds: z.array(z.uuid()).max(40),
      })
      .strict()
      .optional(),
    manualFields: z.array(z.enum(MANUAL_ACTIVITY_FIELDS)).max(14).optional(),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.end) > Date.parse(value.start),
    "Finish must follow start",
  );
export type CohortActivity = z.infer<typeof cohortActivitySchema>;
export type ReviewedActivity = {
  recordId: string;
  activity: CohortActivity;
  reviewId: string;
  rate: ReturnType<typeof salaryRate> | null;
};
export function cohortReviewBlockers(
  activity: CohortActivity,
  memberships: string[],
  boundary: string,
  now = Date.now(),
) {
  const reasons: string[] = [];
  if (Date.parse(activity.start) < Date.parse(boundary))
    reasons.push("before_starting_boundary");
  if (Date.parse(activity.end) > now) reasons.push("activity_not_completed");
  if (
    activity.node === "Performance" &&
    (!activity.workCommunity ||
      !memberships.includes(activity.workCommunity) ||
      !activity.lane)
  )
    reasons.push("work_membership_or_route_required");
  if (
    !activity.direction ||
    (activity.direction !== "neutral" && !activity.intensity) ||
    activity.confidence !== "observed"
  )
    reasons.push("reported_effect_requires_confirmation");
  return reasons;
}
/** Shared arithmetic; no founder appointments, rate resolution or live founder branches. */
export function calculateCohortReplay(
  records: ReviewedActivity[],
  options: { order?: "start" | "completion" } = {},
) {
  let state = initialCohortState();
  const seen = new Set<string>();
  const events = records
    .toSorted(
      (a, b) =>
        (options.order === "completion"
          ? Date.parse(a.activity.end) - Date.parse(b.activity.end)
          : a.activity.start.localeCompare(b.activity.start)) ||
        a.recordId.localeCompare(b.recordId),
    )
    .map((record) => {
      const item = cohortActivitySchema.parse(record.activity);
      if (seen.has(item.occurrenceId)) throw new Error("DUPLICATE_OCCURRENCE");
      seen.add(item.occurrenceId);
      const before = calculateFounderW(state);
      const minutes = fixed12Divide(
        fixed12FromDecimal(Date.parse(item.end) - Date.parse(item.start)),
        fixed12FromDecimal(60000),
      );
      const hours = fixed12Divide(minutes, fixed12FromDecimal(60));
      const vcom =
        item.node === "Performance" && record.rate
          ? fixed12Multiply(fixed12FromDecimal(record.rate.hourly), hours)
          : null;
      const performanceValue =
        vcom === null
          ? null
          : fixed12Multiply(
              fixed12Divide(
                fixed12FromDecimal(before),
                fixed12FromDecimal(1000),
              ),
              vcom,
            );
      if (item.direction && item.direction !== "neutral" && item.intensity)
        state = calculateFounderTransition({
          state,
          component: item.node,
          direction: item.direction,
          intensity: item.intensity,
        }).stateAfter;
      const after = calculateFounderW(state);
      return {
        recordId: record.recordId,
        reviewId: record.reviewId,
        occurrenceId: item.occurrenceId,
        start: item.start,
        end: item.end,
        node: item.node,
        before,
        after,
        delta: fixed12Number(
          fixed12Subtract(
            fixed12FromDecimal(after),
            fixed12FromDecimal(before),
          ),
        ),
        state: { ...state },
        currency: vcom === null ? null : record.rate!.currency,
        hourlyRate: vcom === null ? null : record.rate!.hourly,
        vcom: vcom === null ? null : fixed12Format(vcom),
        performanceValue:
          performanceValue === null ? null : fixed12Format(performanceValue),
        valuationReason:
          item.node !== "Performance"
            ? "not_applicable"
            : vcom === null
              ? "salary_rate_unavailable"
              : "participant_declared_salary",
        payability: "non_payable",
      };
    });
  return {
    policy: COHORT_POLICY,
    calculationVersion: COHORT_CALCULATION_VERSION,
    arithmeticSource: COHORT_ARITHMETIC_SOURCE,
    status: "provisional" as const,
    state,
    score: calculateFounderW(state),
    events,
  };
}
export function verifyCohortReplay(
  input: ReviewedActivity[],
  output: ReturnType<typeof calculateCohortReplay>,
  options: { order?: "start" | "completion" } = {},
) {
  if (
    output.events.length !== input.length ||
    output.policy !== COHORT_POLICY ||
    output.calculationVersion !== COHORT_CALCULATION_VERSION ||
    output.arithmeticSource !== COHORT_ARITHMETIC_SOURCE ||
    output.status !== "provisional"
  )
    return false;
  let previous = initialCohortState(),
    score = 700;
  const ordered = input.toSorted(
    (a, b) =>
      (options.order === "completion"
        ? Date.parse(a.activity.end) - Date.parse(b.activity.end)
        : a.activity.start.localeCompare(b.activity.start)) ||
      a.recordId.localeCompare(b.recordId),
  );
  const seen = new Set<string>();
  for (const [index, event] of output.events.entries()) {
    const source = ordered[index];
    if (
      !source ||
      source.recordId !== event.recordId ||
      source.reviewId !== event.reviewId ||
      source.activity.occurrenceId !== event.occurrenceId ||
      seen.has(event.occurrenceId) ||
      event.before !== score
    )
      return false;
    seen.add(event.occurrenceId);
    if (
      event.node !== source.activity.node ||
      event.start !== source.activity.start ||
      event.end !== source.activity.end ||
      event.payability !== "non_payable"
    )
      return false;
    const beforeComponent = previous[source.activity.node],
      band = FOUNDER_BANDS.find(
        (b) =>
          (b.lowerInclusive
            ? beforeComponent >= b.lower
            : beforeComponent > b.lower) && beforeComponent <= b.upper,
      );
    if (!band) return false;
    const factor =
      source.activity.intensity === "high"
        ? 1
        : source.activity.intensity === "medium"
          ? 2 / 3
          : source.activity.intensity === "low"
            ? 1 / 3
            : 0;
    const sign =
      source.activity.direction === "positive"
        ? 1
        : source.activity.direction === "negative"
          ? -1
          : 0;
    const expectedComponent = Math.min(
      1000,
      Math.max(
        100,
        beforeComponent +
          beforeComponent * band.rate * band.adjustmentFactor * factor * sign,
      ),
    );
    if (Math.abs(event.state[source.activity.node] - expectedComponent) > 1e-9)
      return false;

    if (
      Object.entries(event.state).some(
        ([node, value]) =>
          !Number.isFinite(value) ||
          value < 100 ||
          value > 1000 ||
          (node !== event.node &&
            value !== previous[node as keyof FounderState]),
      )
    )
      return false;
    const weighted = FOUNDER_COMPONENTS.reduce(
      (total, node) => total + event.state[node] * COHORT_WEIGHTS[node],
      0,
    );
    if (
      Math.abs(weighted - event.after) > 1e-9 ||
      Math.abs(event.delta - (event.after - event.before)) > 1e-9
    )
      return false;
    if (
      source.activity.direction === "neutral" &&
      JSON.stringify(previous) !== JSON.stringify(event.state)
    )
      return false;
    const expectedValue =
      source.activity.node === "Performance" && source.rate
        ? (Number(source.rate.hourly) *
            (Date.parse(source.activity.end) -
              Date.parse(source.activity.start))) /
          3600000
        : null;
    if (
      expectedValue === null
        ? event.vcom !== null || event.performanceValue !== null
        : event.vcom === null ||
          Math.abs(Number(event.vcom) - expectedValue) >
            Math.max(1e-8, expectedValue * 1e-12) ||
          Math.abs(
            Number(event.performanceValue) -
              (expectedValue * event.before) / 1000,
          ) > Math.max(1e-8, expectedValue * 1e-12) ||
          event.currency !== source.rate?.currency
    )
      return false;
    previous = event.state;
    score = event.after;
  }
  return (
    Math.abs(output.score - score) < 1e-9 &&
    JSON.stringify(output.state) === JSON.stringify(previous)
  );
}
