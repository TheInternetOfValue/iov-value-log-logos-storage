import { runCohortReview } from "../../src/lib/cohort/review-worker";
const handler = async (event: {
  httpMethod: string;
  body: string | null;
  isBase64Encoded: boolean;
  headers: Record<string, string | undefined>;
}) => {
  if (
    event.httpMethod !== "POST" ||
    !event.body ||
    event.body.length > 1000 ||
    event.isBase64Encoded
  )
    return { statusCode: 400, body: "Invalid job" };
  try {
    await runCohortReview(event.body, event.headers["x-cohort-job"] ?? "");
    return { statusCode: 200, body: "Complete" };
  } catch {
    console.warn("cohort_review_job_failed", {
      code: "invalid_or_unavailable",
    });
    return { statusCode: 503, body: "Unavailable" };
  }
};
export { handler };
