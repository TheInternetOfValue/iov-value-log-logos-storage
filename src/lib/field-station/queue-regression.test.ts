import { afterEach, expect, it, vi } from "vitest";
const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin-core", () => ({ adminClient: admin }));
import { runCohortQueue } from "@/lib/cohort/queue";
import { fixtureId } from "./fixtures";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("U23: more than eleven eligible owners on multiple pages all receive a turn", async () => {
  vi.stubEnv("CONTEXT", "production"); vi.stubEnv("VALUE_LOG_COHORT_REVIEW", "open"); vi.stubEnv("VALUE_LOG_COHORT_CALCULATION", "closed");
  vi.stubEnv("AUDIT_DIGEST_KEY", "synthetic-queue-regression-key-more-than-32-characters");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://valuelog.theinternetofvalue.org");
  const owners = Array.from({ length: 61 }, (_, i) => ({ owner_id: fixtureId(i + 1), revision: 2, calculated_revision: 2 }));
  admin.mockReturnValue({ rpc: async (name: string) => ({ data: name === "claim_cohort_queue_cursor" ? { cursor: null } : true, error: null }), from: (table: string) => {
    let after = "", cap = 1000;
    const result = () => ({ data: table === "cohort_enrollments" ? owners.filter(m => m.owner_id > after).slice(0, cap) : [{ id: fixtureId(100), created_at: "2026-10-26T00:00:00Z" }], error: null });
    const q = { select: () => q, eq: () => q, in: () => q, or: () => q, order: () => q, gt: (_: string, v: string) => { after = v; return q; },
      single: async () => ({ data: { active: true }, error: null }), limit: async (n: number) => { cap = n; return result(); } };
    return q;
  } });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 })); vi.stubGlobal("fetch", fetch);
  await runCohortQueue();
  const dispatched = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).owner);
  expect(new Set(dispatched)).toEqual(new Set(owners.map(m => m.owner_id)));
  expect(dispatched).toHaveLength(61);
});
