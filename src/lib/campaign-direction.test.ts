import { describe, expect, it } from "vitest";
import { campaignMapSchema, readCampaignMap } from "@/lib/campaign-direction";

function fixture() {
  return {
    schema_version: "campaign-map-v1" as const,
    campaign: { id: "august-15-iov-launch-2026" as const, name: "August 15 Internet of Value Launch" as const, starts_on: "2026-07-21" as const, launch_date: "2026-08-15" as const, ends_on: "2026-08-20" as const, timezone: "Asia/Kolkata" as const, north_star: "validated demand" as const },
    map: { version: 1, status: "approved" as const, approved_at: "2026-07-21T00:00:00+05:30", approved_by: "Moses Sam Paul" as const },
    mission_cards: Array.from({ length: 31 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 6, 21 + index)).toISOString().slice(0, 10), campaign_phase: "Fixture", daily_direction: "Fixture direction", campaign_hypothesis: "Fixture hypothesis", founder_priorities: [{ id: `founder-priority-${index + 1}`, workstream: "book" as const, title: "Fixture founder priority" }], ai_codex_deliverables: [], validated_demand_intent: "Fixture demand intent",
    })),
  };
}

describe("campaign direction", () => {
  it("accepts the complete approved campaign-map shape", () => expect(campaignMapSchema.safeParse(fixture()).success).toBe(true));
  it("rejects incomplete date coverage and duplicate work ids", () => {
    const incomplete = fixture(); incomplete.mission_cards.pop();
    expect(campaignMapSchema.safeParse(incomplete).success).toBe(false);
    const duplicate = fixture(); duplicate.mission_cards[1].founder_priorities[0].id = duplicate.mission_cards[0].founder_priorities[0].id;
    expect(campaignMapSchema.safeParse(duplicate).success).toBe(false);
  });
  it("reads only a validated GitHub campaign map and returns quiet failure otherwise", async () => {
    const encoded = Buffer.from(JSON.stringify(fixture())).toString("base64");
    const fetcher = async (url: string) => new Response(url.includes("/contents/") ? JSON.stringify({ encoding: "base64", content: encoded }) : JSON.stringify([{ sha: "1234567890abcdef", commit: { author: { date: "2026-07-21T00:00:00Z" } } }]), { status: 200 });
    await expect(readCampaignMap("private-token", fetcher as typeof fetch)).resolves.toMatchObject({ commit_sha: "1234567" });
    await expect(readCampaignMap("private-token", (async () => new Response("no", { status: 404 })) as typeof fetch)).resolves.toBeNull();
  });
});
