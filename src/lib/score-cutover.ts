import { isPostGenesisEvent } from "./founder-genesis";
import { localDateFor } from "./format";

export const SCORE_TIMEZONE = "Asia/Kolkata";

export type ScoreRegime = "historical_pilot" | "genesis_day" | "canonical_founder";

export function scoreRegimeForDate(date: string, genesisBoundaryAt: string): ScoreRegime {
  const genesisDate = localDateFor(genesisBoundaryAt, SCORE_TIMEZONE);
  if (date < genesisDate) return "historical_pilot";
  if (date === genesisDate) return "genesis_day";
  return "canonical_founder";
}

export function scoreBranchForOccurrence(startAt: string, genesisBoundaryAt: string) {
  return isPostGenesisEvent(startAt, genesisBoundaryAt) ? "canonical_founder" as const : "historical_pilot" as const;
}

export function displayScoreForDate(input: {
  date: string;
  genesisBoundaryAt: string;
  historicalPilotW: number | null;
  canonicalFounderW: number | null;
}) {
  const regime = scoreRegimeForDate(input.date, input.genesisBoundaryAt);
  return {
    regime,
    value: regime === "historical_pilot" ? input.historicalPilotW : input.canonicalFounderW,
    label: regime === "historical_pilot" ? "Historical Pilot W" : "HouseOfBros WellbeingScore",
  };
}

export type FounderViewSlice = {
  id: string;
  start_at: string;
  end_at: string;
  timezone?: string | null;
  activity: string;
  wellbeing_node?: string | null;
  slice_type: string;
  community: "house_of_bros" | "iov" | "gfe";
};

type SliceRelation = FounderViewSlice | FounderViewSlice[] | null;

export type FounderViewEvent = {
  id: string;
  canonical_slice_id: string;
  event_kind: "performance" | "nonperformance";
  vcperformance_event_amount: number | string | null;
  w_before: number | string;
  w_after: number | string;
  delta_w: number | string;
  protocol_finality_status: "final" | "provisional" | null;
  payability_status: "non_payable";
  canonical_slices: SliceRelation;
};

export function founderEventsAsReplayRows(events: FounderViewEvent[]) {
  const wEvents = events.filter((event) => Number(event.delta_w) !== 0).map((event) => ({
    id: event.id,
    canonical_slice_id: event.canonical_slice_id,
    pre_slice_w: event.w_before,
    post_slice_w: event.w_after,
    applied_change: event.delta_w,
    canonical_slices: event.canonical_slices,
  }));
  const creditEvents = events.filter((event) => event.event_kind === "performance" && event.vcperformance_event_amount !== null).map((event) => ({
    id: event.id,
    canonical_slice_id: event.canonical_slice_id,
    formula_result: event.vcperformance_event_amount!,
    canonical_slices: event.canonical_slices,
  }));
  return { wEvents, creditEvents };
}
