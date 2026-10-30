import { describe, expect, it } from "vitest";
import { entrySchema, profileSchema } from "./entries";
const e = { id: "55555555-5555-4555-8555-555555555555", revision: 0, date: "2026-10-25", node: "Thought", text: "Read and reflected.", minutes: 15 };
describe("unassessed private activities", () => {
  it("accepts one canonical node and optional duration without inventing score or community", () => {
    expect(entrySchema.parse(e)).toEqual(e); expect(entrySchema.safeParse({ ...e, minutes: null }).success).toBe(true);
    for (const patch of [{ owner_id: "another-member" }, { wellbeing_score: 700 }, { community: "gfe" }, { node: "Online identity" }, { date: "2026-02-30" }, { minutes: 0 }, { minutes: 1441 }, { text: " " }, { revision: -1 }]) expect(entrySchema.safeParse({ ...e, ...patch }).success).toBe(false);
  });
  it("requires explicit storage acceptance, name and valid timezone", () => {
    expect(profileSchema.safeParse({ name: "Person A", timezone: "Europe/London", accepted: true }).success).toBe(true);
    expect(profileSchema.safeParse({ name: "Person A", timezone: "Goa", accepted: true }).success).toBe(false);
    expect(profileSchema.safeParse({ name: "Person A", timezone: "UTC", accepted: false }).success).toBe(false);
  });
});
