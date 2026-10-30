async function publishPilotW() {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.PROJECTION_CRON_SECRET;
  if (!origin || !secret) return new Response("Projection schedule is not configured.", { status: 503 });
  return fetch(`${origin.replace(/\/+$/, "")}/api/internal/publish-pilot-w`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "x-iov-publication-trigger": "scheduled" },
  });
}

export default publishPilotW;

export const config = { schedule: "45 18 * * *", background: true };
