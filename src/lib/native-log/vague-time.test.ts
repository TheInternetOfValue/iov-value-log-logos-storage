import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { checkedProposal, checkedReplyPatch } from "./sarvam-core";
import { newNativeDraft } from "./draft";
import { bareClockMinutes, periodWordFits, roughLocalTime, spokenIn } from "./vague-time";

const day = "2026-10-28";
const draft = (transcript: string) => ({ ...newNativeDraft("a".repeat(64), day, "Asia/Kolkata", "personal"), transcript });
type Timing = { startLocal?: string | null; endLocal?: string | null; timePrecision?: string | null; timeSpoken?: string | null };
const row = (activity: string, sourceQuote: string, node: string, timing: Timing = {}) => ({
  activity, sourceQuote, node, context: null, proof: null, sleepRest: false, community: null, lane: null,
  direction: null, intensity: null, confidence: null, startLocal: null, endLocal: null, ...timing,
});

const account = "Woke up at 6am. Then I walked seven to eight. Breakfast around 8:30. After lunch I did some work. In the evening I met friends.";
const proposal = () => [
  row("Woke up", "Woke up at 6am.", "Physiology", { startLocal: `${day}T06:00`, timePrecision: "exact", timeSpoken: "6am" }),
  row("Walk", "Then I walked seven to eight.", "Physiology", { startLocal: `${day}T07:00`, endLocal: `${day}T08:00`, timePrecision: "period_inferred", timeSpoken: "seven to eight" }),
  row("Breakfast", "Breakfast around 8:30.", "Physiology", { startLocal: `${day}T08:30`, timePrecision: "approximate", timeSpoken: "around 8:30" }),
  row("Some work", "After lunch I did some work.", "Performance", { timePrecision: "relative", timeSpoken: "After lunch" }),
  row("Met friends", "In the evening I met friends.", "Feeling", { timePrecision: "part_of_day", timeSpoken: "In the evening" }),
];

describe("rough spoken times", () => {
  it("places rough times the person said, settles morning from the order of the day, and keeps other time words", () => {
    const [woke, walk, breakfast, work, friends] = checkedProposal({ activities: proposal() }, draft(account));
    expect([woke.startLocal, woke.timePrecision]).toEqual([`${day}T06:00`, "exact"]);
    expect([walk.startLocal, walk.endLocal, walk.timePrecision]).toEqual([`${day}T07:00`, `${day}T08:00`, "period_inferred"]);
    expect(walk.timeNote).toContain("seven to eight");
    expect([breakfast.startLocal, breakfast.timePrecision]).toEqual([`${day}T08:30`, "period_inferred"]);
    expect(breakfast.timeNote).toMatch(/^Approximate: “around 8:30”/);
    expect([work.startLocal, work.timePrecision, work.timeLabel]).toEqual(["", "relative", "After lunch"]);
    expect([friends.startLocal, friends.timePrecision, friends.timeLabel]).toEqual(["", "part_of_day", "In the evening"]);
  });

  it("refuses the evening reading when the day says morning", () => {
    const rows = proposal();
    rows[1] = { ...rows[1], startLocal: `${day}T19:00`, endLocal: `${day}T20:00` };
    const [, walk] = checkedProposal({ activities: rows }, draft(account));
    expect([walk.startLocal, walk.endLocal, walk.timePrecision]).toEqual(["", "", "unknown"]);
  });

  it("asks rather than guesses a lone bare clock, but accepts an afternoon one after lunch", () => {
    const lone = "I went to the meeting at 2:30.";
    const meeting = (startLocal: string) => row("Meeting", lone, "Performance", { startLocal, timePrecision: "period_inferred", timeSpoken: "at 2:30" });
    expect(checkedProposal({ activities: [meeting(`${day}T14:30`)] }, draft(lone))[0].startLocal).toBe("");
    const ordered = "Lunch at 1pm. I went to the meeting at 2:30.";
    const lunch = row("Lunch", "Lunch at 1pm.", "Physiology", { startLocal: `${day}T13:00`, timePrecision: "exact", timeSpoken: "1pm" });
    expect(checkedProposal({ activities: [lunch, meeting(`${day}T14:30`)] }, draft(ordered))[1].startLocal).toBe(`${day}T14:30`);
    expect(checkedProposal({ activities: [lunch, meeting(`${day}T02:30`)] }, draft(ordered))[1].startLocal).toBe("");
  });

  it("never accepts a clock that was not in the person's time words", () => {
    const rows = proposal();
    rows[2] = { ...rows[2], startLocal: `${day}T09:00` };
    expect(checkedProposal({ activities: rows }, draft(account))[2].startLocal).toBe("");
    // Time words the person never said are not stored, even when the clock itself is grounded.
    rows[2] = { ...rows[2], startLocal: `${day}T08:30`, timeSpoken: "around half past eight" };
    const breakfast = checkedProposal({ activities: rows }, draft(account))[2];
    expect([breakfast.startLocal, breakfast.timeNote, breakfast.timeLabel]).toEqual([`${day}T08:30`, undefined, undefined]);
  });

  it("keeps a lone morning time when the person said 'morning', and a stated duration gives the end", () => {
    const words = "This morning I walked around 7 for an hour.";
    const [walk] = checkedProposal({ activities: [row("Walk", words, "Physiology", { startLocal: `${day}T07:00`, endLocal: `${day}T08:00`, timePrecision: "approximate", timeSpoken: "around 7 for an hour" })] }, draft(words));
    expect([walk.startLocal, walk.endLocal]).toEqual([`${day}T07:00`, `${day}T08:00`]);
  });

  it("keeps the older behaviour when the model sends no timing fields", () => {
    const words = "I walked from 8am to 8:30am.";
    const [walk] = checkedProposal({ activities: [row("Walk", words, "Physiology", { startLocal: `${day}T08:00`, endLocal: `${day}T08:30` })] }, draft(words));
    expect([walk.startLocal, walk.endLocal, walk.timePrecision, walk.timeNote]).toEqual([`${day}T08:00`, `${day}T08:30`, undefined, undefined]);
  });

  it("fills a missing time from a spoken answer for that one activity", () => {
    const base = draft(account), activities = checkedProposal({ activities: proposal() }, base);
    const breakfast = { ...activities[2], startLocal: "", endLocal: "", timePrecision: "unknown" as const, timeNote: undefined };
    const reply = { id: "30000000-0000-4000-8000-000000000003", activityId: breakfast.id, text: "It was around 8:30, after my walk." };
    const next = { ...base, activities: [activities[0], activities[1], breakfast, ...activities.slice(3)], conversation: [reply] };
    const result = checkedReplyPatch({ remove: false, changes: { startLocal: `${day}T08:30`, timePrecision: "approximate", timeSpoken: "around 8:30" } }, next);
    const updated = result.find((a) => a.id === breakfast.id)!;
    expect([updated.startLocal, updated.timePrecision]).toEqual([`${day}T08:30`, "period_inferred"]);
    expect(updated.timeNote).toContain("around 8:30");
  });
});

describe("rough time helpers", () => {
  it("reads both halves of a bare clock and ignores durations", () => {
    expect([...bareClockMinutes("around 8")].sort((a, b) => a - b)).toEqual([480, 1200]);
    expect(bareClockMinutes("for 2 hours").size).toBe(0);
    expect(bareClockMinutes("सुबह लगभग आठ बजे").has(480)).toBe(true);
  });
  it("needs an approximation word for approximate, and its own words in the source", () => {
    expect(roughLocalTime(`${day}T08:00`, "at 8", day, "approximate")).toBe("");
    expect(roughLocalTime(`${day}T08:00`, "சுமார் 8 மணிக்கு", day, "approximate")).toBe(`${day}T08:00`);
    expect(spokenIn("Breakfast around 8:30.", "around 8:30")).toBe(true);
    expect(spokenIn("Breakfast around 8:30.", "at 9")).toBe(false);
  });
  it("lets only a matching period word settle the half of the day", () => {
    expect(periodWordFits("this morning at 7", `${day}T07:00`)).toBe(true);
    expect(periodWordFits("this morning at 7", `${day}T19:00`)).toBe(false);
    expect(periodWordFits("शाम को 7 बजे", `${day}T19:00`)).toBe(true);
    expect(periodWordFits("morning and evening", `${day}T07:00`)).toBe(false);
  });
});

describe("existing morning narration with stated precision", () => {
  it("keeps bare morning clocks when the account itself says it is morning ('Now it's 11:30 am')", async () => {
    const { reconcileNarrativeTimes } = await import("./chronology");
    const spoken = "After 7:15, 7:30 I met friends and we walked around a farm, visited the nearby school and exercised, then came back around 8:30. Then I talked to a neighbour until 9:30, then had breakfast till 10:30. Then attended the daily standup, which just got over. Now it's 11:30 am.";
    const d = { ...draft(spoken), date: "2026-10-25" };
    const at = (t: string) => `2026-10-25T${t}`;
    const rows = [
      row("Met friends, walked", "After 7:15, 7:30 I met friends and we walked around a farm, visited the nearby school and exercised, then came back around 8:30.", "Physiology", { startLocal: at("07:30"), endLocal: at("08:30"), timePrecision: "approximate", timeSpoken: "After 7:15, 7:30" }),
      row("Talked to a neighbour", "Then I talked to a neighbour until 9:30,", "Feeling", { startLocal: at("08:30"), endLocal: at("09:30"), timePrecision: "period_inferred", timeSpoken: "until 9:30" }),
      row("Breakfast", "then had breakfast till 10:30.", "Physiology", { startLocal: at("09:30"), endLocal: at("10:30"), timePrecision: "period_inferred", timeSpoken: "till 10:30" }),
      row("Daily standup", "Then attended the daily standup, which just got over. Now it's 11:30 am.", "Performance", { startLocal: at("10:30"), endLocal: at("11:30"), timePrecision: "exact", timeSpoken: "11:30 am" }),
    ];
    const result = reconcileNarrativeTimes({ ...d, activities: checkedProposal({ activities: rows }, d) }).activities;
    expect(result.map((a) => [a.startLocal.slice(11), a.endLocal.slice(11)])).toEqual([["07:30", "08:30"], ["08:30", "09:30"], ["09:30", "10:30"], ["10:30", "11:30"]]);
    expect(result[0].timeNote).toContain("7:15");
  });
});

describe("model labels are hints, not authority", () => {
  const words = "Woke up at 6am. Then I walked seven to eight.";
  const walk = (timing: Timing) => row("Walk", "Then I walked seven to eight.", "Physiology", { startLocal: `${day}T07:00`, endLocal: `${day}T08:00`, timeSpoken: "seven to eight", ...timing });
  it("reads a bare clock by the order of the day even when the model calls it exact or gives no precision", () => {
    const woke = row("Woke up", "Woke up at 6am.", "Physiology", { startLocal: `${day}T06:00`, timePrecision: "exact", timeSpoken: "6am" });
    for (const timePrecision of ["exact", null]) {
      const [, result] = checkedProposal({ activities: [woke, walk({ timePrecision })] }, draft(words));
      expect([result.startLocal, result.endLocal, result.timePrecision]).toEqual([`${day}T07:00`, `${day}T08:00`, "period_inferred"]);
    }
  });
  it("uses the end of sleep as the morning anchor", () => {
    const slept = { ...row("Sleep", "Woke up at 6am.", "Physiology", { endLocal: `${day}T06:00`, timePrecision: "exact", timeSpoken: "6am" }), sleepRest: true };
    const [, result] = checkedProposal({ activities: [slept, walk({ timePrecision: "period_inferred" })] }, draft(words));
    expect([result.startLocal, result.endLocal]).toEqual([`${day}T07:00`, `${day}T08:00`]);
  });
});
