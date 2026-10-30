import type { Handler } from "@netlify/functions";
import { runReplayFrom } from "../../src/lib/replay";

const handler: Handler = async (event) => {
  const secret = process.env.REPLAY_WORKER_SECRET;
  const supplied = event.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!secret || supplied !== secret) return { statusCode: 401, body: "Unauthorized" };
  const body = JSON.parse(event.body ?? "{}") as { owner_id?: string; from_timestamp?: string; replay_run_id?: string };
  if (!body.owner_id || !body.from_timestamp || !body.replay_run_id) return { statusCode: 400, body: "Missing replay request fields" };
  await runReplayFrom(body.owner_id, body.from_timestamp, body.replay_run_id);
  return { statusCode: 200, body: "Replay complete" };
};

export { handler };
