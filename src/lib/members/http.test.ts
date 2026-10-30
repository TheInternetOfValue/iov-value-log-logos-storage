import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ memberSession: vi.fn() }));
import { memberSession } from "./session";
import { checkMemberBinding, memberWrite, memberWriteBinding } from "./http";
const origin = "https://valuelog.theinternetofvalue.org";
function request(body: unknown = {}, extra: Record<string,string> = {}) {
  return new NextRequest(origin + "/api/member/entries", { method: "PUT", headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-value-log-session": memberWriteBinding("member-A"), ...extra }, body: JSON.stringify(body) });
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("member write boundary", () => {
  it("retains the original account binding when another tab changes the signed-in account", async () => {
    vi.stubEnv("AUDIT_DIGEST_KEY", "synthetic-key-which-is-over-thirty-two-characters");
    expect(() => checkMemberBinding(request(), "member-B")).toThrow("ACCOUNT_CHANGED");
    expect(() => checkMemberBinding(request(), "member-A")).not.toThrow();
  });
  it("requires exact same origin, JSON and a verified personal session before saving", async () => {
    vi.stubEnv("AUDIT_DIGEST_KEY", "synthetic-key-which-is-over-thirty-two-characters"); vi.stubEnv("VALUE_LOG_MEMBER_WRITING", "open");
    vi.mocked(memberSession).mockResolvedValue({ kind: "personal", user: { id: "member-A" } } as never);
    expect((await memberWrite(request({ text: "Synthetic writing" }))).body).toEqual({ text: "Synthetic writing" });
    for (const headers of ([{ origin: "https://attacker.example" }, { "content-type": "text/plain" }, { "sec-fetch-site": "cross-site" }] as Record<string,string>[])) await expect(memberWrite(request({}, headers))).rejects.toThrow("ORIGIN_REQUIRED");
    await expect(memberWrite(request({}, { "x-value-log-session": "" }))).rejects.toThrow("ACCOUNT_CHANGED");
  });
  it("a writing pause preserves the read session and rejects mutations", async () => {
    vi.stubEnv("AUDIT_DIGEST_KEY", "synthetic-key-which-is-over-thirty-two-characters"); vi.stubEnv("VALUE_LOG_MEMBER_WRITING", "closed");
    vi.mocked(memberSession).mockResolvedValue({ kind: "personal", user: { id: "member-A" } } as never);
    await expect(memberWrite(request())).rejects.toThrow("WRITING_PAUSED");
  });
  it("never opens this new writer to the pilot branch or unbounded bodies", async () => {
    vi.stubEnv("AUDIT_DIGEST_KEY", "synthetic-key-which-is-over-thirty-two-characters"); vi.stubEnv("VALUE_LOG_MEMBER_WRITING", "open");
    vi.mocked(memberSession).mockResolvedValue({ kind: "pilot", user: { id: "member-A" } } as never);
    await expect(memberWrite(request())).rejects.toThrow("UNAUTHORIZED");
    vi.mocked(memberSession).mockResolvedValue({ kind: "personal", user: { id: "member-A" } } as never);
    await expect(memberWrite(request({ text: "x".repeat(30001) }))).rejects.toThrow("INVALID_INPUT");
  });
});
