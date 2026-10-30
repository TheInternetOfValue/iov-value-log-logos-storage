import { localDateFor } from "./format";
import type { CommunityCode } from "./community-value";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type IdentityReplaySlice = {
  id: string;
  start_at: string;
  end_at: string;
  timezone?: string | null;
  activity: string;
  wellbeing_node?: string | null;
  slice_type: string;
  community: CommunityCode;
};

type SliceRelation = IdentityReplaySlice | IdentityReplaySlice[] | null;

export type IdentityReplayWEvent = {
  id: string;
  canonical_slice_id: string;
  pre_slice_w: number | string;
  post_slice_w: number | string;
  applied_change: number | string;
  canonical_slices: SliceRelation;
};

export type IdentityReplayCreditEvent = {
  id: string;
  canonical_slice_id: string;
  formula_result: number | string;
  canonical_slices: SliceRelation;
};

export type IdentityReplayEvent = {
  id: string;
  kind: "wellbeing" | "performance";
  canonical_slice_id: string;
  settles_at: string;
  begins_at: string;
  timezone: string;
  activity: string;
  wellbeing_node: string | null;
  pre_w: number | null;
  post_w: number | null;
  applied_w: number | null;
  resulting_w: number | null;
  performance: { credits: number; community: CommunityCode } | null;
};

export type IdentityReplay = {
  date: string;
  opening_w: number | null;
  closing_w: number | null;
  net_w: number;
  transitions: IdentityReplayEvent[];
  contribution_totals: Record<"iov" | "gfe", number>;
};

export function buildIdentityReplay(input: {
  date: string;
  wEvents: IdentityReplayWEvent[];
  wReversalIds?: Iterable<string>;
  creditEvents: IdentityReplayCreditEvent[];
  creditReversalIds?: Iterable<string>;
}): IdentityReplay {
  const wReversals = new Set(input.wReversalIds ?? []);
  const creditReversals = new Set(input.creditReversalIds ?? []);
  const creditsBySlice = new Map<string, { id: string; credits: number; community: CommunityCode; slice: IdentityReplaySlice }>();
  const contribution_totals = { iov: 0, gfe: 0 };

  for (const event of input.creditEvents) {
    if (creditReversals.has(event.id)) continue;
    const slice = firstSlice(event.canonical_slices);
    if (!slice || localDateFor(slice.end_at, slice.timezone ?? DEFAULT_TIMEZONE) !== input.date) continue;
    const credits = number(event.formula_result);
    if (slice.community === "iov" || slice.community === "gfe") contribution_totals[slice.community] += credits;
    creditsBySlice.set(event.canonical_slice_id, { id: event.id, credits, community: slice.community, slice });
  }

  const wTransitions = input.wEvents
    .filter((event) => !wReversals.has(event.id))
    .map((event) => ({ event, slice: firstSlice(event.canonical_slices) }))
    .filter((item): item is { event: IdentityReplayWEvent; slice: IdentityReplaySlice } => Boolean(item.slice))
    .filter(({ slice }) => localDateFor(slice.end_at, slice.timezone ?? DEFAULT_TIMEZONE) === input.date)
    .sort((left, right) => left.slice.end_at.localeCompare(right.slice.end_at))
    .map(({ event, slice }) => ({
      id: event.id,
      kind: "wellbeing" as const,
      canonical_slice_id: event.canonical_slice_id,
      settles_at: slice.end_at,
      begins_at: slice.start_at,
      timezone: slice.timezone ?? DEFAULT_TIMEZONE,
      activity: slice.activity,
      wellbeing_node: slice.wellbeing_node ?? null,
      pre_w: number(event.pre_slice_w),
      post_w: number(event.post_slice_w),
      applied_w: number(event.applied_change),
      resulting_w: number(event.post_slice_w),
      performance: (() => {
        const credit = creditsBySlice.get(event.canonical_slice_id);
        return credit ? { credits: credit.credits, community: credit.community } : null;
      })(),
    }));

  const wSliceIds = new Set(wTransitions.map((transition) => transition.canonical_slice_id));
  const performanceEvents: IdentityReplayEvent[] = [...creditsBySlice.entries()]
    .filter(([sliceId]) => !wSliceIds.has(sliceId))
    .map(([canonical_slice_id, credit]) => ({
      id: credit.id,
      kind: "performance" as const,
      canonical_slice_id,
      settles_at: credit.slice.end_at,
      begins_at: credit.slice.start_at,
      timezone: credit.slice.timezone ?? DEFAULT_TIMEZONE,
      activity: credit.slice.activity,
      wellbeing_node: credit.slice.wellbeing_node ?? null,
      pre_w: null,
      post_w: null,
      applied_w: null,
      resulting_w: null,
      performance: { credits: credit.credits, community: credit.community },
    }));

  const transitions: IdentityReplayEvent[] = [...wTransitions, ...performanceEvents]
    .sort((left, right) => left.settles_at.localeCompare(right.settles_at) || left.id.localeCompare(right.id));
  let state: number | null = wTransitions[0]?.pre_w ?? null;
  for (const transition of transitions) {
    if (transition.kind === "wellbeing") state = transition.post_w;
    transition.resulting_w = state;
  }

  return {
    date: input.date,
    opening_w: wTransitions[0]?.pre_w ?? null,
    closing_w: wTransitions.at(-1)?.post_w ?? null,
    net_w: wTransitions.reduce((total, transition) => total + (transition.applied_w ?? 0), 0),
    transitions,
    contribution_totals,
  };
}

/** @deprecated Use IdentityReplayEvent. Kept for consumer compatibility. */
export type IdentityReplayTransition = IdentityReplayEvent;

function firstSlice(value: SliceRelation): IdentityReplaySlice | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function number(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
