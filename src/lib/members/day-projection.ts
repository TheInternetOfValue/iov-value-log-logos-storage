import type { DayClockActivity } from "@/components/DayClock";
import { dateSchema } from "./entries";

export type MemberDaySource = {
  ownerId: string;
  sourceId: string;
  occurrenceId: string;
  activity: string;
  node: string | null;
  start?: string | null;
  end?: string | null;
  state: "pending" | "reviewed" | "unassessed" | "clarification";
  detail?: string;
  movement?: string | null;
  versionPriority?: number;
};
export type MemberDayActivity = DayClockActivity & {
  sourceId: string;
  occurrenceId: string;
  state: MemberDaySource["state"];
  startAt: string;
  endAt: string;
};
const rank = { unassessed: 0, clarification: 1, pending: 2, reviewed: 3 };
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;

/** Pure projection. All input queries must also be owner-bound on the server. */
export function projectMemberDay(
  owner: string,
  date: string,
  sources: MemberDaySource[],
) {
  dateSchema.parse(date);
  const midnight = Date.parse(`${date}T00:00:00+05:30`),
    next = midnight + 86400000;
  const selected = new Map<string, MemberDaySource>();
  for (const source of sources) {
    if (source.ownerId !== owner) continue;
    const current = selected.get(source.occurrenceId);
    const priority = source.versionPriority ?? 0, currentPriority = current?.versionPriority ?? 0;
    if (!current || priority > currentPriority || priority === currentPriority && rank[source.state] > rank[current.state]) {
      selected.set(source.occurrenceId, source); continue;
    }
    if (priority < currentPriority || rank[source.state] < rank[current.state]) continue;
    // Never merge different approval versions into a fabricated wider interval.
    if (current.sourceId !== source.sourceId) {
      if (current.start !== source.start || current.end !== source.end) throw new Error("OCCURRENCE_VERSION_CONFLICT");
      continue;
    }
    if (current.start && current.end && source.start && source.end) {
      if (Date.parse(current.end) < Date.parse(source.start) || Date.parse(source.end) < Date.parse(current.start)) throw new Error("OCCURRENCE_INTERVAL_CONFLICT");
      selected.set(source.occurrenceId, { ...current, start: new Date(Math.min(Date.parse(current.start),Date.parse(source.start))).toISOString(), end: new Date(Math.max(Date.parse(current.end),Date.parse(source.end))).toISOString() });
    }
  }
  const notes: MemberDaySource[] = [], timed = new Map<string,MemberDaySource>();
  for (const source of selected.values()) {
    if (!source.start || !source.end) { notes.push(source); continue; }
    const start=Date.parse(source.start), end=Date.parse(source.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start) throw new Error("INVALID_DAY_INTERVAL");
    if (start>=next || end<=midnight) continue;
    timed.set(source.occurrenceId,source);
  }
  const activities = [...timed.values()]
    .map<MemberDayActivity>((source) => {
      const start = Math.max(midnight, Date.parse(source.start!)),
        end = Math.min(next, Date.parse(source.end!));
      const startMinute = (start - midnight) / 60000,
        endMinute = (end - midnight) / 60000;
      const completedMovement =
        source.movement != null &&
        Date.parse(source.end!) >= midnight &&
        Date.parse(source.end!) < next;
      return {
        id: source.occurrenceId,
        occurrenceId: source.occurrenceId,
        sourceId: source.sourceId,
        completedMovement,
        reviewHref: `/review#record-${source.sourceId}`,
        activity: source.activity,
        node: source.node ?? "Unknown",
        detail: source.detail ?? "",
        start: clock(startMinute),
        end: clock(endMinute),
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        startMinute,
        endMinute,
        state: source.state,
        result:
          source.state === "reviewed"
            ? completedMovement
              ? source.movement!
              : "Reviewed"
            : source.state === "unassessed"
              ? "Unassessed"
              : source.state === "clarification"
                ? "Needs clarification"
                : "In Review",
        needsReview: source.state === "clarification",
        calculating: source.state === "pending",
        type: source.node === "Performance" ? "performance" : "wellbeing",
        conflict: false,
      };
    })
    .sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id));
  let covered = 0,
    through = 0;
  for (const activity of activities) {
    covered += Math.max(
      0,
      activity.endMinute - Math.max(through, activity.startMinute),
    );
    through = Math.max(through, activity.endMinute);
    activity.conflict = activities.some(
      (other) =>
        other.id !== activity.id &&
        other.startMinute < activity.endMinute &&
        other.endMinute > activity.startMinute,
    );
  }
  return {
    date,
    timezone: "Asia/Kolkata" as const,
    activities,
    notes: [...new Map(notes.map((n) => [n.sourceId, n])).values()],
    unknownMinutes: 1440 - covered,
  };
}
