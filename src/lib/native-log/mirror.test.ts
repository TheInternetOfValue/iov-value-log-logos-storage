import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(), upsert = vi.fn(), updates: unknown[] = [];
vi.mock("@/lib/supabase/admin-core", () => ({
  adminClient: () => ({
    rpc,
    from: () => ({
      upsert,
      update: (values: unknown) => { updates.push(values); const chain = { eq: () => chain, is: async () => ({ error: null }) }; return chain; },
    }),
  }),
}));

import { mirrorEnvelope, mirrorNativeLogs } from "./mirror";

const pendingRow = { owner_id: "o1", id: "d1", revision: 3, content_ciphertext: "Y2lwaGVy", content_iv: "aXZpdml2aXZpdml2", content_auth_tag: "dGFndGFndGFndGFndGFndA==", content_key_version: 1, content_digest: "a".repeat(64) };
const cid = "zDvZRwzm8K4sTnvWhtqDVQCEnbFZPDAgrBXy4rL8hFPP1yYsDDNa";

beforeEach(() => {
  rpc.mockReset(); upsert.mockReset().mockResolvedValue({ error: null }); updates.length = 0;
  vi.stubEnv("LOGOS_STORAGE_URL", "https://node.example/api/storage/v1/");
  vi.stubEnv("LOGOS_STORAGE_TOKEN", "proxy-token");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("native log Logos Storage mirror", () => {
  it("does nothing when the node is not configured", async () => {
    vi.stubEnv("LOGOS_STORAGE_URL", "");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await mirrorNativeLogs()).toBeNull();
    expect(rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads only the ciphertext envelope, unadvertised, and records the CID", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "pending_native_log_mirrors" ? [pendingRow] : [], error: null }));
    const fetch = vi.fn().mockResolvedValue(new Response(`${cid}\n`)); vi.stubGlobal("fetch", fetch);
    expect(await mirrorNativeLogs()).toEqual({ mirrored: 1, deleted: 0, failed: 0 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://node.example/api/storage/v1/data?advertise=false");
    expect(init.headers.authorization).toBe("Bearer proxy-token");
    expect(init.body).toBe(mirrorEnvelope(pendingRow));
    expect(init.body).not.toContain("o1"); expect(init.body).not.toContain("d1"); expect(init.body).not.toContain(pendingRow.content_digest);
    expect(upsert).toHaveBeenCalledWith({ owner_id: "o1", draft_id: "d1", revision: 3, cid, content_digest: pendingRow.content_digest }, expect.objectContaining({ ignoreDuplicates: true }));
  });

  it("counts a node failure without recording a CID", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "pending_native_log_mirrors" ? [pendingRow] : [], error: null }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    expect(await mirrorNativeLogs()).toEqual({ mirrored: 0, deleted: 0, failed: 1 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed CID response", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "pending_native_log_mirrors" ? [pendingRow] : [], error: null }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>proxy</html>")));
    expect(await mirrorNativeLogs()).toEqual({ mirrored: 0, deleted: 0, failed: 1 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("deletes node copies of removed drafts and treats 404 as already gone", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "stale_native_log_mirrors" ? [{ owner_id: "o1", draft_id: "d1", revision: 3, cid }, { owner_id: "o1", draft_id: "d2", revision: 2, cid: cid.replace("z", "y") }] : [], error: null }));
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    expect(await mirrorNativeLogs()).toEqual({ mirrored: 0, deleted: 2, failed: 0 });
    expect(fetch.mock.calls[0][0]).toBe(`https://node.example/api/storage/v1/data/${cid}`);
    expect(fetch.mock.calls[0][1].method).toBe("DELETE");
    expect(updates).toHaveLength(2);
  });
});
