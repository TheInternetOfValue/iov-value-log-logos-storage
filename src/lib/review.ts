export type ReviewLens = "previous-to-now" | "now-to-tom" | "mixed";

type DatedSlice = { start_at: string };

type ReviewSession = {
  received_at: string;
  draft_slices: DatedSlice[];
};

/**
 * A private reading cue only. It must never be persisted or used by protocol
 * actions, validation, calculation, or audit logic.
 */
export function sessionReviewLens(slices: DatedSlice[], now = Date.now()): ReviewLens {
  const futureCount = slices.filter((slice) => new Date(slice.start_at).getTime() > now).length;
  if (futureCount === slices.length && slices.length > 0) return "now-to-tom";
  if (futureCount > 0) return "mixed";
  return "previous-to-now";
}

export function futureSliceCount(slices: DatedSlice[], now = Date.now()) {
  return slices.filter((slice) => new Date(slice.start_at).getTime() > now).length;
}

function sessionActivityStart(session: ReviewSession) {
  return session.draft_slices.reduce(
    (earliest, slice) => slice.start_at < earliest ? slice.start_at : earliest,
    session.draft_slices[0]?.start_at ?? session.received_at,
  );
}

/**
 * Session history reads like an inbox: newest activity date first. This is
 * deliberately separate from approval eligibility, which remains oldest
 * unresolved IST date first in the server actions.
 */
export function newestReviewSessionsFirst<T extends ReviewSession>(sessions: T[]) {
  return [...sessions].sort((a, b) => {
    const activityOrder = sessionActivityStart(b).localeCompare(sessionActivityStart(a));
    return activityOrder || b.received_at.localeCompare(a.received_at);
  });
}
