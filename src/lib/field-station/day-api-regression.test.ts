import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  enabled: vi.fn(),
  member: vi.fn(),
  founder: vi.fn(),
}));
vi.mock("@/lib/members/session", () => ({ memberSession: mocks.session }));
vi.mock("@/lib/field-station/shared-day", () => ({
  sharedDayFor: mocks.enabled,
}));
vi.mock("@/lib/members/day-server", () => ({
  memberDayProjection: mocks.member,
}));
vi.mock("@/lib/members/founder-day-server", () => ({
  founderDayProjection: mocks.founder,
}));
import { GET } from "@/app/api/member/day/route";
import { NextRequest } from "next/server";
import { memberWriteBinding } from "@/lib/members/http";
import { accounts } from "./fixtures";
const client = {};
beforeEach(() => {
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-member-day-binding-longer-than-thirty-two",
  );
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.session.mockResolvedValue({
    kind: "personal",
    client,
    user: { id: accounts.brosA.owner },
  });
  mocks.member.mockResolvedValue({
    date: "2026-10-26",
    activities: [],
    cohort: { private: "server-only snapshot" },
  });
});
afterEach(() => vi.unstubAllEnvs());
const request = (binding = memberWriteBinding(accounts.brosA.owner)) =>
  new NextRequest(
    "https://valuelog.theinternetofvalue.org/api/member/day?date=2026-10-26&owner=" +
      accounts.brosB.owner,
    { headers: { "x-value-log-session": binding } },
  );
it("U10: the day API derives its owner from the session, ignores URL owner authority and remains uncached", async () => {
  const result = await GET(request());
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(mocks.member).toHaveBeenCalledWith(
    client,
    accounts.brosA.owner,
    "2026-10-26",
  );
  expect(await result.json()).not.toHaveProperty("cohort");
  expect(mocks.founder).not.toHaveBeenCalled();
});
it("U10/U21: an old account's binding cannot read the newly signed-in person's day", async () => {
  const result = await GET(request(memberWriteBinding(accounts.brosB.owner)));
  expect(result.status).toBe(403);
  expect(mocks.member).not.toHaveBeenCalled();
  expect(mocks.founder).not.toHaveBeenCalled();
});
it("U10: the founder uses the original founder adapter and cannot receive a new 700 cohort state", async () => {
  mocks.session.mockResolvedValue({
    kind: "pilot",
    client,
    user: { id: accounts.founder.owner },
  });
  mocks.founder.mockResolvedValue({
    score: { status: "founder", current: 812.25 },
  });
  const result = await GET(request(memberWriteBinding(accounts.founder.owner)));
  expect(result.status).toBe(200);
  expect((await result.json()).score.current).toBe(812.25);
  expect(mocks.founder).toHaveBeenCalledWith(
    client,
    accounts.founder.owner,
    "2026-10-26",
  );
  expect(mocks.member).not.toHaveBeenCalled();
});
it("closed day access and an expired session do not reach private projections", async () => {
  mocks.enabled.mockResolvedValue(false);
  expect((await GET(request())).status).toBe(503);
  mocks.session.mockRejectedValue(new Error("UNAUTHORIZED"));
  expect((await GET(request())).status).toBe(401);
  expect(mocks.member).not.toHaveBeenCalled();
});
