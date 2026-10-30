import source from "../../docs/bharathi-puthiya-aathichudi.json";

export type AathichudiItem = {
  number: number;
  "புதிய ஆத்திசூடி": string;
  "in English": string;
  "எளிய பொருள்": string;
  explanation: string;
};

const CYCLE_LENGTH = 110;
const CYCLE_EPOCH = "2026-01-01";

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Daily Bharathi requires an ISO calendar date; received ${value}.`);
  const [, year, month, day] = match;
  const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (instant.getUTCFullYear() !== Number(year) || instant.getUTCMonth() !== Number(month) - 1 || instant.getUTCDate() !== Number(day)) {
    throw new Error(`Daily Bharathi received an invalid calendar date: ${value}.`);
  }
  return instant;
}

function validateItems(items: unknown): readonly AathichudiItem[] {
  if (!Array.isArray(items) || items.length !== CYCLE_LENGTH) {
    throw new Error(`Daily Bharathi requires exactly ${CYCLE_LENGTH} source entries.`);
  }
  const numbers = new Set<number>();
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("Daily Bharathi contains an invalid source entry.");
    const entry = item as Partial<AathichudiItem>;
    if (!Number.isInteger(entry.number) || entry.number! < 1 || entry.number! > CYCLE_LENGTH || numbers.has(entry.number!) ||
      !entry["புதிய ஆத்திசூடி"]?.trim() || !entry["in English"]?.trim() || !entry["எளிய பொருள்"]?.trim() || !entry.explanation?.trim()) {
      throw new Error("Daily Bharathi source entries must be complete and numbered uniquely from 1 to 110.");
    }
    numbers.add(entry.number!);
  }
  return items as AathichudiItem[];
}

export const AATHICHUDI_ITEMS = validateItems(source.items);

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function daysSinceEpoch(date: string) {
  return Math.round((parseDate(date).getTime() - parseDate(CYCLE_EPOCH).getTime()) / 86_400_000);
}

function seedForCycle(cycle: number) {
  let hash = 2_166_136_261;
  const value = `bharathi-puthiya-aathichudi:${cycle}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function cycleOrder(cycle: number) {
  const order = Array.from({ length: CYCLE_LENGTH }, (_, index) => index);
  const random = seededRandom(seedForCycle(cycle));
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

/**
 * Returns the date-derived daily reading. Each 110-day cycle is a deterministic
 * seeded permutation, so every source entry appears exactly once in a cycle.
 */
export function dailyBharathiForDate(date: string): AathichudiItem {
  const day = daysSinceEpoch(date);
  const cycle = Math.floor(day / CYCLE_LENGTH);
  const position = positiveModulo(day, CYCLE_LENGTH);
  return AATHICHUDI_ITEMS[cycleOrder(cycle)[position]];
}
