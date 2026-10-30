import { pathToFileURL } from "node:url";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export function buildTelegramReminder(packet, privateInsightsUrl) {
  if (packet.synthetic) return [
    "Weekly review notification test (synthetic)",
    "No Value Log evidence was read or stored.",
    "Open the Value Log GPT and say: “Review my week.”",
    privateInsightsUrl,
  ].join("\n");
  return [
    "Weekly review ready",
    `${packet.week_start} to ${packet.week_end}`,
    "Open the Value Log GPT and say: “Review my week.”",
    privateInsightsUrl,
  ].join("\n");
}

async function run() {
  const botToken = required("TELEGRAM_BOT_TOKEN");
  const chatId = required("TELEGRAM_CHAT_ID");
  const mode = process.env.RITUAL_MODE === "synthetic" ? "synthetic" : "production";
  const appUrl = required("VALUE_LOG_APP_URL").replace(/\/$/, "");
  const cronSecret = mode === "production" ? required("WEEKLY_REVIEW_CRON_SECRET") : "";
  const trigger = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "manual" : "scheduled";
  const privateInsightsUrl = `${appUrl}/trends#weekly-reviews`;

  async function post(path, body) {
    const response = await fetch(`${appUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cronSecret}`,
        "content-type": "application/json",
        "x-iov-review-trigger": trigger,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(`Value Log endpoint failed (${response.status})`);
    return result;
  }

  const packet = mode === "synthetic" ? { synthetic: true } : await post("/api/internal/prepare-weekly-review");
  const reminder = buildTelegramReminder(packet, privateInsightsUrl);

  let delivery = "failed";
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reminder, disable_web_page_preview: true }),
    });
    if (!response.ok) throw new Error(`Telegram failed (${response.status})`);
    delivery = "sent";
  } finally {
    if (mode === "production") {
      await post("/api/internal/weekly-review-delivery", { packet_id: packet.packet_id, delivery, trigger });
    }
  }

  if (delivery !== "sent") throw new Error("Telegram reminder was not delivered");
  console.log(mode === "synthetic" ? "Synthetic weekly review reminder sent." : `Weekly review packet ${packet.unchanged ? "reused" : "prepared"}; reminder sent.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { console.error(error instanceof Error ? error.message : "Weekly review ritual failed"); process.exitCode = 1; });
}
