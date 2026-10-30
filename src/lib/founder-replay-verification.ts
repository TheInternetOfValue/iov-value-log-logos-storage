import { inputHash } from "./input-hash";
import type {
  FounderReplayBaseline,
  FounderReplaySlice,
  FounderStateRevision,
  FounderValueEvent,
} from "./founder-replay";
import { FOUNDER_CALCULATION_VERSION } from "./founder-wellbeing";

export function verifyFounderReplayCandidate(input: {
  cutoffAt: string;
  baseline: FounderReplayBaseline;
  slices: FounderReplaySlice[];
  revisions: FounderStateRevision[];
  values: FounderValueEvent[];
  databaseArithmeticMatches?: boolean;
}) {
  const reasons: string[] = [];
  const sequenceIsContiguous = input.revisions.every((revision, index) => revision.sequenceNumber === index);
  if (!sequenceIsContiguous) reasons.push("revision_sequence_not_contiguous");
  const valuesHaveNullReasons = input.values.every((value) =>
    (value.communityRateAmount === null) === (value.communityRateNullReason !== null)
    && (value.vcomEventAmount === null) === (value.vcomEventNullReason !== null)
    && (value.vcperformanceEventAmount === null) === (value.vcperformanceEventNullReason !== null)
  );
  if (!valuesHaveNullReasons) reasons.push("null_reason_incomplete");
  const finalityIsNonPayable = input.values.every((value) =>
    value.protocolFinalityStatus !== "final"
    || (value.payabilityStatus === "non_payable"
      && value.finalityAuthorityVersionId !== null
      && value.finalizedAt !== null)
  );
  if (!finalityIsNonPayable) reasons.push("finality_payability_invariant_failed");
  const occurrenceIdsUnique = new Set(input.values.map((value) => value.activityOccurrenceId)).size === input.values.length;
  if (!occurrenceIdsUnique) reasons.push("duplicate_occurrence_value");
  const databaseArithmeticMatches = input.databaseArithmeticMatches ?? true;
  if (!databaseArithmeticMatches) reasons.push("database_typescript_arithmetic_mismatch");

  const policyHashes = [...new Set(input.slices.map((slice) => slice.policyContentHash).filter(Boolean) as string[])].sort();
  const authorityHashes = [...new Set(input.slices.map((slice) => slice.authorityContentHash).filter(Boolean) as string[])].sort();
  const invariantResults = {
    sequenceIsContiguous,
    valuesHaveNullReasons,
    finalityIsNonPayable,
    occurrenceIdsUnique,
    databaseArithmeticMatches,
  };
  return {
    inputHash: inputHash({
      cutoffAt: input.cutoffAt,
      baseline: input.baseline,
      slices: input.slices,
      calculationVersion: FOUNDER_CALCULATION_VERSION,
      policyHashes,
      authorityHashes,
    }),
    outputHash: inputHash({
      revisions: input.revisions,
      values: input.values,
      calculationVersion: FOUNDER_CALCULATION_VERSION,
    }),
    policyHashes,
    authorityHashes,
    invariantResults,
    nullReasonComplete: valuesHaveNullReasons,
    eventCount: input.values.length,
    revisionCount: input.revisions.length,
    passed: reasons.length === 0,
    failureReasons: reasons,
  };
}
