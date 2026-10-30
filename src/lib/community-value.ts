import { createHash } from "node:crypto";
import { z } from "zod";

export const COMMUNITY_VALUE_PUBLICATION_SCOPE = "public-profile:community-value";
export const COMMUNITY_VALUE_PROJECTION_VERSION = "community-value-v1";
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;

export const communityCatalog = {
  house_of_bros: {
    label: "HouseOfBros",
    kind: "Wellbecoming community",
    focus: "Evidence-aware personal becoming and self-observation integrity",
    href: "https://houseofbros.umso.co/",
  },
  gfe: {
    label: "Growth Flow Engineering",
    kind: "Skill-based community expression",
    focus: "Marketing, Sales, and Finance",
    href: "https://theinternetofvalue.org/fieldwork/growth-flow-engineering",
  },
  iov: {
    label: "IoV Research Foundation",
    kind: "Skill-based research commons",
    focus: "Systems Thinking & Modeling",
    href: "https://theinternetofvalue.org/",
  },
} as const;

export type CommunityCode = keyof typeof communityCatalog;

type SliceRelation = {
  community: CommunityCode;
  start_at: string;
  end_at: string;
};

export type ActiveWEvent = {
  id: string;
  applied_change: number | string;
  input_hash: string;
  created_at: string;
  canonical_slices: SliceRelation | SliceRelation[];
};

export type ActiveCreditEvent = {
  id: string;
  formula_result: number | string;
  input_hash: string;
  created_at: string;
  canonical_slices: SliceRelation | SliceRelation[];
};

const wellbeingMetricsSchema = z.object({
  calculated_minutes: z.number().nonnegative(),
  positive_w: z.number().nonnegative(),
  negative_w: z.number().nonpositive(),
  net_w: z.number(),
}).strict();

const performanceMetricsSchema = z.object({
  calculated_minutes: z.number().nonnegative(),
  credits: z.number().nonnegative(),
}).strict();

const communityAggregateSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("house_of_bros"),
    kind: z.literal("wellbecoming"),
    last_30_days: wellbeingMetricsSchema,
    lifetime: wellbeingMetricsSchema,
  }).strict(),
  z.object({
    code: z.literal("gfe"),
    kind: z.literal("skill_based"),
    last_30_days: performanceMetricsSchema,
    lifetime: performanceMetricsSchema,
  }).strict(),
  z.object({
    code: z.literal("iov"),
    kind: z.literal("skill_based"),
    last_30_days: performanceMetricsSchema,
    lifetime: performanceMetricsSchema,
  }).strict(),
]);

export const communityValueProjectionSchema = z.object({
  did: z.string().regex(/^did:iov:member:[0-9a-f-]{36}$/),
  public_profile_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  communities: z.array(communityAggregateSchema).length(3),
  input_window: z.object({
    last_30_days_start: z.string().datetime(),
    end: z.string().datetime(),
    lifetime_start: z.string().datetime().nullable(),
  }).strict(),
  projection_version: z.literal(COMMUNITY_VALUE_PROJECTION_VERSION),
  aggregate_provenance_hash: z.string().regex(/^[a-f0-9]{64}$/),
  source_application: z.literal("iov-value-log"),
  updated_at: z.string().datetime(),
  experimental: z.literal(true),
  limitations: z.array(z.string().min(1)).min(1),
}).strict();

export type CommunityValueProjection = z.infer<typeof communityValueProjectionSchema>;

function relation<T extends { canonical_slices: SliceRelation | SliceRelation[] }>(row: T) {
  return Array.isArray(row.canonical_slices) ? row.canonical_slices[0] : row.canonical_slices;
}

function minutes(row: ActiveWEvent | ActiveCreditEvent) {
  const slice = relation(row);
  return Math.max(0, (new Date(slice.end_at).getTime() - new Date(slice.start_at).getTime()) / 60_000);
}

function within(row: ActiveWEvent | ActiveCreditEvent, cutoff: number) {
  return new Date(relation(row).start_at).getTime() >= cutoff;
}

function wellbeing(rows: ActiveWEvent[]) {
  return rows.reduce((total, row) => {
    const change = Number(row.applied_change);
    total.calculated_minutes += minutes(row);
    if (change > 0) total.positive_w += change;
    if (change < 0) total.negative_w += change;
    total.net_w += change;
    return total;
  }, { calculated_minutes: 0, positive_w: 0, negative_w: 0, net_w: 0 });
}

function performance(rows: ActiveCreditEvent[], community: "gfe" | "iov") {
  return rows.filter((row) => relation(row).community === community).reduce((total, row) => {
    total.calculated_minutes += minutes(row);
    total.credits += Number(row.formula_result);
    return total;
  }, { calculated_minutes: 0, credits: 0 });
}

export function aggregateCommunityValue(wEvents: ActiveWEvent[], creditEvents: ActiveCreditEvent[], now = new Date()) {
  const cutoff = now.getTime() - THIRTY_DAYS_MS;
  const houseRows = wEvents.filter((row) => relation(row).community === "house_of_bros");
  const recentHouseRows = houseRows.filter((row) => within(row, cutoff));
  const recentCredits = creditEvents.filter((row) => within(row, cutoff));
  return [
    { code: "house_of_bros" as const, kind: "wellbecoming" as const, last_30_days: wellbeing(recentHouseRows), lifetime: wellbeing(houseRows) },
    { code: "gfe" as const, kind: "skill_based" as const, last_30_days: performance(recentCredits, "gfe"), lifetime: performance(creditEvents, "gfe") },
    { code: "iov" as const, kind: "skill_based" as const, last_30_days: performance(recentCredits, "iov"), lifetime: performance(creditEvents, "iov") },
  ];
}

export function communityValueProvenanceHash(wEvents: ActiveWEvent[], creditEvents: ActiveCreditEvent[]) {
  return createHash("sha256")
    .update([...wEvents, ...creditEvents].map((row) => row.input_hash).sort().join("\n"))
    .digest("hex");
}

export function communityValueLimitations() {
  return [
    "Wellbeing movement and Performance credits are distinct measures and must not be summed.",
    "Performance credits are experimental non-monetary reference units, not wages, payouts, tokens, or equity.",
    "The pilot uses role separation by one participant, not independent external review.",
  ];
}
