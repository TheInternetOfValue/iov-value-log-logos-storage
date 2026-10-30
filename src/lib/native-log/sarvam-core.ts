// Trusted provider adapter for server routes and the background worker.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  wellbeingNodeSchema,
  saoLaneSchema,
  impactDirectionSchema,
  impactIntensitySchema,
  confidenceSchema,
} from "@/lib/domain";
import { LOGGING_INSTRUCTIONS, REPLY_INSTRUCTIONS } from "./instructions";
import {
  decodedProviderResponse,
  ProviderContractError,
} from "./provider-contract";
import { explicitFutureOnly } from "./temporal";
import { activityTimeSource, reconcileNarrativeTimes } from "./chronology";
import { groundedLocalTime } from "./grounding";
import { alignQuote } from "./quote-alignment";
import { TIME_PRECISIONS, enforceChronology, isApproximate, periodWordFits, roughLocalTime, spokenIn, type TimePrecision } from "./vague-time";
import {
  emptyNativeActivity,
  type NativeActivity,
  type NativeDraft,
} from "./draft";

import {
  SARVAM_CHAT_MODEL,
  SARVAM_CHAT_PROFILE,
  sarvamResponseFormat,
} from "./chat-profile";
export { SARVAM_CHAT_MODEL } from "./chat-profile";

const MODEL_ACTIVITY_FIELDS = [
  "activity",
  "startLocal",
  "endLocal",
  "node",
  "context",
  "proof",
  "sleepRest",
  "community",
  "lane",
  "direction",
  "intensity",
  "confidence",
] as const;
const candidateSchema = z
  .object({
    id: z.uuid().nullable().optional(),
    exclude: z.boolean().optional(),
    changedFields: z
      .array(z.enum(MODEL_ACTIVITY_FIELDS))
      .max(12)
      .optional()
      .describe(
        "For a supplied existing id, name each field resolved by the latest reply; correcting a finish time includes endLocal. For a new activity use an empty array.",
      ),
    activity: z.string().min(1).max(500),
    sourceQuote: z
      .string()
      .min(1)
      .max(1000)
      .describe(
        "Exact contiguous transcript or relevant follow-up text. Include the complete supporting activity clause and its stated times/duration, without translation or paraphrase.",
      ),
    startLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/)
      .nullable()
      .describe(
        "Selected local date plus stated start clock, YYYY-MM-DDTHH:mm. Null only when unsupported or genuinely ambiguous.",
      ),
    endLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/)
      .nullable()
      .describe(
        "Local finish clock, YYYY-MM-DDTHH:mm. An explicit start plus explicit duration supports the finish. Overnight sleep ends on the next date. Otherwise null.",
      ),
    node: wellbeingNodeSchema
      .nullable()
      .describe(
        "One primary node for what the person did. Sleep, walking, exercise and body recovery are Physiology; subjective joy/peace is Feeling. Use the supplied canonical definitions.",
      ),
    context: z.string().max(2000).nullable(),
    proof: z.string().max(2000).nullable(),
    sleepRest: z.boolean(),
    community: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{1,63}$/)
      .nullable(),
    lane: saoLaneSchema.nullable(),
    direction: impactDirectionSchema.nullable(),
    intensity: impactIntensitySchema.nullable(),
    confidence: confidenceSchema.nullable(),
    timePrecision: z
      .enum(TIME_PRECISIONS)
      .nullable()
      .optional()
      .describe(
        "exact: clock with am/pm or 24-hour; approximate: clock with around/about/roughly/-ish/लगभग/சுமார்; period_inferred: bare clock whose morning/evening is clear only from the order of the day; relative: only 'after lunch'/'before the meeting'; part_of_day: only 'in the afternoon'; unknown: no time said.",
      ),
    timeSpoken: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("The exact time words the person used for this row, e.g. 'around 8', 'seven to eight', 'after lunch'. Null if none."),
  })
  .strict();
const proposalSchema = z
  .object({ activities: z.array(candidateSchema).max(30) })
  .strict();
const initialProposalSchema = z
  .object({
    activities: z
      .array(candidateSchema.omit({ changedFields: true, exclude: true }))
      .max(30),
  })
  .strict();
const replyChangesSchema = candidateSchema
  .omit({ id: true, exclude: true, changedFields: true, sourceQuote: true })
  .partial()
  .strict();
const replySchema = z
  .object({ remove: z.boolean().default(false), changes: replyChangesSchema })
  .strict();
const conversationSchema = z
  .object({
    updates: z
      .array(z.object({ id: z.uuid(), changes: replyChangesSchema }).strict())
      .max(30),
    additions: initialProposalSchema.shape.activities,
    removed: z.array(z.uuid()).max(30),
  })
  .strict();

/** Rows the person's words could not support are left out; `report` counts them so they are never lost silently. */
export type ProposalReport = { unmatched: number };
export function checkedConversation(
  input: unknown,
  draft: NativeDraft,
  report?: ProposalReport,
): NativeActivity[] {
  const parsed = conversationSchema.safeParse(input),
    latest = draft.conversation?.at(-1);
  if (!parsed.success || !latest || latest.activityId)
    throw new ProviderContractError({ stage: "proposal_schema" });
  const { updates, additions, removed } = parsed.data;
  const ids = [...updates.map((u) => u.id), ...removed];
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !draft.activities.some((a) => a.id === id))
  )
    throw new ProviderContractError({ stage: "proposal_identity" });
  let activities = [...draft.activities];
  for (const update of updates) {
    activities = checkedReplyPatch(
      { remove: false, changes: update.changes },
      {
        ...draft,
        activities,
        conversation: [
          ...draft.conversation!.slice(0, -1),
          { ...latest, activityId: update.id },
        ],
      },
    );
  }
  for (const id of removed) {
    activities = checkedReplyPatch(
      { remove: true, changes: {} },
      {
        ...draft,
        activities,
        conversation: [
          ...draft.conversation!.slice(0, -1),
          { ...latest, activityId: id },
        ],
      },
    );
  }
  for (const addition of additions) {
    if (addition.id) throw new ProviderContractError({ stage: "proposal_identity" });
    const restore = /\b(?:add|include|missing|forgot|restore|undo|bring back)\b/i.test(latest.text);
    const quote =
      alignQuote(addition.sourceQuote, [latest.text]) ??
      (restore ? alignQuote(addition.sourceQuote, [draft.transcript]) : null);
    // An addition the person's words do not support, or one already present, is left out; the rest still applies.
    if (!quote) {
      if (report) report.unmatched += 1;
      continue;
    }
    if (activities.some((a) => a.sourceQuote === quote)) continue;
    const added = checkedProposal(
      { activities: [{ ...addition, sourceQuote: quote }] },
      { ...draft, activities: [], conversation: [latest] },
    );
    activities.push(...added);
  }
  if (activities.length > 30)
    throw new ProviderContractError({ stage: "proposal_schema" });
  return activities;
}
/** Merge only the reply's declared mutable fields; retain the owner-scoped activity and source. */
export function checkedReplyPatch(
  input: unknown,
  draft: NativeDraft,
): NativeActivity[] {
  const parsed = replySchema.safeParse(input),
    latest = draft.conversation?.at(-1),
    old = draft.activities.find((a) => a.id === latest?.activityId);
  if (!parsed.success) throw new ProviderContractError({ stage: "schema" });
  if (!latest || !old)
    throw new ProviderContractError({ stage: "proposal_identity" });
  const patch = parsed.data;
  if (!patch.remove && !Object.keys(patch.changes).length)
    return draft.activities;
  const base = {
    id: old.id,
    activity: old.activity,
    sourceQuote: patch.remove ? latest.text : old.sourceQuote || latest.text,
    startLocal: old.startLocal || null,
    endLocal: old.endLocal || null,
    node: old.node || null,
    context: old.context || null,
    proof: old.proof || null,
    sleepRest: old.sleepRest,
    community: old.community || null,
    lane: old.lane || null,
    direction: old.direction || null,
    intensity: old.intensity || null,
    confidence: old.confidence || null,
  };
  return checkedProposal(
    {
      activities: [
        {
          ...base,
          ...patch.changes,
          exclude: patch.remove,
          changedFields: Object.keys(patch.changes).filter((field): field is (typeof MODEL_ACTIVITY_FIELDS)[number] => (MODEL_ACTIVITY_FIELDS as readonly string[]).includes(field)),
        },
      ],
    },
    draft,
  );
}
export const sarvamConfigured = () =>
  Boolean(process.env.SARVAM_API_KEY?.trim());
async function sarvam(
  path: "/speech-to-text" | "/v1/chat/completions" | "/v2/chat/completions",
  body: FormData | string,
  signal: AbortSignal,
) {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) throw new Error("PROVIDER_UNAVAILABLE");
  try {
    const response = await fetch("https://api.sarvam.ai" + path, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        ...(typeof body === "string"
          ? { "content-type": "application/json" }
          : {}),
      },
      body,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(path === "/speech-to-text" ? 20000 : 120000),
      ]),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      console.warn("native_log_provider_status", {
        operation: path === "/speech-to-text" ? "transcribe" : "structure",
        status: response.status,
      });
      await response.body?.cancel();
      throw new Error("PROVIDER_UNAVAILABLE");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("PROVIDER_RESPONSE");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 400000) {
        await reader.cancel();
        throw new Error("PROVIDER_RESPONSE");
      }
      chunks.push(next.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new Error("PROVIDER_RESPONSE");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      ["PROVIDER_UNAVAILABLE", "PROVIDER_RESPONSE"].includes(error.message)
    )
      throw error;
    throw new Error("PROVIDER_TIMEOUT");
  }
}
async function structuredResponse<T>(
  name: string,
  schema: z.ZodType<T>,
  prompt: string,
  input: unknown,
  signal: AbortSignal,
) {
  const profile = SARVAM_CHAT_PROFILE;
  if (!profile) throw new Error("PROVIDER_UNAVAILABLE");
  const result = await sarvam(
    profile.path,
    JSON.stringify({
      model: SARVAM_CHAT_MODEL,
      temperature: 0,
      reasoning_effort: profile.reasoning,
      max_tokens: profile.maxTokens,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "Operation: " +
            name +
            "\n" +
            prompt +
            "\nReturn one JSON object conforming to this schema. The server rejects every extra key, invalid enum, unsupported quote or time. Schema: " +
            JSON.stringify(z.toJSONSchema(schema)),
        },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: sarvamResponseFormat(
        profile.model,
        name,
        z.toJSONSchema(schema),
      ),
    }),
    signal,
  );
  return decodedProviderResponse(result, schema);
}
export async function structuredSarvam<T>(
  name: string,
  schema: z.ZodType<T>,
  prompt: string,
  input: unknown,
  signal: AbortSignal,
): Promise<T> {
  return (await structuredResponse(name, schema, prompt, input, signal)).data;
}
export function validateWave(bytes: Buffer) {
  if (
    bytes.length < 46 ||
    bytes.length > 900000 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 16) !== "WAVEfmt " ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== 16000 ||
    bytes.readUInt32LE(28) !== 32000 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString("ascii", 36, 40) !== "data" ||
    bytes.readUInt32LE(40) !== bytes.length - 44 ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.readUInt32LE(40) % 2
  )
    throw new Error("INVALID_INPUT");
  const seconds = (bytes.length - 44) / 32000;
  if (seconds <= 0 || seconds > 28) throw new Error("INVALID_INPUT");
  return seconds;
}
export async function transcribeWithSarvam(bytes: Buffer, signal: AbortSignal) {
  validateWave(bytes);
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    "recording.wav",
  );
  form.set("model", "saaras:v4");
  form.set("mode", "transcribe");
  form.set("language_code", "unknown");
  form.set(
    "keyterms",
    JSON.stringify([
      "Value Log",
      "HouseOfBros",
      "HouseOfSis",
      "The Internet of Value",
      "Growth Flow Engineering",
    ]),
  );
  const response = await sarvam("/speech-to-text", form, signal);
  const parsed = z
    .object({ transcript: z.string().max(50000) })
    .passthrough()
    .safeParse(response);
  if (!parsed.success) throw new Error("PROVIDER_RESPONSE");
  return parsed.data.transcript.trim();
}
export function checkedProposal(
  input: unknown,
  draft: NativeDraft,
  report?: ProposalReport,
): NativeActivity[] {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success)
    throw new ProviderContractError({ stage: "proposal_schema" });
  const excluded = new Set<string>();
  const periodHints = new Map<string, boolean>();
  let unsupported = 0;
  const proposed = parsed.data.activities
    .map((candidate): NativeActivity | null => {
      const old = draft.activities.find((item) => item.id === candidate.id);
      const replies = (draft.conversation ?? [])
        .filter(
          (reply) => !reply.activityId || reply.activityId === candidate.id,
        )
        .map((reply) => reply.text);
      // An existing occurrence already has its source. A reply adds facts without asking the model to rewrite that source.
      const kept = Boolean(old && draft.conversation?.length && !candidate.exclude);
      // A cancellation must quote exactly; any other row is re-pointed at the person's own words.
      const sourceQuote = kept
        ? old!.sourceQuote
        : candidate.exclude
          ? [draft.transcript, ...replies].some((text) => text.includes(candidate.sourceQuote)) ? candidate.sourceQuote : null
          : alignQuote(candidate.sourceQuote, [draft.transcript, ...replies]);
      if (sourceQuote === null) {
        if (candidate.exclude) throw new ProviderContractError({ stage: "proposal_quote" });
        unsupported += 1;
        return null;
      }
      if (candidate.exclude) {
        const latest = draft.conversation?.at(-1);
        if (
          !candidate.id ||
          !draft.activities.some((x) => x.id === candidate.id) ||
          !latest ||
          (latest.activityId && latest.activityId !== candidate.id) ||
          !latest.text.includes(candidate.sourceQuote) ||
          !/remove|delete|cancel|not|didn.t|tomorrow|नहीं|कल|இல்லை|நாளை/i.test(
            latest.text,
          )
        )
          throw new ProviderContractError({ stage: "proposal_cancellation" });
        excluded.add(candidate.id);
        return null;
      }
      const timeSource = [activityTimeSource(draft.transcript, sourceQuote), ...replies].join("\n");
      const groundedTime = (value: string | null) =>
        groundedLocalTime(value, timeSource, draft.date, candidate.sleepRest);
      const timing = roughTiming(candidate, timeSource, draft.date, groundedTime);
      if (
        candidate.id &&
        !draft.activities.some((item) => item.id === candidate.id)
      )
        throw new ProviderContractError({ stage: "proposal_identity" });
      const routeSource = [sourceQuote, ...replies].join("\n");
      const named = (label: string) => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(
          `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
          "iu",
        ).test(routeSource);
      };
      const allowed = draft.cohort?.workCommunities.some(
        (c) => c.id === candidate.community && (named(c.id) || named(c.name)),
      );
      const next: NativeActivity = {
        ...emptyNativeActivity(candidate.id ?? randomUUID()),
        activity: candidate.activity,
        sourceQuote,
        startLocal: timing.startLocal,
        endLocal: timing.endLocal,
        ...(timing.timePrecision ? { timePrecision: timing.timePrecision } : {}),
        ...(timing.timeLabel ? { timeLabel: timing.timeLabel } : {}),
        ...(timing.timeNote ? { timeNote: timing.timeNote } : {}),
        node: candidate.node ?? "",
        context: candidate.context ?? "",
        proof: candidate.proof ?? "",
        sleepRest: candidate.sleepRest,
        community: draft.cohort
          ? candidate.node !== "Performance"
            ? draft.cohort.houseId
            : allowed
              ? (candidate.community ?? "")
              : ""
          : draft.mode === "pilot"
            ? candidate.node && candidate.node !== "Performance"
              ? "house_of_bros"
              : ["iov", "gfe"].includes(candidate.community ?? "")
                ? candidate.community!
                : ""
            : "",
        lane:
          candidate.node === "Performance" &&
          (draft.mode === "pilot" || draft.cohort)
            ? (candidate.lane ?? "")
            : "",
        direction: candidate.direction ?? "",
        intensity: candidate.direction ? (candidate.intensity ?? "") : "",
        confidence: candidate.direction ? (candidate.confidence ?? "") : "",
        sourceReplyIds: (draft.conversation ?? []).map((reply) => reply.id),
      };
      if (next.timePrecision === "period_inferred") periodHints.set(next.id, periodWordFits(timeSource, next.startLocal));
      if (old && draft.conversation?.length) {
        if (!candidate.changedFields?.length)
          throw new ProviderContractError({ stage: "proposal_changed_fields" });
        const merged = { ...old };
        const priorSourceIds =
          old.sourceReplyIds ??
          (draft.conversation ?? [])
            .slice(0, -1)
            .filter((reply) => !reply.activityId || reply.activityId === old.id)
            .map((reply) => reply.id);
        merged.sourceReplyIds = [
          ...new Set([...priorSourceIds, draft.conversation.at(-1)!.id]),
        ];
        for (const field of candidate.changedFields)
          Object.assign(merged, { [field]: next[field] });
        // A reply that settles a time carries its own precision and words.
        if (candidate.changedFields.some((field) => field === "startLocal" || field === "endLocal")) {
          merged.timePrecision = next.timePrecision;
          merged.timeLabel = next.timeLabel;
          merged.timeNote = next.timeNote;
        }
        const changed = new Set<string>(candidate.changedFields);
        merged.manualFields = old.manualFields?.filter(
          (field) => !changed.has(field),
        );
        if (changed.has("startLocal")) {
          // The earlier note described the old start; keep only the reply's own words.
          merged.timeNote = next.timeNote;
          merged.startFromReply = true;
          merged.inheritedStartFrom = undefined;
        }
        return merged;
      }
      return next;
    })
    .filter((item): item is NativeActivity => item !== null);
  // One unsupported row is left out; a proposal with no supported row at all is a failed preparation.
  if (unsupported && !proposed.length && !excluded.size)
    throw new ProviderContractError({ stage: "proposal_quote" });
  if (report) report.unmatched += unsupported;
  const lastReply = draft.conversation?.at(-1);
  const ordered = (activities: NativeActivity[]) => {
    enforceChronology(activities.map((activity) => ({
      activity, position: activity.sourceQuote ? draft.transcript.indexOf(activity.sourceQuote) : -1,
      // Only times settled in this pass; an earlier accepted time is not re-judged by an unrelated edit.
      rough: activity.timePrecision === "period_inferred" && periodHints.has(activity.id),
      periodSupported: periodHints.get(activity.id),
    })));
    return activities;
  };
  if (lastReply && draft.activities.length) {
    const existing = draft.activities
      .filter((item) => !excluded.has(item.id))
      .map((item) => {
        if (lastReply.activityId && item.id !== lastReply.activityId)
          return item;
        return proposed.find((candidate) => candidate.id === item.id) ?? item;
      });
    return ordered(lastReply.activityId
      ? existing
      : [
          ...existing,
          ...proposed.filter(
            (item) => !draft.activities.some((old) => old.id === item.id),
          ),
        ]);
  }
  return ordered(proposed);
}

/** Hide 1–12 o'clock colon times that carry no am/pm, so only explicit readings remain. */
const withoutBareClocks = (text: string) =>
  text.replace(/\b(?:0?[1-9]|1[0-2]):[0-5]\d\b(?!\s*(?:a\.?m|p\.?m))/gi, "·");

/**
 * Accept a rough time only from the person's own time words for this row.
 * A clock whose morning/evening rests on the order of the day is stored as
 * period_inferred and later checked against firmly timed neighbours.
 * Relative and part-of-day rows keep their words and no invented clock.
 */
function roughTiming(
  candidate: { startLocal: string | null; endLocal: string | null; sleepRest: boolean; timePrecision?: TimePrecision | null; timeSpoken?: string | null },
  source: string,
  date: string,
  grounded: (value: string | null) => string,
) {
  const precision = candidate.timePrecision ?? null;
  const spoken = spokenIn(source, candidate.timeSpoken) ? candidate.timeSpoken!.trim() : null;
  // Rows from the v6 contract say how a time was stated; older proposals keep their previous behaviour exactly.
  const stated = Boolean(precision || spoken);
  // A clock matched only as a bare "8:30" is one of two readings, not a firm time.
  const firm = (value: string | null) => {
    const time = grounded(value);
    return time && stated && !groundedLocalTime(value, withoutBareClocks(source), date, candidate.sleepRest) ? "" : time;
  };
  let startLocal = firm(candidate.startLocal), endLocal = firm(candidate.endLocal), inferred = false;
  const wordsOnly = precision === "relative" || precision === "part_of_day";
  if (stated && !wordsOnly && !candidate.sleepRest) {
    // The model's label is a hint; the person's own time words and the order of the day decide.
    const reading = (value: string | null) =>
      (spoken ? roughLocalTime(value, spoken, date, "period_inferred") : "") || grounded(value);
    if (!startLocal) {
      startLocal = reading(candidate.startLocal);
      inferred = Boolean(startLocal);
    }
    if (!endLocal && candidate.endLocal) {
      const end = reading(candidate.endLocal)
        // A stated duration after a settled start: "around 7 for an hour".
        || (startLocal && spoken ? groundedLocalTime(candidate.endLocal, `${startLocal.slice(11, 16)}\n${spoken}`, date, false) : "");
      if (end && (!startLocal || end > startLocal)) {
        endLocal = end;
        inferred = true;
      }
    }
  }
  const timed = Boolean(startLocal || endLocal);
  const approximate = Boolean(spoken && isApproximate(spoken));
  return {
    startLocal,
    endLocal,
    timePrecision: (!stated ? undefined : inferred ? "period_inferred" : timed ? (approximate ? "approximate" : "exact")
      : spoken && wordsOnly ? precision : "unknown") as TimePrecision | undefined,
    timeLabel: !timed && spoken && wordsOnly ? spoken : undefined,
    timeNote: timed && spoken && (approximate || inferred)
      ? `${approximate ? "Approximate" : "Morning or evening from the order of your day"}: “${spoken}”.`
      : undefined,
  };
}
export async function structureWithSarvam(
  draft: NativeDraft,
  signal: AbortSignal,
  report?: ProposalReport,
) {
  if (
    draft.conversation?.length &&
    draft.conversation.at(-1)?.id === draft.processedReplyId
  )
    return draft.activities;
  if (!draft.conversation?.length && explicitFutureOnly(draft.transcript))
    return [];
  const scope = draft.cohort
    ? `This participant explicitly opted into Field Station. Route non-Performance activity to their supplied houseId; for Performance use only their supplied accepted workCommunities and Learning/Earning/OrgBuilding. Their draft mode is personal for storage compatibility; it does not remove these accepted routes.`
    : draft.mode === "pilot"
      ? "The original Moses pilot routes non-Performance to house_of_bros and Performance only to explicitly clear iov/gfe and Learning/Earning/OrgBuilding routes."
      : "This is private unassessed logging. Keep community and lane null.";
  const prompt =
    LOGGING_INSTRUCTIONS +
    "\n" +
    scope +
    `
Return only the supplied JSON schema. No tools or confirmations. Every sourceQuote copies the person's words as one contiguous span from transcript or the relevant follow-up, as closely as possible, without translating or correcting it. Include supporting times when supplied. Every row returns timePrecision and timeSpoken. New records use id=null. reviewQuestion supplies no facts.
Use the selected date and timezone with YYYY-MM-DDTHH:mm local clocks. Interpret explicit spoken numbers and durations, including Hindi/Tamil and mixed language. Keep unspecified/ambiguous times null. Overnight sleep stays one occurrence ending on the next local day.
Interpretation examples (facts only; never copy these example values into a log):
- A swim followed by an observation of bodily recovery is ONE Physiology activity, with that reported effect attached. Do not create a second activity for the effect.
- "I rested from seven pm for twenty minutes" on a selected day means 19:00 to19:20 on that day; copy the full clause as sourceQuote. Never return a bare clock or UTC offset in a local-time field.
- "I worked on a report" supports Performance but no particular work community or lane. Accepted membership alone is no evidence that an activity belongs there; leave community/lane null until the person names the context.
- "Next week I intend to cycle" is a plan: activities=[].
- "Woke up at 6am, then walked seven to eight" → Walk: timeSpoken "seven to eight", timePrecision period_inferred, 07:00 to 08:00 (the day is moving forward from 6am).
- "Had breakfast around 8:30" → timeSpoken "around 8:30", timePrecision approximate, start 08:30, end null.
- "After lunch I did some work" → activity "Some work", timeSpoken "After lunch", timePrecision relative, no clocks. Do not name the work.
- "शाम को दोस्तों से मिला" → timeSpoken "शाम को", timePrecision part_of_day, no clocks.
- "காலை சுமார் எட்டு மணிக்கு சாப்பிட்டேன்" → timeSpoken "காலை சுமார் எட்டு மணிக்கு", timePrecision approximate, start 08:00.
- "Went to the meeting at 2:30" with nothing around it → timePrecision unknown and null clocks; right after "lunch at 1pm" → period_inferred 14:30.
Explicit "no change"/"no wellbeing change" means direction=neutral, intensity=null, confidence=observed. A reported small improvement may be positive/low/observed; never infer an effect just from the activity. The final person-approved timeline and separate policy review remain required.`;
  const latest = draft.conversation?.at(-1),
    target = draft.activities.find((a) => a.id === latest?.activityId);
  const finish = (activities: NativeActivity[]) =>
    reconcileNarrativeTimes({ ...draft, activities }).activities;
  if (latest && !latest.activityId && draft.activities.length) {
    const result = await structuredResponse(
      "value_log_conversation",
      conversationSchema,
      REPLY_INSTRUCTIONS +
        "\n" +
        scope +
        `
This is a conversation about the ENTIRE displayed table. Resolve references such as 'the walk', 'breakfast', 'that was GFE', 'actually I finished at nine', 'remove the last one', 'undo that', or 'also add lunch'. Return {updates,additions,removed}. Each update uses exactly one supplied existing id and only fields supported by the latest message and the conversation; preserve every unrelated field and row. Return no updates for unchanged rows. New completed activities belong only in additions with id=null and an exact contiguous quote FROM THE LATEST MESSAGE. When the person explicitly asks to add a missing earlier activity, restore it or undo a removal, additions may instead quote the original transcript. Never add a row already present. Removed contains only existing ids explicitly cancelled by the latest message. Do not regenerate the timeline. Never infer an impact, membership or approval. Keep approximate clocks visible in the facts. If the message is ambiguous, do not make a guess; leave that change unapplied.`,
      {
        date: draft.date,
        timezone: draft.timezone,
        transcript: draft.transcript,
        activities: draft.activities,
        previousAnswers: draft.conversation?.slice(0, -1),
        latestMessage: latest.text,
        cohort: draft.cohort,
      },
      signal,
    );
    return finish(checkedConversation(result.data, draft, report));
  }
  if (latest?.activityId) {
    if (!target)
      throw new ProviderContractError({ stage: "proposal_identity" });
    const result = await structuredResponse(
      "value_log_reply",
      replySchema,
      REPLY_INSTRUCTIONS +
        "\n" +
        scope +
        `\nThis operation updates ONE existing activity from the latest reply. Return only {remove,changes}. Include only mutable fields actually resolved or explicitly corrected by the latest reply. Do not return activities, ids, quotes, changedFields, manualFields or unchanged values. The server keeps the saved source and all other answers. Convert stated local clocks to the supplied date and timezone. A reply correcting the finish changes endLocal; a named work context changes community/lane only when explicitly supported and accepted. reviewQuestion provides no facts. remove=true is permitted only when the latest reply explicitly says this did not happen, should be removed, or was a future plan. Otherwise remove=false. If no new fact is given, return empty changes.`,
      {
        date: draft.date,
        timezone: draft.timezone,
        cohort: draft.cohort,
        existingActivity: target,
        previousAnswers: draft.conversation?.slice(0, -1),
        latestReply: latest.text,
        reviewQuestion: draft.reviewQuestion,
      },
      signal,
    );
    try {
      return finish(checkedReplyPatch(result.data, draft));
    } catch (error) {
      if (error instanceof ProviderContractError)
        throw new ProviderContractError({
          ...result.facts,
          ...error.diagnostic,
        });
      throw error;
    }
  }
  const globalFollowUp = Boolean(latest && draft.activities.length);
  const result = await structuredResponse(
    "value_log_proposal",
    globalFollowUp ? proposalSchema : initialProposalSchema,
    prompt +
      (globalFollowUp
        ? "\nFor an existing activity, changedFields belongs inside that activity and lists only values resolved by the latest reply. Omit unrelated records. Never put changedFields at the root."
        : "\nThis is an initial timeline. Return only the activities array at the root. Do not return changedFields or other update metadata anywhere."),
    {
      date: draft.date,
      timezone: draft.timezone,
      mode: draft.mode,
      transcript: draft.transcript,
      cohort: draft.cohort,
      existingActivities: draft.activities,
      followUpAnswers: draft.conversation,
      reviewQuestion: draft.reviewQuestion,
    },
    signal,
  );
  try {
    return finish(checkedProposal(result.data, draft, report));
  } catch (error) {
    if (error instanceof ProviderContractError)
      throw new ProviderContractError({ ...result.facts, ...error.diagnostic });
    throw error;
  }
}
