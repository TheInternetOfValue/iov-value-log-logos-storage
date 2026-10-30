import "server-only";

import { unstable_cache } from "next/cache";
import { readCampaignMap, type CampaignDirection } from "@/lib/campaign-direction";

const readConfiguredCampaignMap = unstable_cache(async () => {
  const token = process.env.AUG15_CAMPAIGN_MAP_GITHUB_TOKEN;
  return token ? readCampaignMap(token) : null;
}, ["aug15-campaign-map-v1"], { revalidate: 300 });

export async function campaignDirectionForDate(date: string): Promise<CampaignDirection | null> {
  const result = await readConfiguredCampaignMap();
  if (!result) return null;
  const card = result.map.mission_cards.find((candidate) => candidate.date === date);
  if (!card) return null;
  return { card, map: { version: result.map.map.version, commit_sha: result.commit_sha, committed_at: result.committed_at } };
}
