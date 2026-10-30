import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202607280001_cinematic_reel_date_retry.sql",
  "utf8",
);

describe("cinematic reel append-only versioning contract", () => {
  it("keeps supplied reel IDs as optimistic-concurrency guards", () => {
    expect(migration).toContain("expected_reel_id is distinct from previous.id::text");
    expect(migration).toContain("raise exception 'reel_version_conflict'");
  });

  it("resolves an omitted ID only for an advancing cutoff, including after midnight", () => {
    expect(migration).not.toContain("reel_day <> today_ist");
    expect(migration).toContain("cutoff_at <= previous.evidence_cutoff_at");
    expect(migration).toContain("previous.id, p_payload->>'idempotency_key'");
  });

  it("records whether the current version was resolved internally", () => {
    expect(migration).toContain("'resolved_current_version', previous.id is not null and expected_reel_id is null");
  });
});
