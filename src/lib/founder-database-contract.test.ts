import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/202607310001_bitemporal_flat_community_rates.sql", import.meta.url),
  "utf8",
);
const transitionExport = readFileSync(
  new URL("../../scripts/export-founder-replay-input.ts", import.meta.url),
  "utf8",
);

describe("bitemporal flat-rate database contract", () => {
  it("owns the exclusive Genesis comparison in the database", () => {
    expect(migration).toContain("p_occurrence_start_at > (");
    expect(migration).toContain("p_occurrence_start_at <= v_genesis");
    expect(migration).toContain("2026-07-28T11:11:34.890018Z");
  });

  it("pins community rates and cross-repository hashes", () => {
    expect(migration).toContain("750.000000000000");
    expect(migration).toContain("500.000000000000");
    expect(migration).toContain("75e9bf1c9c6b99466ec3ff09d03ae40135e1290512d816a6d0ea2af8acb116d8");
    expect(migration).toContain("3d93b60bd02380e2b4284da024bfc538e2b153a10cb50919c8f139fa0ec52e12");
  });

  it("requires passing verification and explicit atomic promotion", () => {
    expect(migration).toContain("FOUNDER_REPLAY_PROMOTION_REQUIRES_PASSING_VERIFICATION");
    expect(migration).toContain("promote_verified_founder_replay");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("current_promoted_founder_replay");
  });

  it("preserves the existing current-state view column order before appending provenance", () => {
    expect(migration).toMatch(
      /revision\.created_at,\s+promoted\.mode,\s+run\.completed_at,\s+revision\.genesis_qualification_id,\s+promoted\.verification_id/s,
    );
    expect(migration).not.toContain("revision.*, promoted.mode");
  });

  it("pins the pre-promotion transition branch by exact operator-supplied UUID", () => {
    expect(transitionExport).toContain("--transition-replay-run-id");
    expect(transitionExport).toContain("where run.id = '${transitionReplayRunId}'::uuid");
    expect(transitionExport).not.toContain("order by run.completed_at");
    expect(transitionExport).not.toContain("order by run.created_at");
  });

  it("makes valuation finality explicitly non-payable", () => {
    expect(migration).toContain("payability_status = 'non_payable'");
    expect(migration).toContain("founder_finality_is_non_payable");
  });

  it("enumerates every governed null reason", () => {
    for (const reason of [
      "not_applicable_nonperformance", "pre_genesis", "unsupported_community",
      "missing_route", "no_policy_at_valid_time",
      "policy_not_recorded_as_of_system_time", "authority_not_final",
      "ambiguous_policy", "community_rate_unresolved",
      "duration_unavailable_or_invalid", "vcom_unresolved",
      "wbefore_unavailable",
    ]) expect(migration).toContain(`'${reason}'`);
  });
});
