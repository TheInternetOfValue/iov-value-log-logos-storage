export const DAY_MINUTES = 24 * 60;

export function calculationIsActiveForDay({
  dayEnd,
  replay,
  sliceStatuses,
}: {
  dayEnd: string;
  replay: { status: string; fromTimestamp: string | null } | null;
  sliceStatuses: string[];
}) {
  if (!replay || replay.status !== "running" || !sliceStatuses.includes("validated")) return false;
  return !replay.fromTimestamp || new Date(replay.fromTimestamp) <= new Date(dayEnd);
}

export function minuteToClockDegrees(minute: number) {
  return (Math.max(0, Math.min(DAY_MINUTES, minute)) / DAY_MINUTES) * 360 - 90;
}

export function clockPoint(minute: number, radius: number, centre = 320) {
  const radians = (minuteToClockDegrees(minute) * Math.PI) / 180;
  return {
    x: Number((centre + radius * Math.cos(radians)).toFixed(3)),
    y: Number((centre + radius * Math.sin(radians)).toFixed(3)),
  };
}

export function clockArcPath(startMinute: number, endMinute: number, radius: number, centre = 320) {
  const start = Math.max(0, Math.min(DAY_MINUTES, startMinute));
  const end = Math.max(start, Math.min(DAY_MINUTES, endMinute));
  if (end <= start) return "";

  const arcEnd = end - start >= DAY_MINUTES ? end - 0.001 : end;
  const from = clockPoint(start, radius, centre);
  const to = clockPoint(arcEnd, radius, centre);
  const largeArc = arcEnd - start > DAY_MINUTES / 2 ? 1 : 0;
  return `M ${from.x.toFixed(3)} ${from.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${to.x.toFixed(3)} ${to.y.toFixed(3)}`;
}
