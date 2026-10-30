import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { checkedConversation, checkedProposal } from "./sarvam-core";
import { newNativeDraft } from "./draft";

/*
 * Fictional fixtures for the 26–27 October group-session failure patterns.
 * The quotation cases first reproduced whole-table rejection (expected
 * failures) and now pass with source alignment.
 */
const transcript = "I woke up at six. Then I went horse riding from 7am to 8am. After that I had breakfast at eight thirty. Later I prepared slides for the AI safety workshop. Then I gave the AI safety talk. In the evening I worked on the simulation, shared the link and collected data. Tomorrow I will rest.";
const draft = () => ({ ...newNativeDraft("a".repeat(64), "2026-10-27", "Asia/Kolkata", "personal"), transcript });
const row = (activity: string, sourceQuote: string, node: string, startLocal: string | null = null, endLocal: string | null = null) =>
  ({ activity, sourceQuote, startLocal, endLocal, node, context: node === "Performance" ? "AI safety workshop" : null, proof: null, sleepRest: false, community: null, lane: null, direction: null, intensity: null, confidence: null });
const faithful = () => [
  row("Horse riding", "Then I went horse riding from 7am to 8am.", "Physiology", "2026-10-27T07:00", "2026-10-27T08:00"),
  row("Breakfast", "After that I had breakfast at eight thirty.", "Physiology"),
  row("Preparing slides", "Later I prepared slides for the AI safety workshop.", "Performance"),
  row("AI safety talk", "Then I gave the AI safety talk.", "Performance"),
  row("Simulation work", "In the evening I worked on the simulation, shared the link and collected data.", "Performance"),
];

describe("26–27 October incident fixtures", () => {
  it("accepts five faithful rows with unknown times and keeps tomorrow's plan out", () => {
    const result = checkedProposal({ activities: faithful() }, draft());
    expect(result.map(a => a.activity)).toEqual(["Horse riding", "Breakfast", "Preparing slides", "AI safety talk", "Simulation work"]);
    expect(result[0].startLocal).toBe("2026-10-27T07:00");
    expect(result[1].startLocal).toBe("");
  });

  it("keeps the supported rows when one quotation is a faithful paraphrase", () => {
    const rows = faithful();
    rows[0] = { ...rows[0], sourceQuote: "Then I went for horse riding from 7am to 8am." };
    const result = checkedProposal({ activities: rows }, draft());
    expect(result.map(a => a.activity)).toEqual(expect.arrayContaining(["Breakfast", "Preparing slides", "AI safety talk", "Simulation work"]));
  });

  it("keeps the table when quotation punctuation or spacing differs", () => {
    const rows = faithful();
    rows[4] = { ...rows[4], sourceQuote: "In the evening I worked on the simulation shared the link and collected data" };
    expect(checkedProposal({ activities: rows }, draft())).toHaveLength(5);
  });

  it("applies a spoken addition whose quotation is lightly normalised", () => {
    const base = draft(), activities = checkedProposal({ activities: faithful() }, base);
    const latest = { id: "30000000-0000-4000-8000-000000000003", activityId: null, text: "Also add lunch, I had lunch at one." };
    const next = { ...base, activities, conversation: [latest] };
    const result = checkedConversation({ updates: [], additions: [{ ...row("Lunch", "also add lunch I had lunch at one", "Physiology"), id: null }], removed: [] }, next);
    expect(result).toHaveLength(6);
  });

  it("leaves out a row the person never said, and never invents a time", () => {
    const rows = faithful();
    rows[1] = { ...rows[1], startLocal: "2026-10-27T09:00", endLocal: "2026-10-27T09:30" };
    const [, breakfast] = checkedProposal({ activities: rows }, draft());
    expect(breakfast.startLocal).toBe("");
    // A row the person never said is left out; the supported rows remain.
    rows[1] = { ...rows[1], activity: "Marathon", sourceQuote: "I ran a marathon." };
    expect(checkedProposal({ activities: rows }, draft()).map(a => a.activity)).toEqual(["Horse riding", "Preparing slides", "AI safety talk", "Simulation work"]);
    expect(() => checkedProposal({ activities: [rows[1]] }, draft())).toThrow("PROVIDER_RESPONSE");
  });
});
