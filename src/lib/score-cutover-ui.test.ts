import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("score cutover presentation", () => {
  it("removes the global Pilot badge and selects dated score regimes", () => {
    expect(read("../app/layout.tsx")).not.toContain("PilotDisclosure");
    expect(read("../app/day/page.tsx")).toContain("scoreRegimeForDate");
    expect(read("../app/explore/page.tsx")).toContain('regime="canonical_founder"');
  });

  it("keeps the historical method visible without joining it to Genesis", () => {
    const method = read("../app/method/page.tsx");
    expect(method).toContain("Historical calculator · wim-legacy-v1 · frozen at Genesis");
    expect(method).toContain("never joined to the canonical series");
  });
});
