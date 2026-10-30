import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cohort/server", () => ({ cohortSnapshot: vi.fn() }));
vi.mock("@/lib/members/storage", () => ({ entryColumns: "*", readMemberEntry: (row: unknown) => row }));
import { memberDayProjection } from "@/lib/members/day-server";
import { accounts, fixtureId } from "./fixtures";
const tables: Record<string, unknown[]> = {};
const queried = vi.fn();
function client() {
  return { from: (table: string) => {
    queried(table);
    const result = () => Promise.resolve({ data: tables[table] ?? [], error: null });
    const q = { select: () => q, eq: () => q, is: () => q, or: () => q, order: () => q, range: result, in: result };
    return q;
  } } as unknown as Parameters<typeof memberDayProjection>[0];
}
beforeEach(() => { for (const table of Object.keys(tables)) delete tables[table]; queried.mockReset(); });
const index = { native_draft_id: fixtureId(901), activity_id: fixtureId(902), occurrence_id: fixtureId(902), source_id: fixtureId(903), source_kind: "member", start_at: "2026-10-26T08:00:00+05:30", end_at: "2026-10-26T08:30:00+05:30", outcome: "unassessed", member_entry_ids: [fixtureId(903)] };
it("U10/U12: removing a legacy voice transcript cannot erase its separately confirmed private activity", async () => {
  tables.native_log_day_index = [index];
  tables.member_activity_entries = [{ id: fixtureId(903), text: "Previously confirmed private walk", node: "Physiology" }];
  const result = await memberDayProjection(client(), accounts.brosA.owner, "2026-10-26", null);
  expect(result.activities).toHaveLength(1); expect(result.activities[0].activity).toBe("Previously confirmed private walk");
  expect(result.notes).toEqual([]); expect(queried).not.toHaveBeenCalledWith("native_log_drafts");
});
it("U12: a removed confirmed legacy entry cannot be resurrected by its older voice source", async () => {
  tables.native_log_day_index = [index]; tables.member_activity_entries = [];
  const result = await memberDayProjection(client(), accounts.brosA.owner, "2026-10-26", null);
  expect(result.activities).toEqual([]); expect(result.notes).toEqual([]);
});
it("U13: an occurrence completed exactly at midnight moves the completion day's score once", async () => {
  const cohort = { enrollment: { boundary_at: "2026-10-26T00:00:00+05:30", policy_id: "field-station-oct26-28-700-v1" }, records: [], state: { events: [{ recordId: fixtureId(904), end: "2026-10-27T00:00:00+05:30", after: 700.007, delta: 0.007 }] } };
  const result = await memberDayProjection(client(), accounts.brosA.owner, "2026-10-27", cohort as never);
  expect(result.score.opening).toBe(700); expect(result.score.current).toBe(700.007); expect(result.score.completedMovement).toBe(0.007);
});
