export const removableCanonicalStatuses = [
  "validation_pending", "validated", "calculated", "validation_rejected",
] as const;

export function canRejectDraft(status: string) {
  return status === "drafted";
}

export function canRemoveCanonicalDuplicate(status: string) {
  return removableCanonicalStatuses.includes(status as typeof removableCanonicalStatuses[number]);
}

type ReplaySlice = { id: string; status: string };

/**
 * Reversal must include superseded history; recalculation must include only
 * active calculated slices. This keeps a duplicate's old effects out of the
 * projection while replaying the records that followed it.
 */
export function replaySliceSelection(slices: ReplaySlice[]) {
  return {
    reversalSliceIds: slices.filter((slice) => slice.status !== "reversed").map((slice) => slice.id),
    activeCalculatedSliceIds: slices.filter((slice) => slice.status === "calculated").map((slice) => slice.id),
  };
}
