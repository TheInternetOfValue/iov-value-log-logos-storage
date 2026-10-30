import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("grant-bound Founder history", () => {
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  it("requires a recent signed Word Wallet request and returns only minimized points", () => {
    expect(route).toContain("verifyProjectionSignature");
    expect(route).toContain("grant_id");
    expect(route).toContain('cache-control\": \"no-store');
    expect(route).not.toContain("physiology");
    expect(route).not.toContain("performance_values");
  });
});
