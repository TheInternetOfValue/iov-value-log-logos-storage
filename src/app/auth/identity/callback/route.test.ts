import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serverClient: vi.fn() }));
vi.mock("@/lib/members/admission", async importOriginal => ({ ...await importOriginal<object>(), resolveIdentityMember: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
import { adminClient } from "@/lib/supabase/admin";
import { serverClient } from "@/lib/supabase/server";
import { resolveIdentityMember } from "@/lib/members/admission";
import { createServerClient } from "@supabase/ssr";
import { codeChallenge, handoffCookie } from "@/lib/identity-handoff";
import { GET } from "./route";
const origin = "https://valuelog.theinternetofvalue.org", owner = "22222222-2222-4222-8222-222222222222", key = "synthetic-handoff-key";
let inserted: ReturnType<typeof vi.fn>, generate: ReturnType<typeof vi.fn>, verify: ReturnType<typeof vi.fn>;
function request(patch: Record<string,unknown> = {}, expectedOwner: string | null = null) {
  const verifier = randomBytes(32).toString("base64url"), state = randomBytes(24).toString("base64url");
  const p = Buffer.from(JSON.stringify({ version: 1, audience: "iov-value-log", did: "did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", returnTo: origin + "/auth/identity/callback", state, codeChallenge: codeChallenge(verifier), issuedAt: Date.now(), expiresAt: Date.now() + 299000, nonce: randomUUID(), ...patch })).toString("base64url");
  const code = `${p}.${createHmac("sha256", key).update(p).digest("base64url")}`;
  return new NextRequest(origin + `/auth/identity/callback?code=${encodeURIComponent(code)}&state=${state}`, { headers: { cookie: `iov_identity_handoff=${handoffCookie({ verifier, state, expectedOwner })}` } });
}
beforeEach(() => {
  vi.stubEnv("WORD_WALLET_PROJECTION_SECRET", key); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon");
  inserted = vi.fn(async () => ({ error: null })); generate = vi.fn(async () => ({ data: { user: { id: owner }, properties: { hashed_token: "synthetic-onetime-hash", verification_type: "magiclink" } }, error: null }));
  verify = vi.fn(async () => ({ data: { user: { id: owner } }, error: null }));
  vi.mocked(adminClient).mockReturnValue({ from: () => ({ insert: inserted }), auth: { admin: { generateLink: generate } } } as never);
  vi.mocked(serverClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as never);
  vi.mocked(createServerClient).mockReturnValue({ auth: { verifyOtp: verify } } as never);
  vi.mocked(resolveIdentityMember).mockResolvedValue({ ownerId: owner, email: "synthetic@members.valuelog.invalid" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("Value Log signed return route", () => {
  it("a valid return consumes once, resolves DID, checks both Auth IDs and returns to the private workspace", async () => {
    const response = await GET(request());
    const destination = new URL(response.headers.get("location")!);
    expect(destination.toString()).toBe(origin + "/day?identity=connected");
    expect(destination.searchParams.has("code")).toBe(false);
    expect(destination.searchParams.has("state")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(resolveIdentityMember).toHaveBeenCalledWith(expect.anything(), "did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", undefined);
    expect(verify).toHaveBeenCalledWith({ token_hash: "synthetic-onetime-hash", type: "magiclink" });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("tampering, expiry, wrong callback or a changed account cannot provision or sign in", async () => {
    for (const patch of [{ returnTo: "https://attacker.example/auth/identity/callback" }, { expiresAt: Date.now() - 1 }, { codeChallenge: codeChallenge("wrong-verifier") }]) {
      expect(new URL((await GET(request(patch))).headers.get("location")!).searchParams.get("identity")).toBe("invalid-or-expired");
    }
    vi.mocked(serverClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) } } as never);
    expect(new URL((await GET(request())).headers.get("location")!).searchParams.get("identity")).toBe("account-changed");
    expect(resolveIdentityMember).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("a redeemed return cannot reach admission or session creation", async () => {
    inserted.mockResolvedValueOnce({ error: { code: "23505" } });
    expect(new URL((await GET(request())).headers.get("location")!).searchParams.get("identity")).toBe("already-used");
    expect(resolveIdentityMember).not.toHaveBeenCalled();
  });
  it("generated and verified sessions must belong to the bound owner", async () => {
    generate.mockResolvedValueOnce({ data: { user: { id: "wrong-owner" }, properties: { hashed_token: "synthetic" } }, error: null });
    expect(new URL((await GET(request())).headers.get("location")!).searchParams.get("identity")).toBe("session-unavailable"); expect(verify).not.toHaveBeenCalled();
    verify.mockResolvedValueOnce({ data: { user: { id: "wrong-owner" } }, error: null });
    expect(new URL((await GET(request())).headers.get("location")!).searchParams.get("identity")).toBe("session-unavailable");
  });
  it("a different DID cannot replace an already signed-in Value Log account", async () => {
    vi.mocked(serverClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) } } as never);
    vi.mocked(resolveIdentityMember).mockResolvedValueOnce({ ownerId: "different-owner", email: "unrelated@example.test" });
    expect(new URL((await GET(request({}, owner))).headers.get("location")!).searchParams.get("identity")).toBe("account-mismatch"); expect(generate).not.toHaveBeenCalled();
  });
});
