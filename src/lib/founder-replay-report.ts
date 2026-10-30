import { createHash } from "node:crypto";
import {
  buildFounderReplay,
  type FounderReplayBaseline,
  type FounderReplaySlice,
  type FounderStateRevision,
  type FounderValueEvent,
} from "./founder-replay";
import { FOUNDER_NUMERIC_PRECISION, founderAuditRounded } from "./founder-wellbeing";
import { fixed12Format, fixed12FromDecimal, fixed12Subtract } from "./fixed12";

export type FounderReplayDryRunInput = {
  cutoffAt: string;
  source: string;
  baseline: FounderReplayBaseline;
  slices: FounderReplaySlice[];
  previousReplay: {
    id: string;
    completedAt: string;
    endingW: number;
    revisions: FounderStateRevision[];
    values: FounderValueEvent[];
  };
  invariantSnapshot: Record<string, unknown>;
};

type NumericDifference = { old: string | null; next: string | null; change: string | null };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function difference(oldValue: number | string | null | undefined, nextValue: number | string | null | undefined): NumericDifference {
  const old = oldValue == null ? null : fixed12Format(fixed12FromDecimal(oldValue));
  const next = nextValue == null ? null : fixed12Format(fixed12FromDecimal(nextValue));
  return {
    old,
    next,
    change: old === null || next === null
      ? null
      : fixed12Format(fixed12Subtract(fixed12FromDecimal(next), fixed12FromDecimal(old))),
  };
}

function transitionDelta(revisions: FounderStateRevision[], occurrenceId: string) {
  const revision = revisions.find((item) => item.activityOccurrenceId === occurrenceId);
  return revision?.componentBefore === null || revision?.componentAfter === null || revision?.componentBefore === undefined || revision?.componentAfter === undefined
    ? null
    : founderAuditRounded(revision.componentAfter - revision.componentBefore);
}

function eventByOccurrence(values: FounderValueEvent[]) {
  return new Map(values.map((value) => [value.activityOccurrenceId, value]));
}

export function buildFounderReplayDryRunReport(input: FounderReplayDryRunInput) {
  const next = buildFounderReplay({ baseline: input.baseline, slices: input.slices, mode: "founder_v0_1_live" });
  const oldValues = eventByOccurrence(input.previousReplay.values);
  const nextValues = eventByOccurrence(next.values);
  const occurrenceIds = [...new Set([...oldValues.keys(), ...nextValues.keys()])].sort((left, right) => {
    const leftEvent = nextValues.get(left) ?? oldValues.get(left)!;
    const rightEvent = nextValues.get(right) ?? oldValues.get(right)!;
    return leftEvent.activityOccurrenceId.localeCompare(rightEvent.activityOccurrenceId);
  });
  const differences = occurrenceIds.map((occurrenceId) => {
    const oldEvent = oldValues.get(occurrenceId);
    const nextEvent = nextValues.get(occurrenceId);
    return {
      activityOccurrenceId: occurrenceId,
      eventKind: nextEvent?.eventKind ?? oldEvent?.eventKind ?? null,
      sourceCommunity: nextEvent?.sourceCommunity ?? oldEvent?.sourceCommunity ?? null,
      performanceImpactStatus: nextEvent?.performanceImpactStatus ?? oldEvent?.performanceImpactStatus ?? null,
      settlementStatus: nextEvent?.settlementStatus ?? oldEvent?.settlementStatus ?? null,
      componentDelta: difference(
        transitionDelta(input.previousReplay.revisions, occurrenceId),
        transitionDelta(next.revisions, occurrenceId),
      ),
      wBefore: difference(oldEvent?.wBefore, nextEvent?.wBefore),
      wAfter: difference(oldEvent?.wAfter, nextEvent?.wAfter),
      vcom: difference(oldEvent?.vcomAmount, nextEvent?.vcomAmount),
      vcperformance: difference(oldEvent?.vcperformance, nextEvent?.vcperformance),
      valuationStatus: nextEvent?.valuationStatus ?? null,
      valuationReason: nextEvent?.valuationReason ?? null,
    };
  });
  const changed = differences.filter((event) => [event.componentDelta, event.wBefore, event.wAfter, event.vcom, event.vcperformance]
    .some((field) => field.old !== field.next));
  return {
    schemaVersion: "founder-replay-dry-run-v1",
    readOnly: true,
    cutoffAt: input.cutoffAt,
    source: input.source,
    inputSha256: createHash("sha256").update(canonicalJson(input)).digest("hex"),
    precision: FOUNDER_NUMERIC_PRECISION,
    previous: {
      replayId: input.previousReplay.id,
      completedAt: input.previousReplay.completedAt,
      endingW: input.previousReplay.endingW,
      publicEndingW: Number(input.previousReplay.endingW.toFixed(FOUNDER_NUMERIC_PRECISION.publicWellbeingDecimalPlaces)),
      revisionCount: input.previousReplay.revisions.length,
      valueEventCount: input.previousReplay.values.length,
    },
    corrected: {
      endingW: next.endingW,
      publicEndingW: Number(next.endingW.toFixed(FOUNDER_NUMERIC_PRECISION.publicWellbeingDecimalPlaces)),
      endingState: next.endingState,
      revisionCount: next.revisions.length,
      valueEventCount: next.values.length,
    },
    endingWDifference: difference(input.previousReplay.endingW, next.endingW),
    eventDifferences: differences,
    changedEventDifferences: changed,
    invariantSnapshot: input.invariantSnapshot,
  };
}

export type FounderReplayDryRunReport = ReturnType<typeof buildFounderReplayDryRunReport>;

function audit(value: number | string | null) {
  return value === null ? "null" : fixed12Format(fixed12FromDecimal(value)).replace(/0+$/, "").replace(/\.$/, "");
}

function arrow(field: NumericDifference) {
  return `${audit(field.old)} → ${audit(field.next)}${field.change === null ? "" : ` (Δ ${audit(field.change)})`}`;
}

export function renderFounderReplayDryRunReport(report: FounderReplayDryRunReport) {
  const rows = report.changedEventDifferences.map((event) =>
    `| \`${event.activityOccurrenceId}\` | ${event.eventKind ?? "—"} | ${event.sourceCommunity ?? "—"} | ${arrow(event.componentDelta)} | ${arrow(event.wBefore)} | ${arrow(event.wAfter)} | ${arrow(event.vcom)} | ${arrow(event.vcperformance)} | ${event.valuationStatus ?? "—"} |`
  ).join("\n");
  return `# Founder Wellbeing replay — fixed-cutoff dry run

Status: **READ ONLY — PRODUCTION REPLAY NOT AUTHORISED**

## Snapshot

- Cutoff: \`${report.cutoffAt}\`
- Input SHA-256: \`${report.inputSha256}\`
- Source replay: \`${report.previous.replayId}\`
- Audit precision: ${report.precision.auditDecimalPlaces} decimal places
- Public Wellbeing display: ${report.precision.publicWellbeingDecimalPlaces} decimal places

## Result

- W: \`${audit(report.previous.endingW)}\` → \`${audit(report.corrected.endingW)}\`
- Public display: \`${report.previous.publicEndingW.toFixed(3)}\` → \`${report.corrected.publicEndingW.toFixed(3)}\`
- W change: \`${audit(report.endingWDifference.change)}\`
- State revisions: ${report.previous.revisionCount} → ${report.corrected.revisionCount}
- Value-event records: ${report.previous.valueEventCount} → ${report.corrected.valueEventCount}

The additional Performance transition is separately governed from economic valuation. Its rate, Vcom and VCperformance remain null because the event contains neither an explicitly validated rate/unit nor a referenced approved rate policy.

## Old-to-new event differences

| Occurrence | Kind | Community | Component delta | Wbefore | Wafter | Vcom | VCperformance | Valuation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## Immutable boundary captured

- Baseline epoch: \`${String(report.invariantSnapshot.baselineEpochId)}\`
- Baseline W: \`${String(report.invariantSnapshot.baselineW)}\`
- Policy: \`${String(report.invariantSnapshot.policyId)}\` v${String(report.invariantSnapshot.policyVersion)}
- Policy hash: \`${String(report.invariantSnapshot.policyContentHash)}\`
- Genesis status: \`${String((report.invariantSnapshot.genesis as Record<string, unknown> | null)?.baseline_status ?? "unknown")}\`
- Pre-Genesis evidence replayed: \`${String((report.invariantSnapshot.genesis as Record<string, unknown> | null)?.pre_genesis_evidence_replayed ?? "unknown")}\`

No database write, replay, validation change, projection sync or disclosure change was performed by this report.
`;
}
