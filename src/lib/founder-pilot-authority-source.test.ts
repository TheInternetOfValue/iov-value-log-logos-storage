import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202607290001_founder_pilot_authority.sql"), "utf8");
const actions = fs.readFileSync(path.join(root, "src/app/actions.ts"), "utf8")
  + fs.readFileSync(path.join(root, "src/lib/founder-review-server.ts"), "utf8");

describe("founder-pilot persistence boundary", () => {
  it("adds nullable provenance without backfilling or replaying history", () => {
    expect(migration).toContain("appointment_id uuid");
    expect(migration).toContain("decision in ('validated', 'rejected', 'provisional')");
    expect(migration).not.toMatch(/update\s+public\.validation_events/i);
    expect(migration).not.toMatch(/perform\s+.*replay|call\s+.*replay|select\s+.*replay/i);
  });

  it("stores pinned appointment provenance on every new routed decision", () => {
    for (const field of ["appointment_id", "entity_id", "review_mode", "registry_version", "validated_at"]) {
      expect(actions).toContain(field);
    }
  });

  it("records HouseOfBros Performance-impact direction and intensity separately", () => {
    expect(actions).toContain("founder_performance_impact_status:");
    expect(actions).toContain("founder_performance_impact_direction:");
    expect(actions).toContain("founder_performance_impact_status: status, founder_performance_impact: impact, impact_direction: direction");
    expect(migration).toContain("('applied', 'no_transition', 'pending')");
    expect(actions).toContain("Applied impact requires direction and intensity");
    expect(actions).toContain('impact: status === "applied" ? impact : null');
    expect(actions).toContain('direction: status === "applied" ? direction : null');
  });

  it("starts replay only when all routed decisions settle", () => {
    expect(actions).toContain("requirements.every((requirement) => requirement.decision === \"validated\")");
    expect(actions).toContain("settledIds.length === ids.length && !sameDayStillOpen");
  });
});
