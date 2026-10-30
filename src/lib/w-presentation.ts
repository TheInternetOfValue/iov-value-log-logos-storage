import {
  FIXED12_DECIMALS,
  fixed12Add,
  fixed12DivideIntegers,
  fixed12Format,
  fixed12FromDecimal,
  type Fixed12,
} from "./fixed12";

export type WDecimal = string | number;

const DISPLAY_DECIMALS = 4;
const DISPLAY_SCALE = 10n ** BigInt(DISPLAY_DECIMALS);
const DISPLAY_DIVISOR = 10n ** BigInt(FIXED12_DECIMALS - DISPLAY_DECIMALS);
const SUB_THRESHOLD = DISPLAY_DIVISOR;

export function formatWMovement(value: WDecimal | null) {
  if (value === null) return "No completed W movement";
  const exact = toFixed12(value);
  if (exact === 0n) return "0.0000 W";
  const negative = exact < 0n;
  const absolute = negative ? -exact : exact;
  if (absolute < SUB_THRESHOLD) return `${negative ? "-" : "+"}<0.0001 W`;
  return `${negative ? "-" : "+"}${formatRoundedAbsolute(absolute)} W`;
}

export function formatWState(value: WDecimal | null) {
  if (value === null) return "No completed W";
  const exact = toFixed12(value);
  const negative = exact < 0n;
  const absolute = negative ? -exact : exact;
  return `${negative ? "-" : ""}${formatRoundedAbsolute(absolute)} W`;
}

export function sumW(values: WDecimal[]) {
  return fixed12Format(values.reduce<Fixed12>((total, value) => fixed12Add(total, toFixed12(value)), fixed12FromDecimal("0")));
}

export function isZeroW(value: WDecimal) {
  return toFixed12(value) === 0n;
}

function formatRoundedAbsolute(value: bigint) {
  const rounded = fixed12DivideIntegers(value, DISPLAY_DIVISOR);
  const whole = rounded / DISPLAY_SCALE;
  const fraction = String(rounded % DISPLAY_SCALE).padStart(DISPLAY_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

function toFixed12(value: WDecimal) {
  return fixed12FromDecimal(typeof value === "number" ? value.toFixed(FIXED12_DECIMALS) : value);
}
