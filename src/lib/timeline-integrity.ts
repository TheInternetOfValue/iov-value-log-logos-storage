export type TimelineSlice = {
  id: string;
  start_at: string;
  end_at: string;
  community: string;
  activity?: string;
  status?: string;
};

export type TimelineOverlap = {
  first: TimelineSlice;
  second: TimelineSlice;
};

type TimelineResult = PromiseLike<{ data: TimelineSlice[] | null; error: { message: string } | null }> & {
  eq(column: string, value: string): TimelineResult;
  neq(column: string, value: string): TimelineResult;
  order(column: string): TimelineResult;
  limit(count: number): TimelineResult;
};

type TimelineQuery = {
  select(columns: string): TimelineResult;
};

type TimelineDb = { from(table: string): unknown };

export const isActiveTimelineSlice = (slice: Pick<TimelineSlice, "status">) =>
  slice.status !== "superseded" && slice.status !== "reversed";

/** Half-open intervals make endpoint-touching records valid. */
export function findTimelineOverlaps(slices: TimelineSlice[]): TimelineOverlap[] {
  const milliseconds = (value: string) => new Date(value).getTime();
  const active = slices.filter(isActiveTimelineSlice).sort((a, b) =>
    milliseconds(a.start_at) - milliseconds(b.start_at)
    || milliseconds(a.end_at) - milliseconds(b.end_at)
    || a.id.localeCompare(b.id),
  );
  const overlaps: TimelineOverlap[] = [];
  for (let index = 0; index < active.length; index += 1) {
    for (let other = index + 1; other < active.length; other += 1) {
      if (milliseconds(active[other].start_at) >= milliseconds(active[index].end_at)) break;
      if (milliseconds(active[index].start_at) < milliseconds(active[other].end_at)
        && milliseconds(active[other].start_at) < milliseconds(active[index].end_at)) {
        overlaps.push({ first: active[index], second: active[other] });
      }
    }
  }
  return overlaps;
}

export function timelineOverlapError(overlap: TimelineOverlap) {
  return new Error(`timeline_overlap:${overlap.first.id}:${overlap.first.start_at}:${overlap.first.end_at}:${overlap.first.community}:${overlap.second.id}:${overlap.second.start_at}:${overlap.second.end_at}:${overlap.second.community}`);
}

export async function timelineOverlapsForOwner(
  db: TimelineDb, ownerId: string, candidates: TimelineSlice[], excludeIds: string[] = [],
) {
  const query = db.from("canonical_slices") as TimelineQuery;
  const { data, error } = await query
    .select("id,start_at,end_at,community,activity,status")
    .eq("owner_id", ownerId).order("start_at").limit(5000);
  if (error) throw new Error(error.message);
  const existing = (data ?? []).filter((slice) => isActiveTimelineSlice(slice) && !excludeIds.includes(slice.id));
  return findTimelineOverlaps([...existing, ...candidates]);
}

export async function assertTimelineIntegrity(
  db: TimelineDb, ownerId: string, candidates: TimelineSlice[], excludeIds: string[] = [],
) {
  const overlaps = await timelineOverlapsForOwner(db, ownerId, candidates, excludeIds);
  if (overlaps.length) throw timelineOverlapError(overlaps[0]);
}
