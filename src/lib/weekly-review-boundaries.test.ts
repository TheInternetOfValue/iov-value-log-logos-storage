import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/202607270001_weekly_review_ritual.sql", import.meta.url), "utf8");
const gptRoute = readFileSync(new URL("../app/api/v1/weekly-reviews/route.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../examples/workflows/weekly-review.yml.example", import.meta.url), "utf8");
const runner = readFileSync(new URL("../../scripts/run-weekly-review-ritual.mjs", import.meta.url), "utf8");

describe("weekly review privacy and mutation boundaries", () => {
  it("makes packet and review tables owner-readable and append-only", () => {
    expect(migration).toMatch(/enable row level security/g);
    expect(migration).toContain("owner_id = auth.uid()");
    expect(migration).toContain("weekly_review_packets_append_only");
    expect(migration).toContain("weekly_reviews_append_only");
    expect(migration).toContain("revoke insert, update, delete");
  });

  it("keeps GPT access owner-scoped and requires the approval schema before the save RPC", () => {
    expect(gptRoute).toContain("requireGptOwner(request)");
    expect(gptRoute).toContain("weeklyReviewInputSchema.safeParse");
    expect(gptRoute.indexOf("weeklyReviewInputSchema.safeParse")).toBeLessThan(gptRoute.indexOf('rpc("save_weekly_review"'));
  });

  it("keeps the gated schedule as an inert example without activating production automation", () => {
    expect(existsSync(new URL("../../.github/workflows/weekly-review.yml", import.meta.url))).toBe(false);
    expect(workflow).toContain('cron: "30 1 * * 0"');
    expect(workflow).toContain("WEEKLY_REVIEW_SCHEDULE_ENABLED");
    expect(`${workflow}\n${runner}`).not.toMatch(/OPENAI_API_KEY|api\.openai\.com/);
  });

  it("records Telegram failure after preparation without deleting a packet", () => {
    expect(runner.indexOf('prepare-weekly-review')).toBeLessThan(runner.indexOf("api.telegram.org"));
    expect(runner).toContain('delivery = "failed"');
    expect(runner).toContain('weekly-review-delivery');
    expect(runner).not.toMatch(/delete|rollback/i);
  });
});
