import { isZeroW, sumW, type WDecimal } from "./w-presentation";

export type DailyMovementEvent = {
  id: string;
  settledAt: string;
  preW: WDecimal;
  change: WDecimal;
  postW: WDecimal;
};

export type DailyMovementProjection = {
  status: "completed" | "zero" | "pending" | "unavailable";
  openingW: WDecimal | null;
  closingW: WDecimal | null;
  netW: WDecimal | null;
  events: DailyMovementEvent[];
  settlements: DailyMovementEvent[];
  calculatedEventCount: number;
};

export function buildDailyMovementProjection(input: {
  events: DailyMovementEvent[];
  pending?: boolean;
}): DailyMovementProjection {
  const events = [...input.events].sort((left, right) => left.settledAt.localeCompare(right.settledAt));
  if (!events.length) {
    return {
      status: input.pending ? "pending" : "unavailable",
      openingW: null,
      closingW: null,
      netW: null,
      events: [],
      settlements: [],
      calculatedEventCount: 0,
    };
  }

  const settlements = events.filter((event) => !isZeroW(event.change));
  return {
    status: settlements.length ? "completed" : "zero",
    openingW: events[0].preW,
    closingW: events.at(-1)?.postW ?? events[0].postW,
    netW: sumW(events.map((event) => event.change)),
    events,
    settlements,
    calculatedEventCount: events.length,
  };
}
