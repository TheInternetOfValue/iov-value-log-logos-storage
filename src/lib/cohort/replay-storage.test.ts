import { expect, it } from "vitest";
import {
  calculateCohortReplay,
  type CohortActivity,
  type ReviewedActivity,
} from "./policy";
import {
  cohortReplayPatch,
  materialiseCohortReplay,
  type StoredCohortReplay,
} from "./replay-storage";
const item = (n: number): ReviewedActivity => {
  const id = `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const activity: CohortActivity = {
    id,
    occurrenceId: id,
    activity: "Synthetic walk",
    start: new Date(Date.UTC(2026, 9, 1, n)).toISOString(),
    end: new Date(Date.UTC(2026, 9, 1, n + 1)).toISOString(),
    node: "Physiology",
    quote: "Synthetic first-person account",
    context: "",
    proof: "",
    direction: "positive",
    intensity: "low",
    confidence: "observed",
    workCommunity: null,
    lane: null,
    sleepRest: false,
  };
  return { recordId: id, reviewId: `review-${n}`, activity, rate: null };
};
it("stores one changed event per append instead of quadratic full-history copies", () => {
  const runs = new Map<string, StoredCohortReplay>(),
    items: ReviewedActivity[] = [];
  let previous: ReturnType<typeof calculateCohortReplay> | null = null,
    parent: string | null = null,
    count = 0;
  for (let n = 1; n <= 100; n++) {
    items.push(item(n));
    const output = calculateCohortReplay(items),
      id = `run-${n}`,
      patch = cohortReplayPatch(output, previous, parent);
    count += patch.events.length;
    runs.set(id, patch);
    expect(materialiseCohortReplay(id, runs)).toEqual(output);
    previous = output;
    parent = id;
  }
  expect(count).toBe(100);
  expect(runs.size).toBe(100);
});
it("keeps an earlier branch intact while a correction replaces an occurrence and downstream values", () => {
  const original = [item(1), item(2)],
    a = calculateCohortReplay(original),
    runs = new Map<string, StoredCohortReplay>([
      ["a", cohortReplayPatch(a, null, null)],
    ]);
  const corrected = {
    ...item(1),
    recordId: "replacement",
    activity: {
      ...item(1).activity,
      id: "10000000-0000-4000-8000-000000000003",
      direction: "neutral" as const,
    },
  };
  const b = calculateCohortReplay([corrected, item(2)]),
    patch = cohortReplayPatch(b, a, "a");
  runs.set("b", patch);
  expect(patch.removedRecordIds).toEqual([original[0].recordId]);
  expect(materialiseCohortReplay("b", runs)).toEqual(b);
  expect(materialiseCohortReplay("a", runs)).toEqual(a);
  expect(b.events).toHaveLength(2);
});
it("reads a legacy complete replay and rejects missing or cyclic parents", () => {
  const full = calculateCohortReplay([item(1)]),
    runs = new Map<string, StoredCohortReplay>([["legacy", full]]);
  expect(materialiseCohortReplay("legacy", runs)).toEqual(full);
  expect(() => materialiseCohortReplay("missing", runs)).toThrow(
    "REPLAY_CHAIN_INCOMPLETE",
  );
  runs.set("cycle", cohortReplayPatch(full, full, "cycle"));
  expect(() => materialiseCohortReplay("cycle", runs)).toThrow(
    "REPLAY_CHAIN_INVALID",
  );
});
