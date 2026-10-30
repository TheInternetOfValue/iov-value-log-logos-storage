// Isolated synthetic browser/server tests only. Refuse real keys and all external requests.
if (
  process.env.SARVAM_API_KEY !== "synthetic-native-provider" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:4209"
)
  throw new Error("Synthetic cohort configuration required");
const actual = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (
    url ===
    "http://127.0.0.1:4208/.netlify/functions/native-log-structure-background"
  )
    return actual("http://127.0.0.1:4209/test-native-job", init);
  if (
    url === "http://127.0.0.1:4208/.netlify/functions/cohort-review-background"
  )
    return actual("http://127.0.0.1:4209/test-cohort-job", init);
  if (url.startsWith("https://api.sarvam.ai/"))
    return actual(
      "http://127.0.0.1:4209/test-provider/" +
        url.slice("https://api.sarvam.ai/".length),
      init,
    );
  if (
    !url.startsWith("http://127.0.0.1:4208/") &&
    !url.startsWith("http://127.0.0.1:4209/")
  )
    throw new Error("External access blocked in synthetic cohort fixture");
  return actual(input, init);
};
