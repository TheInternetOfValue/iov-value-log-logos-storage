import type { calculateCohortReplay } from "./policy";
type Replay = ReturnType<typeof calculateCohortReplay>;
export type CohortReplayPatch = Omit<Replay, "events"> & {
  format: "cohort-replay-patch-v1";
  parentReplayId: string | null;
  removedRecordIds: string[];
  events: Replay["events"];
};
export type StoredCohortReplay = Replay | CohortReplayPatch;
const isPatch = (r: StoredCohortReplay): r is CohortReplayPatch =>
  "format" in r && r.format === "cohort-replay-patch-v1";
/** Normal appends retain only the new events. Corrections retain only the affected results. */
export function cohortReplayPatch(
  output: Replay,
  previous: Replay | null,
  parentReplayId: string | null,
): CohortReplayPatch {
  const before = new Map((previous?.events ?? []).map((e) => [e.recordId, e])),
    current = new Set(output.events.map((e) => e.recordId));
  return {
    ...output,
    format: "cohort-replay-patch-v1",
    parentReplayId,
    removedRecordIds: [...before.keys()].filter((id) => !current.has(id)),
    events: output.events.filter(
      (e) => JSON.stringify(e) !== JSON.stringify(before.get(e.recordId)),
    ),
  };
}
export function materialiseCohortReplay(
  id: string,
  runs: ReadonlyMap<string, StoredCohortReplay>,
): Replay {
  const chain: StoredCohortReplay[] = [],
    seen = new Set<string>();
  let pointer: string | null = id;
  while (pointer) {
    if (seen.has(pointer)) throw new Error("REPLAY_CHAIN_INVALID");
    seen.add(pointer);
    const r = runs.get(pointer);
    if (!r) throw new Error("REPLAY_CHAIN_INCOMPLETE");
    chain.push(r);
    pointer = isPatch(r) ? r.parentReplayId : null;
  }
  const latest = chain[0];
  if (!latest) throw new Error("REPLAY_CHAIN_INCOMPLETE");
  const events = new Map<string, Replay["events"][number]>();
  for (const r of chain.toReversed()) {
    if (!isPatch(r)) events.clear();
    else for (const removed of r.removedRecordIds) events.delete(removed);
    for (const event of r.events) events.set(event.recordId, event);
  }
  return {
    policy: latest.policy,
    calculationVersion: latest.calculationVersion,
    arithmeticSource: latest.arithmeticSource,
    status: latest.status,
    state: latest.state,
    score: latest.score,
    events: [...events.values()].toSorted(
      (a, b) =>
        (latest.calculationVersion === "field-station-non-performance-v1-fixed12" ? Date.parse(a.end) - Date.parse(b.end) : a.start.localeCompare(b.start)) || a.recordId.localeCompare(b.recordId),
    ),
  };
}
