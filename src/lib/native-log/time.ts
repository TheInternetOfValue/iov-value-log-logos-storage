const formatters = new Map<string, Intl.DateTimeFormat>();
const localFormatter = (timezone: string) => {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (formatters.size >= 100) formatters.clear();
    formatters.set(timezone, formatter);
  }
  return formatter;
};
export function wallTime(instant: number, timezone: string) {
  const parts = localFormatter(timezone).formatToParts(instant);
  const part = (name: string) => parts.find(value => value.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function timeCandidates(value: string, timezone: string): Array<{ iso: string; offset: string }> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const naive = Date.parse(value + ":00Z");
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value) return [];
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3600000;
    offsets.add((Date.parse(wallTime(sample, timezone) + ":00Z") - sample) / 60000);
  }
  return [...offsets].map(minutes => {
    const instant = naive - minutes * 60000;
    const offset = `${minutes >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
    return { iso: new Date(instant).toISOString(), offset };
  }).filter(item => wallTime(Date.parse(item.iso), timezone) === value).toSorted((a, b) => a.iso.localeCompare(b.iso));
}
export function resolveWallTime(value: string, timezone: string, offset = "") {
  const candidates = timeCandidates(value, timezone);
  if (offset) return candidates.find(item => item.offset === offset)?.iso ?? null;
  return candidates.length === 1 ? candidates[0].iso : null;
}

/** Split only an explicitly identified sleep/rest episode; other activities stay continuous. */
export function sleepSegments(start: string, end: string, timezone: string, split: boolean) {
  const segments: Array<{ start: string; end: string }> = [];
  let cursor = start;
  for (let guard = 0; guard < 32; guard++) {
    if (!split || wallTime(Date.parse(cursor), timezone).slice(0, 10) === wallTime(Date.parse(end) - 1, timezone).slice(0, 10)) {
      segments.push({ start: cursor, end }); return segments;
    }
    const date = wallTime(Date.parse(cursor), timezone).slice(0, 10);
    const next = new Date(Date.parse(date + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
    const midnight = resolveWallTime(next + "T00:00", timezone);
    if (!midnight || midnight <= cursor) throw new Error("TIME_REQUIRES_REVIEW");
    segments.push({ start: cursor, end: midnight }); cursor = midnight;
  }
  throw new Error("TIME_REQUIRES_REVIEW");
}
