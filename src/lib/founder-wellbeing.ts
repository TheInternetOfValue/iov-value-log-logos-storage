import {
  fixed12Add,
  fixed12Clamp,
  fixed12Divide,
  fixed12Format,
  fixed12FromDecimal,
  fixed12FromRatio,
  fixed12Multiply,
  fixed12Number,
  fixed12Subtract,
  timestampToEpochMicroseconds,
} from "./fixed12";

export const FOUNDER_POLICY_ID = "hob-wellbecoming-founder-v0.1" as const;
export const FOUNDER_POLICY_VERSION = "0.1.0" as const;
export const FOUNDER_POLICY_CONTENT_HASH = "e1601b1804716f9ab39314340386d6280993c36db7cb85c364d7a2607477f471" as const;
export const FOUNDER_CALCULATION_VERSION = "founder-wellbeing-v0.1.1-fixed12" as const;

/**
 * Canonical arithmetic keeps twelve decimal places after each governed step.
 * Public interfaces must round WellbeingScore values to three decimal places
 * unless a policy-specific presentation rule declares a lower precision.
 */
export const FOUNDER_NUMERIC_PRECISION = {
  auditDecimalPlaces: 12,
  publicWellbeingDecimalPlaces: 3,
} as const;

export const FOUNDER_COMPONENTS = [
  "Physiology", "Emotion", "Feeling", "Thought", "Habit", "Performance",
] as const;

export type FounderComponent = typeof FOUNDER_COMPONENTS[number];
export type FounderState = Record<FounderComponent, number>;
export type FounderDecimalState = Record<FounderComponent, string | number>;
export type FounderIntensity = "low" | "medium" | "high";
export type FounderDirection = "positive" | "negative";

export const FOUNDER_WEIGHTS: Readonly<Record<FounderComponent, number>> = {
  Physiology: 0.2,
  Emotion: 0.1,
  Feeling: 0.1,
  Thought: 0.2,
  Habit: 0.1,
  Performance: 0.3,
};

export const FOUNDER_BANDS = [
  { lower: 100, lowerInclusive: true, upper: 200, rate: 0.05, adjustmentFactor: 0.01 },
  { lower: 200, lowerInclusive: false, upper: 300, rate: 0.05, adjustmentFactor: 0.009 },
  { lower: 300, lowerInclusive: false, upper: 400, rate: 0.04, adjustmentFactor: 0.008 },
  { lower: 400, lowerInclusive: false, upper: 500, rate: 0.04, adjustmentFactor: 0.007 },
  { lower: 500, lowerInclusive: false, upper: 600, rate: 0.03, adjustmentFactor: 0.006 },
  { lower: 600, lowerInclusive: false, upper: 700, rate: 0.03, adjustmentFactor: 0.005 },
  { lower: 700, lowerInclusive: false, upper: 800, rate: 0.02, adjustmentFactor: 0.004 },
  { lower: 800, lowerInclusive: false, upper: 900, rate: 0.01, adjustmentFactor: 0.003 },
  { lower: 900, lowerInclusive: false, upper: 1000, rate: 0.005, adjustmentFactor: 0.002 },
] as const;

const intensityRatio: Record<FounderIntensity, readonly [bigint, bigint]> = {
  low: [1n, 3n],
  medium: [2n, 3n],
  high: [1n, 1n],
};

export const founderAuditRounded = (value: number) => fixed12Number(fixed12FromDecimal(value));
const rounded = founderAuditRounded;

function assertScale(value: number, label: string) {
  if (!Number.isFinite(value) || value < 100 || value > 1000) throw new Error(`${label.toUpperCase()}_OUT_OF_RANGE`);
}

export function founderRatingToComponent(rating: number) {
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) throw new Error("FOUNDER_RATING_OUT_OF_RANGE");
  return rounded(rating * 100);
}

export function founderStateFromRatings(ratings: FounderState) {
  return Object.fromEntries(FOUNDER_COMPONENTS.map((component) => [component, founderRatingToComponent(ratings[component])])) as FounderState;
}

export function founderStateFromDecimals(state: FounderDecimalState): FounderState {
  return Object.fromEntries(FOUNDER_COMPONENTS.map((component) => {
    const exact = fixed12FromDecimal(state[component]);
    const numeric = fixed12Number(exact);
    assertScale(numeric, component);
    return [component, numeric];
  })) as FounderState;
}

export function calculateFounderW(state: FounderState) {
  for (const component of FOUNDER_COMPONENTS) assertScale(state[component], component);
  const exact = FOUNDER_COMPONENTS.reduce(
    (sum, component) => fixed12Add(sum, fixed12Multiply(fixed12FromDecimal(state[component]), fixed12FromDecimal(FOUNDER_WEIGHTS[component]))),
    fixed12FromDecimal(0),
  );
  return fixed12Number(exact);
}

export function calculateFounderRollups(state: FounderState) {
  return {
    PhysicalHealth: rounded(state.Physiology),
    MentalHealth: fixed12Number(fixed12Add(
      fixed12Add(
        fixed12Multiply(fixed12FromDecimal("0.25"), fixed12FromDecimal(state.Emotion)),
        fixed12Multiply(fixed12FromDecimal("0.25"), fixed12FromDecimal(state.Feeling)),
      ),
      fixed12Multiply(fixed12FromDecimal("0.5"), fixed12FromDecimal(state.Thought)),
    )),
    FinancialHealth: fixed12Number(fixed12Add(
      fixed12Multiply(fixed12FromDecimal("0.25"), fixed12FromDecimal(state.Habit)),
      fixed12Multiply(fixed12FromDecimal("0.75"), fixed12FromDecimal(state.Performance)),
    )),
  };
}

export function founderBandFor(value: number) {
  assertScale(value, "component");
  const exact = fixed12FromDecimal(value);
  const band = FOUNDER_BANDS.find((candidate) =>
    (candidate.lowerInclusive ? exact >= fixed12FromDecimal(candidate.lower) : exact > fixed12FromDecimal(candidate.lower))
    && exact <= fixed12FromDecimal(candidate.upper)
  );
  if (!band) throw new Error("FOUNDER_COMPONENT_BAND_NOT_FOUND");
  return band;
}

export function calculateFounderTransition(input: {
  state: FounderState;
  component: FounderComponent;
  direction: FounderDirection;
  intensity: FounderIntensity;
}) {
  const before = input.state[input.component];
  const wBefore = calculateFounderW(input.state);
  const band = founderBandFor(before);
  const beforeExact = fixed12FromDecimal(before);
  const maximumMoveExact = fixed12Multiply(
    fixed12Multiply(beforeExact, fixed12FromDecimal(band.rate)),
    fixed12FromDecimal(band.adjustmentFactor),
  );
  const [intensityNumerator, intensityDenominator] = intensityRatio[input.intensity];
  const unsignedDelta = fixed12Multiply(maximumMoveExact, fixed12FromRatio(intensityNumerator, intensityDenominator));
  const deltaComponentExact = input.direction === "positive"
    ? unsignedDelta
    : fixed12Subtract(fixed12FromDecimal(0), unsignedDelta);
  const afterExact = fixed12Clamp(
    fixed12Add(beforeExact, deltaComponentExact),
    fixed12FromDecimal(100),
    fixed12FromDecimal(1000),
  );
  const maximumMove = fixed12Number(maximumMoveExact);
  const after = fixed12Number(afterExact);
  const nextState = { ...input.state, [input.component]: after };
  const wAfter = calculateFounderW(nextState);
  return {
    policyId: FOUNDER_POLICY_ID,
    policyVersion: FOUNDER_POLICY_VERSION,
    policyContentHash: FOUNDER_POLICY_CONTENT_HASH,
    calculationVersion: FOUNDER_CALCULATION_VERSION,
    component: input.component,
    direction: input.direction,
    intensity: input.intensity,
    componentBefore: before,
    componentBeforeAmount: fixed12Format(beforeExact),
    componentAfter: after,
    componentAfterAmount: fixed12Format(afterExact),
    bandRate: band.rate,
    adjustmentFactor: band.adjustmentFactor,
    maximumMove,
    maximumMoveAmount: fixed12Format(maximumMoveExact),
    intensityFactor: fixed12Number(fixed12FromRatio(intensityNumerator, intensityDenominator)),
    deltaComponent: rounded(after - before),
    deltaComponentAmount: fixed12Format(fixed12Subtract(afterExact, beforeExact)),
    wBefore,
    wBeforeAmount: fixed12Format(fixed12FromDecimal(wBefore)),
    wAfter,
    wAfterAmount: fixed12Format(fixed12FromDecimal(wAfter)),
    deltaW: rounded(wAfter - wBefore),
    deltaWAmount: fixed12Format(fixed12Subtract(fixed12FromDecimal(wAfter), fixed12FromDecimal(wBefore))),
    stateAfter: nextState,
  };
}

export type OccurrenceSlice = { id: string; startAt: string; endAt: string };

export function validatedDurationMicroseconds(slices: OccurrenceSlice[]) {
  if (!slices.length) throw new Error("OCCURRENCE_REQUIRES_SLICE");
  const intervals = slices.map((slice) => {
    const start = timestampToEpochMicroseconds(slice.startAt);
    const end = timestampToEpochMicroseconds(slice.endAt);
    if (end <= start) throw new Error("INVALID_OCCURRENCE_SLICE");
    return { start, end };
  }).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1);
  let total = 0n;
  let start = intervals[0].start;
  let end = intervals[0].end;
  for (const interval of intervals.slice(1)) {
    if (interval.start <= end) end = interval.end > end ? interval.end : end;
    else {
      total += end - start;
      start = interval.start;
      end = interval.end;
    }
  }
  total += end - start;
  return total;
}

export function validatedDurationMinutesExact(slices: OccurrenceSlice[]) {
  return fixed12FromRatio(validatedDurationMicroseconds(slices), 60_000_000n);
}

export function validatedDurationMinutes(slices: OccurrenceSlice[]) {
  return fixed12Number(validatedDurationMinutesExact(slices));
}

export function calculateFounderPerformanceValue(input: {
  state: FounderState;
  rate: number | string;
  unit: string;
  slices: OccurrenceSlice[];
}) {
  const rateExact = fixed12FromDecimal(input.rate);
  if (rateExact < 0n) throw new Error("INVALID_VCOM_RATE");
  if (!input.unit.trim()) throw new Error("VCOM_UNIT_REQUIRED");
  const wBefore = calculateFounderW(input.state);
  const validatedDurationExact = validatedDurationMinutesExact(input.slices);
  const durationHoursExact = fixed12Divide(validatedDurationExact, fixed12FromDecimal(60));
  const vcomEventExact = fixed12Multiply(durationHoursExact, rateExact);
  const normalizedWBeforeExact = fixed12Divide(fixed12FromDecimal(wBefore), fixed12FromDecimal(1000));
  const vcperformanceEventExact = fixed12Multiply(normalizedWBeforeExact, vcomEventExact);
  const validatedDuration = fixed12Number(validatedDurationExact);
  const vcomEvent = fixed12Number(vcomEventExact);
  const vcperformanceEvent = fixed12Number(vcperformanceEventExact);
  return {
    calculationVersion: FOUNDER_CALCULATION_VERSION,
    wBefore,
    normalizedWBefore: fixed12Number(normalizedWBeforeExact),
    validatedDurationMinutes: validatedDuration,
    rate: fixed12Number(rateExact),
    vcomEvent,
    communityRateAmount: fixed12Format(rateExact),
    communityRateUnit: "USD_per_hour" as const,
    validatedDurationMinutesExact: fixed12Format(validatedDurationExact),
    validatedDurationMicroseconds: validatedDurationMicroseconds(input.slices).toString(),
    validatedDurationHours: fixed12Format(durationHoursExact),
    vcomEventAmount: fixed12Format(vcomEventExact),
    vcomUnit: input.unit,
    vcomScope: "event" as const,
    vcomSemantics: "duration_expanded_event_value" as const,
    vcperformanceEvent,
    vcperformanceEventAmount: fixed12Format(vcperformanceEventExact),
  };
}

export function performanceTransitionKey(input: {
  subjectId: string;
  sourceCommunity: string;
  sourceAttestationId: string;
  policyVersion?: string;
}) {
  for (const [key, value] of Object.entries(input)) if (!value?.trim()) throw new Error(`${key.toUpperCase()}_REQUIRED`);
  return [input.subjectId, input.sourceCommunity, input.sourceAttestationId, input.policyVersion ?? FOUNDER_POLICY_VERSION]
    .map((value) => encodeURIComponent(value)).join("::");
}

export function founderSafetyMetadata(state: FounderState) {
  const values = FOUNDER_COMPONENTS.map((component) => ({ component, value: state[component] }));
  const lowest = values.reduce((candidate, value) => value.value < candidate.value ? value : candidate);
  const scores = values.map(({ value }) => value);
  return {
    lowestComponent: lowest.component,
    lowestComponentValue: lowest.value,
    componentDispersion: rounded(Math.max(...scores) - Math.min(...scores)),
  };
}
