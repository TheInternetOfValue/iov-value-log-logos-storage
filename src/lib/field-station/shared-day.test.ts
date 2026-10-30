import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { tables } = vi.hoisted(() => ({ tables: { binding: null as null | { did: string }, enrolled: false, invited: false } }));
vi.mock("@/lib/supabase/admin-core", () => ({
  adminClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q, eq: () => q, is: () => q, gt: () => q,
        limit: async () => ({ data: tables.invited ? [{ id: "invite" }] : [], error: null }),
        maybeSingle: async () => ({ data: table === "member_identity_bindings" ? tables.binding : tables.enrolled ? { owner_id: "x" } : null, error: null }),
      };
      return q;
    },
  }),
}));
import { deviceRecoveryFor, rolloutDids, sharedDayFor } from "./shared-day";
const owner = "11111111-1111-4111-8111-111111111111",
  listed = "did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "did:iov:member:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeEach(() => {
  Object.assign(tables, { binding: { did: listed }, enrolled: false, invited: false });
  vi.stubEnv("VALUE_LOG_ROLLOUT_DIDS", `${listed}, not-a-did`);
});
afterEach(() => vi.unstubAllEnvs());
describe("staged shared-day rollout", () => {
  it("admits a listed participant while the switch is qa, without a QA policy", async () => {
    vi.stubEnv("VALUE_LOG_SHARED_DAY", "qa");
    expect([...rolloutDids()]).toEqual([listed]);
    expect(await sharedDayFor(owner)).toBe(true);
    tables.binding = { did: other };
    expect(await sharedDayFor(owner)).toBe(false);
    tables.invited = true;
    expect(await sharedDayFor(owner)).toBe(true);
  });
  it("keeps closed as the stop switch and the founder pilot outside the member day", async () => {
    vi.stubEnv("VALUE_LOG_SHARED_DAY", "closed");
    expect(await sharedDayFor(owner)).toBe(false);
    vi.stubEnv("VALUE_LOG_SHARED_DAY", "qa");
    expect(await sharedDayFor(owner, "pilot")).toBe(false);
  });
  it("extends qa device recovery to the same listed participants", async () => {
    vi.stubEnv("VALUE_LOG_SHARED_DAY", "qa");
    vi.stubEnv("VALUE_LOG_DEVICE_RECOVERY", "qa");
    expect(await deviceRecoveryFor(owner, "personal")).toBe(true);
    vi.stubEnv("VALUE_LOG_ROLLOUT_DIDS", "");
    expect(await deviceRecoveryFor(owner, "personal")).toBe(false);
  });
});
