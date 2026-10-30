import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("public Pilot W publication", () => {
  it("freezes legacy projections when the canonical founder mode is live", () => {
    expect(route).toContain('const publishLegacy = founderWellbeingMode() !== "founder_v0_1_live"');
    expect(route).toContain('skipped: "frozen_at_genesis"');
    expect(route).toContain("if (publishLegacy) await db.from(\"audit_events\").insert");
  });
  it("uses canonical-slice settlement time for public movement windows", () => {
    expect(route).toMatch(/const settledAt/);
    expect(route).toMatch(/slice\?\.end_at/);
    expect(route).toMatch(/const settled = settledAt\(row\)/);
    expect(route).toMatch(/new Date\(settled\)\.getTime\(\)/);
  });

  it("derives Founder movement only from the promoted Founder replay", () => {
    expect(route).toContain('db.from("founder_wellbeing_state_revisions")');
    expect(route).toContain('.eq("replay_run_id", founderState.replay_run_id)');
    expect(route).toContain("delta_24h: delta24h");
    expect(route).toContain('native_level: "GFE-3.3.3"');
    expect(route).toContain('level_name: "L3"');
    expect(route).toContain('native_level: "SM3"');
  });

  it("reports a partial signed sync failure instead of succeeding silently", () => {
    expect(route).toMatch(/const ok = response\.ok && communityResponse\.ok/);
    expect(route).toMatch(/error: ok \? undefined : "projection_sync_failed"/);
    expect(route).toMatch(/status: ok \? 200 : 502/);
  });

  it("returns each relying-app failure body so the private UI can name sharing-off safely", () => {
    expect(route).toMatch(/pilot_w: result/);
    expect(route).toMatch(/community_value: communityResult/);
  });
});
