import { z } from "zod";

export const CAMPAIGN_MAP_REPOSITORY = "TheInternetOfValue/aug15-launch-2026";
export const CAMPAIGN_MAP_PATH = "campaign-map.v1.json";

const workstreamSchema = z.enum(["book", "dialogues", "marketing", "product", "operations"]);
const workItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  workstream: workstreamSchema,
  title: z.string().min(1).max(240),
  intended_output: z.string().min(1).max(500).optional(),
}).strict();

const missionCardSchema = z.object({
  date: z.string().date(),
  campaign_phase: z.string().min(1).max(160),
  daily_direction: z.string().min(1).max(500),
  campaign_hypothesis: z.string().min(1).max(700),
  founder_priorities: z.array(workItemSchema).min(1).max(3),
  ai_codex_deliverables: z.array(workItemSchema).max(3),
  validated_demand_intent: z.string().min(1).max(500),
  dependencies_or_risks: z.array(z.string().min(1).max(500)).max(8).optional(),
}).strict();

export const campaignMapSchema = z.object({
  schema_version: z.literal("campaign-map-v1"),
  campaign: z.object({
    id: z.literal("august-15-iov-launch-2026"),
    name: z.literal("August 15 Internet of Value Launch"),
    starts_on: z.literal("2026-07-21"),
    launch_date: z.literal("2026-08-15"),
    ends_on: z.literal("2026-08-20"),
    timezone: z.literal("Asia/Kolkata"),
    north_star: z.literal("validated demand"),
  }).strict(),
  map: z.object({
    version: z.number().int().positive(),
    status: z.literal("approved"),
    approved_at: z.string().datetime({ offset: true }),
    approved_by: z.literal("Moses Sam Paul"),
  }).strict(),
  mission_cards: z.array(missionCardSchema).length(31),
}).strict().superRefine((value, context) => {
  const expectedDates = Array.from({ length: 31 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 21 + index));
    return date.toISOString().slice(0, 10);
  });
  const actualDates = value.mission_cards.map((card) => card.date);
  const allIds = value.mission_cards.flatMap((card) => [...card.founder_priorities, ...card.ai_codex_deliverables].map((item) => item.id));

  if (actualDates.join("|") !== expectedDates.join("|")) {
    context.addIssue({ code: "custom", path: ["mission_cards"], message: "mission_cards must cover every date from 2026-07-21 through 2026-08-20 in order" });
  }
  if (new Set(allIds).size !== allIds.length) {
    context.addIssue({ code: "custom", path: ["mission_cards"], message: "work item ids must be unique across the map" });
  }
});

export type CampaignMissionCard = z.infer<typeof missionCardSchema>;
export type CampaignMap = z.infer<typeof campaignMapSchema>;
export type CampaignDirection = {
  card: CampaignMissionCard;
  map: { version: number; commit_sha: string; committed_at: string | null };
};

type GitHubContent = { encoding?: string; content?: string };
type GitHubCommit = { sha?: string; commit?: { author?: { date?: string } } };
type Fetcher = typeof fetch;

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "iov-value-log-campaign-direction",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentUrl() {
  return `https://api.github.com/repos/${CAMPAIGN_MAP_REPOSITORY}/contents/${CAMPAIGN_MAP_PATH}`;
}

function commitsUrl() {
  return `https://api.github.com/repos/${CAMPAIGN_MAP_REPOSITORY}/commits?path=${encodeURIComponent(CAMPAIGN_MAP_PATH)}&per_page=1`;
}

export async function readCampaignMap(token: string, fetcher: Fetcher = fetch): Promise<{ map: CampaignMap; commit_sha: string; committed_at: string | null } | null> {
  try {
    const contentResponse = await fetcher(contentUrl(), { headers: githubHeaders(token), next: { revalidate: 300 } });
    if (!contentResponse.ok) return null;
    const content = await contentResponse.json() as GitHubContent;
    if (content.encoding !== "base64" || typeof content.content !== "string") return null;
    const parsed = campaignMapSchema.safeParse(JSON.parse(Buffer.from(content.content, "base64").toString("utf8")));
    if (!parsed.success) return null;

    const commitResponse = await fetcher(commitsUrl(), { headers: githubHeaders(token), next: { revalidate: 300 } });
    const commits = commitResponse.ok ? await commitResponse.json() as GitHubCommit[] : [];
    const commit = commits[0];
    return {
      map: parsed.data,
      commit_sha: typeof commit?.sha === "string" ? commit.sha.slice(0, 7) : "unknown",
      committed_at: typeof commit?.commit?.author?.date === "string" ? commit.commit.author.date : null,
    };
  } catch {
    return null;
  }
}
