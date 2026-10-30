import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { memberAuthLocator, resolveIdentityMember } from "./admission";
const did = "did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture(existing = false) {
  let present = existing, candidate: { owner_id: string; email: string } | null = null;
  const rpc = vi.fn(async (name: string) => {
    if (name === "value_log_identity_candidate") return { data: candidate ? [candidate] : [], error: null };
    present = true; return { data: "new-owner", error: null };
  });
  const createUser = vi.fn(async (input: { email: string }) => {
    candidate = { owner_id: "new-owner", email: input.email }; return { data: { user: { id: "new-owner" } }, error: null };
  });
  const db = { rpc, auth: { admin: { createUser } }, from: (table: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: table === "member_identity_bindings" && present ? { owner_id: "original-owner" } : null, error: null }),
    single: async () => ({ data: { email: "original@example.test" }, error: null }),
  }) }) }) };
  return { db: db as never, rpc, createUser, candidate: () => candidate };
}
beforeEach(() => vi.stubEnv("WORD_WALLET_PROJECTION_SECRET", "synthetic-auth-channel-key"));
afterEach(() => vi.unstubAllEnvs());
describe("DID-only Value Log membership", () => {
  it("retains the existing owner and original email even while admission is paused", async () => {
    vi.stubEnv("VALUE_LOG_MEMBER_ADMISSION", "closed"); const f = fixture(true);
    expect(await resolveIdentityMember(f.db, did)).toEqual({ ownerId: "original-owner", email: "original@example.test" });
    expect(f.createUser).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("new membership uses a non-deliverable technical locator and server-only issuer metadata", async () => {
    vi.stubEnv("VALUE_LOG_MEMBER_ADMISSION", "open"); const f = fixture();
    expect(await resolveIdentityMember(f.db, did)).toEqual({ ownerId: "new-owner", email: memberAuthLocator(did) });
    expect(f.createUser).toHaveBeenCalledWith({ email: memberAuthLocator(did), email_confirm: true,
      app_metadata: { identity_issuer: "word-wallet-web", identity_did: did } });
    expect(f.rpc).toHaveBeenLastCalledWith("admit_value_log_member", { p_owner_id: "new-owner", p_did: did, p_email: memberAuthLocator(did) });
  });
  it("refuses new members while paused, before creating any Auth user", async () => {
    vi.stubEnv("VALUE_LOG_MEMBER_ADMISSION", "closed"); const f = fixture();
    await expect(resolveIdentityMember(f.db, did)).rejects.toThrow("ADMISSION_PAUSED"); expect(f.createUser).not.toHaveBeenCalled();
  });
  it("invalid DID cannot reach Auth or membership lookup", async () => {
    const f = fixture(); await expect(resolveIdentityMember(f.db, "did:iov:member:Moses")).rejects.toThrow("INVALID_IDENTITY"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("a concurrent Auth creation is recovered only through the trusted candidate resolver", async () => {
    vi.stubEnv("VALUE_LOG_MEMBER_ADMISSION", "open"); const f = fixture();
    f.createUser.mockImplementationOnce(async () => ({ data: { user: null }, error: { message: "already exists" } }) as never);
    f.rpc.mockResolvedValueOnce({ data: [], error: null } as never).mockResolvedValueOnce({ data: [{ owner_id: "new-owner", email: memberAuthLocator(did) }], error: null } as never);
    expect((await resolveIdentityMember(f.db, did)).ownerId).toBe("new-owner");
  });
  it("an unrelated email collision never acquires a binding", async () => {
    vi.stubEnv("VALUE_LOG_MEMBER_ADMISSION", "open"); const f = fixture();
    f.createUser.mockImplementationOnce(async () => ({ data: { user: null }, error: { message: "already exists" } }) as never);
    await expect(resolveIdentityMember(f.db, did)).rejects.toThrow("MEMBERSHIP_UNAVAILABLE");
    expect(f.rpc.mock.calls.filter(call => call[0] === "admit_value_log_member")).toHaveLength(0);
  });
});
