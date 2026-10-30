export function chartTickIndices(dayCount: number) {
  if (dayCount <= 0) return new Set<number>();

  const interval = dayCount <= 7 ? 1 : dayCount <= 14 ? 2 : 5;
  const indices = new Set<number>();

  for (let index = 0; index < dayCount; index += interval) indices.add(index);
  indices.add(dayCount - 1);

  return indices;
}

export function isCanonicalTrendRange(value: string | undefined): value is "7" | "14" | "30" {
  return value === "7" || value === "14" || value === "30";
}

export function isIsoDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
