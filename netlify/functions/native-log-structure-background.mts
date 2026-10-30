import type { Handler } from "@netlify/functions";
import { runNativeStructure } from "../../src/lib/native-log/structure-worker";
const handler: Handler = async event => {
  if (event.httpMethod !== "POST" || !event.body || event.body.length > 1500 || event.isBase64Encoded) return { statusCode: 400, body: "Invalid job" };
  try {
    await runNativeStructure(event.body, event.headers["x-value-log-native-job"] ?? "");
    return { statusCode: 200, body: "Complete" };
  } catch { console.warn("native_log_job_rejected"); return { statusCode: 400, body: "Rejected job" }; }
};
export { handler };
