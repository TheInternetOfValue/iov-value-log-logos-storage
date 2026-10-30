export const FIXED12_DECIMALS = 12;
export const FIXED12_SCALE = 1_000_000_000_000n;
export const FIXED12_MAX_ABSOLUTE_SCALED = 10n ** 30n - 1n;

export type Fixed12 = bigint & { readonly __fixed12: unique symbol };

function asFixed12(value: bigint) {
  if (value > FIXED12_MAX_ABSOLUTE_SCALED || value < -FIXED12_MAX_ABSOLUTE_SCALED) {
    throw new Error("FIXED12_OVERFLOW");
  }
  return value as Fixed12;
}

function roundHalfEven(quotient: bigint, remainder: bigint, divisor: bigint) {
  if (remainder === 0n) return quotient;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const absoluteDivisor = divisor < 0n ? -divisor : divisor;
  const doubled = absoluteRemainder * 2n;
  if (doubled < absoluteDivisor) return quotient;
  const direction = (remainder < 0n) === (divisor < 0n) ? 1n : -1n;
  if (doubled > absoluteDivisor) return quotient + direction;
  return quotient % 2n === 0n ? quotient : quotient + direction;
}

export function fixed12DivideIntegers(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) throw new Error("FIXED12_DIVISION_BY_ZERO");
  return roundHalfEven(numerator / denominator, numerator % denominator, denominator);
}

export function fixed12FromDecimal(value: string | number) {
  const source = typeof value === "number" ? String(value) : value.trim();
  const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("INVALID_FIXED12_DECIMAL");
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  const retained = (fraction.slice(0, FIXED12_DECIMALS) + "0".repeat(FIXED12_DECIMALS)).slice(0, FIXED12_DECIMALS);
  let scaled = whole * FIXED12_SCALE + BigInt(retained);
  if (fraction.length > FIXED12_DECIMALS) {
    const discarded = fraction.slice(FIXED12_DECIMALS);
    const denominator = 10n ** BigInt(discarded.length);
    const rounded = roundHalfEven(scaled, BigInt(discarded), denominator);
    scaled = rounded;
  }
  return asFixed12(sign * scaled);
}

export function fixed12FromRatio(numerator: bigint, denominator: bigint) {
  return asFixed12(fixed12DivideIntegers(numerator * FIXED12_SCALE, denominator));
}

export function fixed12Add(left: Fixed12, right: Fixed12) {
  return asFixed12(left + right);
}

export function fixed12Subtract(left: Fixed12, right: Fixed12) {
  return asFixed12(left - right);
}

export function fixed12Multiply(left: Fixed12, right: Fixed12) {
  return asFixed12(fixed12DivideIntegers(left * right, FIXED12_SCALE));
}

export function fixed12Divide(left: Fixed12, right: Fixed12) {
  if (right === 0n) throw new Error("FIXED12_DIVISION_BY_ZERO");
  return asFixed12(fixed12DivideIntegers(left * FIXED12_SCALE, right));
}

export function fixed12Clamp(value: Fixed12, minimum: Fixed12, maximum: Fixed12) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function fixed12Format(value: Fixed12) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / FIXED12_SCALE;
  const fraction = String(absolute % FIXED12_SCALE).padStart(FIXED12_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function fixed12Number(value: Fixed12) {
  return Number(fixed12Format(value));
}

export function timestampToEpochMicroseconds(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error("INVALID_TIMESTAMP_MICROSECONDS");
  const wholeSecondMilliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(wholeSecondMilliseconds)) throw new Error("INVALID_TIMESTAMP_MICROSECONDS");
  const microseconds = BigInt((match[2] ?? "").padEnd(6, "0"));
  return BigInt(wholeSecondMilliseconds) * 1000n + microseconds;
}

export function fixed12DurationHours(startAt: string, endAt: string) {
  const durationMicroseconds = timestampToEpochMicroseconds(endAt) - timestampToEpochMicroseconds(startAt);
  if (durationMicroseconds <= 0n) throw new Error("INVALID_OCCURRENCE_SLICE");
  return fixed12FromRatio(durationMicroseconds, 3_600_000_000n);
}
