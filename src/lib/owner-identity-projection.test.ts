import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ownerIdentityProjection } from "./owner-identity-projection";
import { MOSES_CANONICAL_DID } from "./identity";

const secret = "synthetic-connection-key-not-a-production-credential";
const projection = { identityDid: MOSES_CANONICAL_DID, audience: "identity-owner", purpose: "owner-private-profile", nodes: [], displayName: "Synthetic owner" };

describe("owner identity connection", () => {
  beforeEach(() => {
    vi.stubEnv("OWNER_IDENTITY_PROJECTION_SECRET", undefined);
    vi.stubEnv("WORD_WALLET_PROJECTION_SECRET", secret);
    vi.stubEnv("WORD_WALLET_API_URL", "https://synthetic.example.test/");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("signs the exact private read path, trims the host credential and disables caching", async () => {
    vi.stubEnv("WORD_WALLET_PROJECTION_SECRET", ` \n${secret}\n `);
    const fetcher = vi.fn().mockResolvedValue(Response.json(projection));
    vi.stubGlobal("fetch", fetcher);
    expect(await ownerIdentityProjection()).toEqual(projection);
    const [url, options] = fetcher.mock.calls[0];
    const path = `/v1/internal/owner-wellbeing-identities/${encodeURIComponent(MOSES_CANONICAL_DID)}`;
    expect(url).toBe(`https://synthetic.example.test${path}`);
    expect(options.cache).toBe("no-store");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const timestamp = options.headers["x-iov-timestamp"];
    expect(options.headers["x-iov-signature"]).toBe(createHmac("sha256", secret).update(`${timestamp}.GET:${path}`).digest("hex"));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not make a request for a missing or whitespace-only credential", async () => {
    vi.stubEnv("WORD_WALLET_PROJECTION_SECRET", " \n ");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await ownerIdentityProjection()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("owner_identity_projection_unavailable", { reason: "configuration" });
  });

  it("reports only the HTTP status when the server refuses the signed read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: `private narrative ${secret}` } }, { status: 401 })));
    expect(await ownerIdentityProjection()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("owner_identity_projection_unavailable", { reason: "http", status: 401, credential: "legacy" });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private narrative|synthetic-connection-key|did:iov/);
  });

  it("uses the dedicated owner credential without replacing the publication credential", async () => {
    const ownerSecret = "synthetic-private-owner-key";
    vi.stubEnv("OWNER_IDENTITY_PROJECTION_SECRET", `\n${ownerSecret} `);
    const fetcher = vi.fn().mockResolvedValue(Response.json(projection));
    vi.stubGlobal("fetch", fetcher);
    expect(await ownerIdentityProjection()).toEqual(projection);
    const [url, options] = fetcher.mock.calls[0];
    const path = new URL(url).pathname;
    const timestamp = options.headers["x-iov-timestamp"];
    expect(options.headers["x-iov-signature"]).toBe(createHmac("sha256", ownerSecret).update(`${timestamp}.GET:${path}`).digest("hex"));
    expect(process.env.WORD_WALLET_PROJECTION_SECRET).toBe(secret);
  });

  it("never retries a rejected owner credential with the publication credential", async () => {
    vi.stubEnv("OWNER_IDENTITY_PROJECTION_SECRET", "synthetic-private-owner-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await ownerIdentityProjection()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("owner_identity_projection_unavailable", { reason: "http", status: 401, credential: "owner" });
  });

  it.each([
    { ...projection, identityDid: "did:iov:member:00000000-0000-4000-8000-000000000002" },
    { ...projection, audience: "public" },
    { ...projection, purpose: "public-profile" },
    null,
  ])("never substitutes another owner, a public response or a missing projection", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    expect(await ownerIdentityProjection()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("owner_identity_projection_unavailable", { reason: "projection" });
  });

  it("keeps private exception text and arbitrary cause codes out of diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`private narrative ${secret}`, { cause: { code: `private narrative ${secret}` } })));
    expect(await ownerIdentityProjection()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("owner_identity_projection_unavailable", { reason: "request", transport: "unknown" });
  });

  it("distinguishes transport failure without revealing its URL or response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private URL", { cause: { code: "ENOTFOUND" } })));
    expect(await ownerIdentityProjection()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("owner_identity_projection_unavailable", { reason: "request", transport: "ENOTFOUND" });
  });

  it("lets the profile render when the private read times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("private request", "TimeoutError")));
    expect(await ownerIdentityProjection()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("owner_identity_projection_unavailable", { reason: "timeout", transport: "unknown" });
  });
});
