import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin-core", () => ({ adminClient: admin }));
import { runCohortQueue as scheduled } from "./queue";
const owner = "10000000-0000-4000-8000-000000000001";
function setup({
  active = true,
  dirty = true,
  due = false,
  unresolved = false,
} = {}) {
  const limit = vi.fn();
  admin.mockReturnValue({
    rpc: async (name: string) => ({ data: name === "claim_cohort_queue_cursor" ? { cursor: null } : true, error: null }),
    from: (table: string) => {
      let status = "";
      const q = {
        select: () => q,
        eq: (key: string, value: string) => {
          if (key === "review_status") status = value;
          return q;
        },
        in: () => q,
        order: () => q,
        or: () => q,
        single: async () => ({ data: { active }, error: null }),
        limit: async (n: number) => {
          limit(table, n);
          return {
            data:
              table === "cohort_enrollments"
                ? [
                    {
                      owner_id: owner,
                      revision: 2,
                      calculated_revision: dirty ? 1 : 2,
                    },
                  ]
                : table === "cohort_records"
                  ? (status === "pending" ? due : unresolved)
                    ? [{ id: owner }]
                    : []
                  : [],
            error: null,
          };
        },
      };
      return q;
    },
  });
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 202 }),
  );
  vi.stubGlobal("fetch", fetch);
  return { fetch, limit };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CONTEXT", "production");
  vi.stubEnv("VALUE_LOG_COHORT_REVIEW", "open");
  vi.stubEnv("VALUE_LOG_COHORT_CALCULATION", "open");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://valuelog.theinternetofvalue.org");
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-queue-key-more-than-thirty-two-characters",
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("can resume calculation with review paused and the operator offline", async () => {
  const h = setup({ active: false });
  vi.stubEnv("VALUE_LOG_COHORT_REVIEW", "closed");
  await scheduled();
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.limit).toHaveBeenCalledWith("cohort_enrollments", 50);
  const input = h.fetch.mock.calls[0][1] as RequestInit;
  expect(JSON.parse(input.body as string).owner).toBe(owner);
  expect(input.headers).toHaveProperty("x-cohort-job");
});
it("does not scan unchanged histories or bypass unresolved records", async () => {
  const h = setup({ dirty: false });
  await scheduled();
  expect(h.fetch).not.toHaveBeenCalled();
  const h2 = setup({ dirty: true, unresolved: true });
  await scheduled();
  expect(h2.fetch).not.toHaveBeenCalled();
});
it("dispatches due review independently of calculation and never runs outside production", async () => {
  const h = setup({ dirty: false, due: true });
  vi.stubEnv("VALUE_LOG_COHORT_CALCULATION", "closed");
  await scheduled();
  expect(h.fetch).toHaveBeenCalledTimes(1);
  vi.stubEnv("CONTEXT", "deploy-preview");
  h.fetch.mockClear();
  await scheduled();
  expect(h.fetch).not.toHaveBeenCalled();
});
