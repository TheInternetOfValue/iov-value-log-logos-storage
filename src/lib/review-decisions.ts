import { earliestOpenDate, isFutureItem } from "@/lib/chronology";
import { expectedValidationRole, type Community, type ValidationRole, type WellbeingNode } from "@/lib/domain";
import { localDateFor } from "@/lib/format";

export type ReviewDecisionSlice = {
  id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  community: Community;
  wellbeing_node: WellbeingNode;
  [key: string]: unknown;
};

export type ReviewDecisionDraft = {
  id: string;
  start_at: string;
  timezone: string;
};

export type ReviewDecisionBatch<T extends ReviewDecisionSlice = ReviewDecisionSlice> = {
  key: string;
  date: string;
  community: Community;
  role: ValidationRole;
  items: T[];
  available: boolean;
};

export type ReviewDecisionSummary<T extends ReviewDecisionSlice = ReviewDecisionSlice> = {
  approvalBatchCount: number;
  approvalRecordCount: number;
  availableBatches: ReviewDecisionBatch<T>[];
  blockedBatches: ReviewDecisionBatch<T>[];
  queuedBatches: ReviewDecisionBatch<T>[];
  oldestEligibleDate: string | null;
  legacyDecisionCount: number;
  hasConflict: boolean;
  hasRetryBlocker: boolean;
  navCount: number;
  navBlocked: boolean;
};

export function reviewDecisionSummary<T extends ReviewDecisionSlice>(input: {
  pending: T[];
  drafts?: ReviewDecisionDraft[];
  hasConflict?: boolean;
  hasRetryBlocker?: boolean;
  now?: number;
}): ReviewDecisionSummary<T> {
  const now = input.now ?? Date.now();
  const pending = input.pending.filter((item) => !isFutureItem(item, now));
  const drafts = (input.drafts ?? []).filter((item) => !isFutureItem(item, now));
  const oldestEligibleDate = earliestOpenDate([...drafts, ...pending], now);
  const grouped = new Map<string, ReviewDecisionBatch<T>>();

  for (const item of pending) {
    const date = localDateFor(item.start_at, item.timezone);
    const role = expectedValidationRole(item.wellbeing_node, item.community);
    const key = `${date}:${role}:${item.community}`;
    const batch = grouped.get(key) ?? { key, date, community: item.community, role, items: [], available: false };
    batch.items.push(item);
    grouped.set(key, batch);
  }

  const hasConflict = Boolean(input.hasConflict);
  const batches = [...grouped.values()]
    .sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key))
    .map((batch) => ({ ...batch, available: !hasConflict && batch.date === oldestEligibleDate }));

  return {
    approvalBatchCount: batches.length,
    approvalRecordCount: pending.length,
    availableBatches: batches.filter((batch) => batch.available),
    blockedBatches: batches.filter((batch) => hasConflict && batch.date === oldestEligibleDate),
    queuedBatches: batches.filter((batch) => batch.date !== oldestEligibleDate),
    oldestEligibleDate,
    legacyDecisionCount: drafts.length,
    hasConflict,
    hasRetryBlocker: Boolean(input.hasRetryBlocker),
    navCount: batches.length + drafts.length,
    navBlocked: hasConflict || Boolean(input.hasRetryBlocker),
  };
}
