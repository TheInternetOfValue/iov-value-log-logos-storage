import { localDateFor } from "@/lib/format";

export type ChronologyItem = {
  start_at: string;
  timezone: string;
};

export function isFutureItem(item: ChronologyItem, now = Date.now()) {
  return new Date(item.start_at).getTime() > now;
}

export function earliestOpenDate(items: ChronologyItem[], now = Date.now()) {
  return items
    .filter((item) => !isFutureItem(item, now))
    .map((item) => localDateFor(item.start_at, item.timezone))
    .sort()[0] ?? null;
}

export function isChronologicallyEligible(item: ChronologyItem, openDate: string | null, now = Date.now()) {
  return !isFutureItem(item, now) && openDate !== null && localDateFor(item.start_at, item.timezone) === openDate;
}
