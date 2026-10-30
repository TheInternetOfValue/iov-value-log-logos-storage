import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202607280003_founder_genesis_qualification.sql", "utf8");

describe("founder Genesis ledger migration", () => {
  it("is append-only, owner-scoped, and creates a zero-delta qualification revision", () => {
    expect(migration).toContain("baseline_qualification");
    expect(migration).toContain("qualification_delta_w numeric(16,12) not null default 0 check (qualification_delta_w = 0)");
    expect(migration).toContain("pre_genesis_evidence_replayed boolean not null default false check (pre_genesis_evidence_replayed = false)");
    expect(migration.match(/execute function public\.prevent_event_mutation\(\)/g)?.length).toBe(6);
    expect(migration.match(/owner_id = auth\.uid\(\)/g)?.length).toBe(6);
  });

  it("does not create an eight-node arithmetic score", () => {
    expect(migration).not.toMatch(/identity_score/i);
    expect(migration).not.toMatch(/prestige_(bonus|points)/i);
  });
});
