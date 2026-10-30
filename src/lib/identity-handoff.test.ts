import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { codeChallenge, handoffCookie, readHandoffCookie, verifyIdentityHandoff } from "./identity-handoff";
const secret = "synthetic-test-channel-key";
const valid = () => ({ version: 1, audience: "iov-value-log", did: "did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  returnTo: "https://valuelog.theinternetofvalue.org/auth/identity/callback", state: randomBytes(24).toString("base64url"),
  codeChallenge: codeChallenge(randomBytes(32).toString("base64url")), issuedAt: Date.now(), expiresAt: Date.now() + 299000, nonce: randomUUID() });
function signed(payload: unknown) { const p = Buffer.from(JSON.stringify(payload)).toString("base64url"); return `${p}.${createHmac("sha256", secret).update(p).digest("base64url")}`; }
afterEach(() => vi.unstubAllEnvs());
describe("private Identity handoff", () => {
  it("accepts the existing five-minute DID-only contract", () => { vi.stubEnv("WORD_WALLET_PROJECTION_SECRET", secret); const p = valid(); expect(verifyIdentityHandoff(signed(p))).toEqual(p); });
  it("rejects tampering, excessive lifetime, future issue, expiry, wrong audience and malformed identity", () => {
    vi.stubEnv("WORD_WALLET_PROJECTION_SECRET", secret);
    for (const patch of [{ expiresAt: Date.now() - 1 }, { issuedAt: Date.now() + 60000 }, { issuedAt: Date.now() - 600000 }, { did: "did:iov:member:Moses" }, { audience: "another-app" }, { nonce: "" }, { codeChallenge: 10 }, { state: "short" }]) expect(verifyIdentityHandoff(signed({ ...valid(), ...patch }))).toBeNull();
    expect(verifyIdentityHandoff(signed(valid()) + "x")).toBeNull(); expect(verifyIdentityHandoff(signed(valid()) + ".extra")).toBeNull();
  });
  it("binds a pending return to the starting account and bounded PKCE values", () => {
    const p = { verifier: randomBytes(32).toString("base64url"), state: randomBytes(24).toString("base64url"), expectedOwner: null };
    expect(readHandoffCookie(handoffCookie(p))).toEqual(p);
    expect(readHandoffCookie(Buffer.from(JSON.stringify({ ...p, verifier: "short" })).toString("base64url"))).toBeNull();
  });
});
it("retains only a bounded local invitation value without introducing a return URL",()=>{
 const p={verifier:randomBytes(32).toString("base64url"),state:randomBytes(24).toString("base64url"),expectedOwner:null,cohortInvite:"a".repeat(43)};
 expect(readHandoffCookie(handoffCookie(p))).toEqual(p);
 for(const cohortInvite of ["https://another.invalid/", "../admin", "a".repeat(101)])expect(readHandoffCookie(handoffCookie({...p,cohortInvite}))).toBeNull();
});
