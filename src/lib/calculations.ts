import {
  CREDIT_CALCULATOR_VERSION, W_CALCULATOR_VERSION,
  confidenceSchema, impactDirectionSchema, impactIntensitySchema,
} from "@/lib/domain";
import type { z } from "zod";

type Direction = z.infer<typeof impactDirectionSchema>;
type Intensity = z.infer<typeof impactIntensitySchema>;
type Confidence = z.infer<typeof confidenceSchema>;

export const MINIMUM_EFFECTIVE_DURATION_MINUTES = 5;
export const DAILY_W_MOVEMENT_CAP = 5;

const BANDS = [
  { min: 100, max: 200, rate: 0.05, adjustment: 0.01 },
  { min: 201, max: 300, rate: 0.05, adjustment: 0.009 },
  { min: 301, max: 400, rate: 0.04, adjustment: 0.008 },
  { min: 401, max: 500, rate: 0.04, adjustment: 0.007 },
  { min: 501, max: 600, rate: 0.03, adjustment: 0.006 },
  { min: 601, max: 700, rate: 0.03, adjustment: 0.005 },
  { min: 701, max: 800, rate: 0.02, adjustment: 0.004 },
  { min: 801, max: 900, rate: 0.01, adjustment: 0.003 },
  { min: 901, max: 1000, rate: 0.005, adjustment: 0.002 },
] as const;

const directionFactor: Record<Direction, number> = { positive: 1, neutral: 0, negative: -1 };
const intensityFactor: Record<Intensity, number> = { low: 0.5, medium: 1, high: 1.5 };
const confidenceFactor: Record<Confidence, number> = { observed: 1, inferred: 0.75, uncertain: 0.5 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export type WTransitionInput = {
  preSliceW: number;
  direction: Direction;
  intensity: Intensity;
  confidence: Confidence;
  durationMinutes: number;
  movementAlreadyAppliedToday: number;
};

export function calculateWTransition(input: WTransitionInput) {
  if (input.preSliceW < 100 || input.preSliceW > 1000) throw new Error("W_OUT_OF_RANGE");
  const band = BANDS.find(({ min, max }) => input.preSliceW >= min && input.preSliceW <= max);
  if (!band) throw new Error("W_BAND_NOT_FOUND");

  const minimumDurationLimited = input.durationMinutes < MINIMUM_EFFECTIVE_DURATION_MINUTES;
  const rawFactor = minimumDurationLimited ? 0 :
    directionFactor[input.direction] * band.rate * band.adjustment *
    intensityFactor[input.intensity] * confidenceFactor[input.confidence];
  const requestedPostW = clamp(input.preSliceW * (1 + rawFactor), 100, 1000);
  const requestedChange = requestedPostW - input.preSliceW;
  const dayLower = -DAILY_W_MOVEMENT_CAP - input.movementAlreadyAppliedToday;
  const dayUpper = DAILY_W_MOVEMENT_CAP - input.movementAlreadyAppliedToday;
  const appliedChange = clamp(requestedChange, dayLower, dayUpper);
  const postSliceW = clamp(input.preSliceW + appliedChange, 100, 1000);

  return {
    calculatorVersion: W_CALCULATOR_VERSION,
    preSliceW: rounded(input.preSliceW),
    requestedPostW: rounded(requestedPostW),
    postSliceW: rounded(postSliceW),
    requestedChange: rounded(requestedChange),
    appliedChange: rounded(appliedChange),
    capLimited: Math.abs(appliedChange - requestedChange) > 1e-9,
    minimumDurationLimited,
    formulaInputs: {
      ...input,
      bandRate: band.rate,
      adjustmentFactor: band.adjustment,
      signedEffect: directionFactor[input.direction],
      intensityFactor: intensityFactor[input.intensity],
      confidenceFactor: confidenceFactor[input.confidence],
      durationFactor: 1,
      dailyMovementCap: DAILY_W_MOVEMENT_CAP,
      minimumEffectiveDurationMinutes: MINIMUM_EFFECTIVE_DURATION_MINUTES,
    },
  };
}

export function calculatePerformanceCredit(input: {
  durationMinutes: number;
  preSliceW: number;
  creditRatePerHour: number;
}) {
  if (input.durationMinutes <= 0 || input.preSliceW < 100 || input.preSliceW > 1000 || input.creditRatePerHour < 0) {
    throw new Error("INVALID_CREDIT_INPUT");
  }
  const result = (input.durationMinutes / 60) * (input.preSliceW / 1000) * input.creditRatePerHour;
  return {
    calculatorVersion: CREDIT_CALCULATOR_VERSION,
    result: rounded(result),
    formulaInputs: { ...input, durationHours: rounded(input.durationMinutes / 60), normalizedW: input.preSliceW / 1000 },
  };
}
