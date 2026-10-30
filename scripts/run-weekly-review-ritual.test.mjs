import { describe, expect, it } from "vitest";
import { buildTelegramReminder } from "./run-weekly-review-ritual.mjs";

describe("weekly review Telegram reminder", () => {
  it("contains status, dates, instruction, and link but no private packet fields", () => {
    const reminder = buildTelegramReminder({
      week_start: "2026-07-27", week_end: "2026-08-01",
      evidence: { activity: "private activity", pilot_w: 501, credits: 42, reflection: "private reflection" },
    }, "https://valuelog.example/trends#weekly-reviews");
    expect(reminder).toContain("Weekly review ready");
    expect(reminder).toContain("Review my week");
    expect(reminder).toContain("2026-07-27 to 2026-08-01");
    expect(reminder).not.toMatch(/private activity|501|42|private reflection|pilot_w|credits/);
  });

  it("labels a synthetic rehearsal without pretending to prepare evidence", () => {
    const reminder = buildTelegramReminder({ synthetic: true }, "https://valuelog.example/trends#weekly-reviews");
    expect(reminder).toContain("synthetic");
    expect(reminder).toContain("No Value Log evidence was read or stored");
  });
});
