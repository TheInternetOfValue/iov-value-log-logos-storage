import { describe, expect, it } from "vitest";
import {
  buildProjectionSignature,
  pilotWProjectionSchema,
  projectionHash,
  verifyProjectionSignature,
} from "@/lib/pilot-w-projection";

describe("Pilot W publication projection", () => {
  it("signs the exact timestamp and body", () => {
    const timestamp = "2026-07-06T00:15:00.000Z";
    const body = JSON.stringify({ pilot_w_current: 843.09 });
    const signature = buildProjectionSignature("secret", timestamp, body);
    expect(verifyProjectionSignature("secret", timestamp, body, signature)).toBe(true);
    expect(verifyProjectionSignature("secret", timestamp, `${body} `, signature)).toBe(false);
  });

  it("produces order-independent aggregate provenance", () => {
    expect(projectionHash(["b", "a"])).toBe(projectionHash(["a", "b"]));
  });

  it("requires an explicitly experimental projection", () => {
    expect(() => pilotWProjectionSchema.parse({
      did: "did:iov:member:10000000-0000-4000-8000-000000000001",
      public_profile_slug: "moses-sam-paul-johnraj",
      pilot_w_current: 843.09,
      delta_24h: 0.02,
      delta_7d: -0.01,
      input_window: { start: "2026-06-29T00:00:00.000Z", end: "2026-07-06T00:00:00.000Z" },
      calculator_version: "wim-legacy-v1",
      aggregate_provenance_hash: "a".repeat(64),
      source_application: "iov-value-log",
      updated_at: "2026-07-06T00:00:00.000Z",
      experimental: false,
      limitations: ["Not canonical WellbeingScore."],
    })).toThrow();
  });
});
