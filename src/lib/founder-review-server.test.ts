import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { founderPilotValidationRows, appendNewFounderPilotRows } from "./founder-review-server";
import { MOSES_CANONICAL_DID } from "./identity";

const appointment = (entity: "gfe" | "house_of_bros") => ({
  id: `${entity}-final`, identity_ref: MOSES_CANONICAL_DID, entity_id: entity,
  role: `${entity}_validator`, review_mode: "founder_self_review", settlement_authority: true,
  subject_scope: "self", scopes: [entity === "gfe" ? "performance_source_review" : "performance_impact_review"],
  status: "active", valid_from: "2026-07-31T00:00:00Z", registry_version: "0.1.0",
});

describe("final founder review recovery", () => {
  it("appends a final GFE decision after an old provisional review without repeating the impact decision", async () => {
    const inserted: unknown[] = [];
    const db = { from: vi.fn((table: string) => {
      if (table === "validation_events") return {
        select: () => ({ in: () => ({ in: async () => ({ data: [
          { canonical_slice_id: "slice", appointment_id: "gfe-provisional" },
          { canonical_slice_id: "slice", appointment_id: "house_of_bros-final" },
        ], error: null }) }) }),
        insert: async (rows: unknown[]) => { inserted.push(...rows); return { error: null }; },
      };
      let entity: "gfe" | "house_of_bros" = "gfe";
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { if (key === "entity_id") entity = value as typeof entity; return query; },
        lte: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: appointment(entity), error: null }),
      };
      return query;
    }) } as unknown as SupabaseClient;
    const result = await founderPilotValidationRows(db, "owner", {
      id: "slice", slice_type: "performance", community: "gfe", wellbeing_node: "Performance",
      performance_impact_status: "no_transition",
    }, { adequate: true, classification: true, integrity: null, rationale: "Explicit owner approval", reviewed: "Existing evidence" });
    expect(result.settles).toBe(true);
    expect(result.rows.map(row => [row.entity_id, row.decision])).toEqual([["gfe", "validated"], ["house_of_bros", "validated"]]);
    await appendNewFounderPilotRows(db, result.rows);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ entity_id: "gfe", appointment_id: "gfe-final", decision: "validated" });
  });
});
