/** Server-only model profiles; callers never supply model names or endpoints. */
const profiles = {
  "sarvam-105b-conversations": {
    model: "sarvam-105b-conversations",
    path: "/v1/chat/completions",
    reasoning: null,
    maxTokens: 6000,
  },
  "glm5.3": {
    model: "glm5.3",
    path: "/v2/chat/completions",
    reasoning: "low",
    maxTokens: 8000,
  },
} as const;
export function sarvamChatProfile(name: string) {
  return Object.hasOwn(profiles, name)
    ? profiles[name as keyof typeof profiles]
    : null;
}
export const SARVAM_CHAT_MODEL =
  process.env.SARVAM_CHAT_MODEL?.trim() || "sarvam-105b-conversations";
export const SARVAM_CHAT_PROFILE = sarvamChatProfile(SARVAM_CHAT_MODEL);
/** V2 exposes schema-constrained output; legacy conversations retains JSON-object mode. */
export function sarvamResponseFormat(
  model: string,
  name: string,
  schema: unknown,
) {
  return model === "glm5.3"
    ? { type: "json_schema", json_schema: { name, strict: true, schema } }
    : { type: "json_object" };
}
