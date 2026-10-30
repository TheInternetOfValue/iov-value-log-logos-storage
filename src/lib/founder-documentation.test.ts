import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const doc = fs.readFileSync(path.join(process.cwd(), "docs/FOUNDER_WELLBEING_CALCULATION.md"), "utf8");

describe("Founder Wellbeing documentation", () => {
  it("documents the calculation and replay identifiers", () => {
    for (const token of [
      "activity_occurrence_id",
      "source_attestation_id",
      "performance_transition_key",
      "Wbefore",
      "Wafter",
      "deltaW",
      "founder_v0_1_preview",
      "founder_v0_1_live",
    ]) expect(doc).toContain(token);
  });

  it("locks current units, route, and review language", () => {
    expect(doc).toContain("Value for the Commons");
    expect(doc).toContain("OrgBuilding");
    expect(doc).toContain("GFE-3.3.3 rate authority is self-ratified");
    expect(doc).toContain("No external reviewer or external attestation is");
    expect(doc).toContain("payability_status = non_payable");
    expect(doc).toContain("```mermaid\nflowchart LR");
  });

  it("does not present legacy constants as current founder policy", () => {
    expect(doc).not.toMatch(/Founder v0\.1[^\n]*0\.5\s*\/\s*1\.0\s*\/\s*1\.5/);
    expect(doc).not.toMatch(/0\.20\s*\/\s*0\.10\s*\/\s*0\.20\s*\/\s*0\.30\s*\/\s*0\.10\s*\/\s*0\.10/);
  });
});
