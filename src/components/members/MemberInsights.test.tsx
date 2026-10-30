import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const projection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/members/day-server", () => ({ memberDayProjection: projection }));
import { MemberInsights } from "./MemberInsights";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("member activity Insights", () => {
  it("uses the signed-in owner and does not count an untimed note as time", async () => {
    projection.mockImplementation(async (_client, _owner, date) => ({ date, activities: date === "2026-10-28" ? [{ occurrenceId: "walk", node: "Physiology", startMinute: 480, endMinute: 510 }] : [], notes: date === "2026-10-28" ? [{ occurrenceId: "note", node: "Thought" }] : [] }));
    const html = renderToStaticMarkup(await MemberInsights({ client: {} as SupabaseClient, owner: "member-a", cohort: null, today: "2026-10-28" }));
    expect(projection).toHaveBeenCalledTimes(7);
    expect(projection.mock.calls.every(call => call[1] === "member-a")).toBe(true);
    expect(html).toContain("30m");
    expect(html).toContain("Thought, 2026-10-28: 1 activity");
    expect(html).toContain("Activity is not a wellbeing score.");
  });
});
