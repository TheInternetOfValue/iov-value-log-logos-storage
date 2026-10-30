// Trusted grounding for rough spoken times. A time is accepted only when its
// clock words were said for that row; morning/evening may be settled by the
// order of the day, never guessed. Untimed rows keep the person's own words.
import { normalizeSpokenNumbers } from "./grounding";
import type { NativeActivity } from "./draft";

export const TIME_PRECISIONS = ["exact", "approximate", "period_inferred", "relative", "part_of_day", "unknown"] as const;
export type TimePrecision = (typeof TIME_PRECISIONS)[number];
export const PARTS_OF_DAY = ["early_morning", "morning", "midday", "afternoon", "evening", "night"] as const;

const approximation =
  /(?:\b(?:around|about|roughly|approximately|approx|nearly|almost|like|ish)\b|-ish\b|लगभग|करीब|क़रीब|तकरीबन|சுமார்|கிட்டத்தட்ட)/iu;
const comparable = (text: string) =>
  normalizeSpokenNumbers(text).replace(/[^\p{L}\p{M}\p{N}:]+/gu, " ").trim();

/** The spoken time words must occur in this row's own source, after number normalisation. */
export function spokenIn(source: string, spoken: string | null | undefined) {
  const words = spoken ? comparable(spoken) : "";
  return words.length > 0 && words.length <= 200 && comparable(source).includes(words);
}
export function isApproximate(spoken: string) {
  return approximation.test(normalizeSpokenNumbers(spoken));
}

/** Every reading of a bare clock: "8" is 08:00 or 20:00, "2:30" is 02:30 or 14:30. Durations are not clocks. */
export function bareClockMinutes(spoken: string) {
  const minutes = new Set<number>();
  for (const m of normalizeSpokenNumbers(spoken).matchAll(/(?<![\d:])(\d{1,2})(?::([0-5]\d))?(?![\d:])(?!\s*(?:hours?|hrs?|minutes?|mins?|घंटे|मिनट|மணி\s*நேர|நிமிட))/gu)) {
    const hour = Number(m[1]), minute = Number(m[2] || 0);
    if (hour > 23) continue;
    if (hour > 12) minutes.add(hour * 60 + minute);
    else if (hour >= 1) {
      minutes.add((hour % 12) * 60 + minute);
      minutes.add(((hour % 12) + 12) * 60 + minute);
    }
  }
  return minutes;
}

const minuteOf = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));

/**
 * A model clock for a rough or period-inferred time. It must be one reading
 * of a clock in the person's time words, on the selected date. Approximate
 * also needs an approximation word. Chronology is checked afterwards.
 */
export function roughLocalTime(value: string | null, spoken: string, date: string, precision: TimePrecision) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value) || value.slice(0, 10) !== date) return "";
  if (precision !== "approximate" && precision !== "period_inferred") return "";
  if (precision === "approximate" && !isApproximate(spoken)) return "";
  const normalized = value.slice(0, 16);
  return bareClockMinutes(spoken).has(minuteOf(normalized)) ? normalized : "";
}

const partLabels: Record<(typeof PARTS_OF_DAY)[number], string> = {
  early_morning: "Early morning", morning: "Morning", midday: "Midday", afternoon: "Afternoon", evening: "Evening", night: "Night",
};
export const partOfDayLabel = (part: (typeof PARTS_OF_DAY)[number]) => partLabels[part];

/** An explicit period word in the row's own words that agrees with the chosen half of the day. */
export function periodWordFits(source: string, startLocal: string) {
  if (!startLocal) return false;
  const text = normalizeSpokenNumbers(source);
  const morning = /\bmorning\b|सुबह|காலை/u.test(text), later = /\b(?:afternoon|evening|night|tonight)\b|दोपहर|शाम|रात|மதியம்|மாலை|இரவு/u.test(text);
  if (morning === later) return false;
  return morning ? minuteOf(startLocal) < 720 : minuteOf(startLocal) >= 720;
}

/** Rough row: a clock that is only one plausible reading. */
export type RoughRow = { activity: NativeActivity; position: number; rough: boolean; periodSupported?: boolean };

/**
 * Keep a rough or period-inferred start only where it fits the order of the
 * day: between the nearest firmly timed rows and, with only one of them, the
 * reading nearest to it. An explicit period word in the row's own words may
 * settle it instead. Anything else stays unknown.
 */
export function enforceChronology(rows: RoughRow[]) {
  // Sleep rows anchor the day too: "woke up at 6am" may be stored as the end of sleep.
  const ordered = rows.filter((row) => row.position >= 0).sort((a, b) => a.position - b.position);
  const anchor = (row: RoughRow, side: "before" | "after") =>
    side === "before" ? row.activity.endLocal || row.activity.startLocal : row.activity.startLocal || row.activity.endLocal;
  for (const [index, row] of ordered.entries()) {
    if (!row.rough || !row.activity.startLocal || row.activity.sleepRest) continue;
    const firm = (candidate: RoughRow) => !candidate.rough && Boolean(candidate.activity.startLocal || candidate.activity.endLocal);
    const before = ordered.slice(0, index).reverse().find(firm), after = ordered.slice(index + 1).find(firm);
    const start = row.activity.startLocal;
    const between = (value: string) => (!before || anchor(before, "before") <= value) && (!after || value <= anchor(after, "after"));
    // The other half of the day must not fit as well; then the order settles nothing.
    const minute = minuteOf(start), other = (minute + 720) % 1440;
    const alternative = `${start.slice(0, 11)}${String(Math.floor(other / 60)).padStart(2, "0")}:${String(other % 60).padStart(2, "0")}`;
    // An account moves forward: with one anchor, take the reading nearest to it.
    const nearest = before && after ? !between(alternative)
      : before ? !(alternative >= anchor(before, "before") && alternative < start)
      : after ? !(alternative <= anchor(after, "after") && alternative > start) : false;
    const fits = (row.periodSupported ? between(start) : between(start) && nearest)
      && (!row.activity.endLocal || row.activity.endLocal > start);
    if (!fits) {
      row.activity.startLocal = "";
      row.activity.endLocal = "";
      row.activity.timePrecision = "unknown";
      row.activity.timeNote = undefined;
    }
  }
}
