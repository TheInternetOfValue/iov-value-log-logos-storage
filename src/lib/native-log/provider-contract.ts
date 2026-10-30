import { z } from "zod";

const finishReasons = [
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "function_call",
] as const;
export type ProviderStage =
  | "envelope"
  | "finish"
  | "json"
  | "schema"
  | "proposal_schema"
  | "proposal_quote"
  | "proposal_cancellation"
  | "proposal_identity"
  | "proposal_changed_fields";
export type ProviderDiagnostic = {
  stage: ProviderStage;
  issues?: Array<{ code: string; path: string; keys?: string[] }>;
  finishReason?: (typeof finishReasons)[number] | "other";
  contentType?: "string" | "null" | "missing";
  contentCharacters?: number;
  completionTokens?: number;
  reasoningTokens?: number;
};
/** No response text, reasoning text, key, arbitrary error message or field value can enter this DTO. */
export class ProviderContractError extends Error {
  constructor(readonly diagnostic: ProviderDiagnostic) {
    super("PROVIDER_RESPONSE");
  }
}
function responseFacts(raw: unknown): Omit<ProviderDiagnostic, "stage"> {
  // Optional usage telemetry never participates in deciding whether an answer is valid.
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const root = object(raw),
    choices = Array.isArray(root.choices) ? root.choices : [],
    choice = object(choices[0]),
    message = object(choice.message),
    usage = object(root.usage),
    details = object(usage.completion_tokens_details),
    content = message.content;
  const finish = z.enum(finishReasons).safeParse(choice.finish_reason);
  const token = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined;
  const completion = token(usage.completion_tokens),
    reasoning = token(details.reasoning_tokens);
  return {
    finishReason: finish.success ? finish.data : "other",
    contentType:
      typeof content === "string"
        ? "string"
        : content === null
          ? "null"
          : "missing",
    ...(typeof content === "string"
      ? { contentCharacters: content.length }
      : {}),
    ...(completion === undefined ? {} : { completionTokens: completion }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  };
}
function safeIssues(
  issues: z.core.$ZodIssue[],
): NonNullable<ProviderDiagnostic["issues"]> {
  const allowed = new Set([
    "activities",
    "changes",
    "remove",
    "id",
    "exclude",
    "changedFields",
    "activity",
    "sourceQuote",
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
    "manualFields",
    "supportedNode",
    "decisions",
    "decision",
    "recordId",
    "outcome",
    "rationale",
    "question",
    "evidenceQuotes",
  ]);
  const key = (v: PropertyKey) =>
    typeof v === "number" && v >= 0 && v < 30
      ? String(v)
      : typeof v === "string" && allowed.has(v)
        ? v
        : "other";
  return issues
    .slice(0, 5)
    .map((i) => ({
      code: i.code,
      path: i.path.map(key).join("."),
      ...(i.code === "unrecognized_keys"
        ? { keys: i.keys.slice(0, 5).map(key) }
        : {}),
    }));
}
export function decodedProviderResponse<T>(raw: unknown, schema: z.ZodType<T>) {
  const facts = responseFacts(raw);
  if (facts.finishReason !== "stop")
    throw new ProviderContractError({ ...facts, stage: "finish" });
  const envelope = z
    .object({
      choices: z
        .array(z.object({ message: z.object({ content: z.string() }) }))
        .min(1),
    })
    .safeParse(raw);
  if (!envelope.success)
    throw new ProviderContractError({ ...facts, stage: "envelope" });
  let value: unknown;
  try {
    value = JSON.parse(envelope.data.choices[0].message.content);
  } catch {
    throw new ProviderContractError({ ...facts, stage: "json" });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ProviderContractError({
      ...facts,
      stage: "schema",
      issues: safeIssues(parsed.error.issues),
    });
  return { data: parsed.data, facts };
}
export function safeProviderFailure(error: unknown): {
  code: string;
  diagnostic?: ProviderDiagnostic;
} {
  if (error instanceof ProviderContractError)
    return { code: "PROVIDER_RESPONSE", diagnostic: error.diagnostic };
  const message = error instanceof Error ? error.message : "";
  return {
    code: [
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_RESPONSE",
      "PROVIDER_TIMEOUT",
    ].includes(message)
      ? message
      : "CONTRACT_CHECK_FAILED",
  };
}
