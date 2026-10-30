import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const instructions = readFileSync("docs/CUSTOM_GPT_INSTRUCTIONS.md", "utf8");
const action = JSON.parse(readFileSync("public/custom-gpt-action.openapi.json", "utf8"));

describe("complete Custom GPT replacement contract", () => {
  it("fits the Custom GPT Instructions field", () => {
    expect(instructions.length).toBeLessThanOrEqual(7600);
  });
  it("allows today-so-far reels while excluding non-evidence", () => {
    expect(instructions).toContain("Explicit roast requests work anytime");
    expect(instructions).toContain("Evidence through HH:MM IST");
    expect(instructions).toContain("Exclude plans, future/ongoing activity, unconfirmed outcomes, and invented context");
    expect(action.components.schemas.CinematicDayReel.properties.evidence_cutoff_at.format).toBe("date-time");
  });

  it("requires a separate late-day offer and save approval", () => {
    expect(instructions).toContain("at/after 8 PM IST");
    expect(instructions).toContain("Would you like a cinematic roast of today so far?");
    expect(instructions).toContain("Should I save this cinematic day reel to Value Log?");
  });

  it("lets the server resolve an advancing current-day reel version", () => {
    expect(action.info.version).toBe("1.4.3");
    expect(action.paths["/api/v1/cinematic-day-reels"].post.description).toContain("evidence cutoff advances");
  });

  it("keeps reel retries on their original date and accepts owner-approved pending evidence", () => {
    expect(instructions).toContain("never substitute the current date after midnight");
    expect(instructions).toContain("`validation_pending` is eligible");
    expect(action.components.schemas.DailyContextResponse.properties.requested_date.format).toBe("date");
    expect(action.components.schemas.DailyActivity.properties.reel_eligible.type).toBe("boolean");
  });

  it("splits only sleep at IST midnight without zero-duration slices", () => {
    expect(instructions).toContain("Split only sleep/rest crossing IST midnight");
    expect(instructions).toContain("never import them from chat history");
    expect(instructions).toContain("Avoid a zero-duration segment");
    expect(instructions).toContain("Do not split overnight work, travel, caregiving");
    expect(instructions).toContain("split sleep gets two links");
  });

  it("keeps the four workflows and measurements separate", () => {
    expect(instructions).toContain("Four responsibilities");
    expect(instructions).toContain("Keep activities, plans, campaign outcomes, reels, weekly interpretation, W, and credits separate");
    expect(instructions).toContain("What did reality teach you this week?");
  });
});
