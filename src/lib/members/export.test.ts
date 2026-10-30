import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encryptNarrative } from "@/lib/crypto";
import { exportMemberLog } from "./export";
const owner = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { vi.stubEnv("NARRATIVE_ENCRYPTION_KEY_BASE64", Buffer.alloc(32, 8).toString("base64")); vi.stubEnv("AUDIT_DIGEST_KEY", "synthetic-private-export-test-digest-key"); });
afterEach(() => vi.unstubAllEnvs());
function fixture(failLater = false) {
  const encrypted = encryptNarrative(JSON.stringify({ date: "2026-10-25", node: "Thought", text: "Synthetic activity", minutes: null }));
  const rows = Array.from({ length: 1001 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, revision: 1,
    activity_date: "2026-10-25", wellbeing_node: "Thought", content_ciphertext: encrypted.ciphertext, content_iv: encrypted.iv, content_auth_tag: encrypted.authTag,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", removed_at: n === 500 ? "2026-10-01T00:00:00Z" : null }));
  const filters: Array<[string,string,string]> = [];
  const client = { from: (table: string) => {
    let cursor = "";
    const query = {
      select: () => query, eq: (key: string, value: string) => { filters.push([table,key,value]); return query; },
      lte: () => query, order: () => query, limit: () => query, gt: (_key: string, value: string) => { cursor = value; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "member_activity_entries" ? rows.filter(row => row.id > cursor).slice(0,1000) : [], error: failLater && cursor ? { message: "synthetic read failure" } : null }).then(resolve),
    }; return query;
  } };
  return { filters, session: { kind: "personal", client, user: { id: owner }, did: "did:iov:member:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Synthetic member", timezone: "UTC", onboarded: true } as never };
}
describe("complete private member export", () => {
  it("includes later pages and removal markers, decrypts only owner records, and omits storage ciphertext", async () => {
    const f = fixture(); const response = await exportMemberLog(f.session); const body = await response.json();
    expect(body.activities).toHaveLength(1001); expect(new Set(body.activities.map((e: {id:string}) => e.id)).size).toBe(1001);
    expect(body.activities[500]).toEqual({ id: "00000000-0000-4000-8000-000000000500", revision: 1, removedAt: "2026-10-01T00:00:00Z" });
    expect(body.activities[0].text).toBe("Synthetic activity"); expect(JSON.stringify(body)).not.toContain("content_ciphertext");
    expect(f.filters.every(([,key,value]) => key === "owner_id" && value === owner)).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("content-disposition")).toContain("attachment");
  });
  it("refuses a failed later page instead of returning a partial export", async () => {
    const f = fixture(true); await expect(exportMemberLog(f.session)).rejects.toThrow("UNAVAILABLE");
  });
});
