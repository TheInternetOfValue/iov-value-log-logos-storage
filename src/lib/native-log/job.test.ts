import { afterEach, beforeEach, expect, it } from "vitest";
import { nativeJobSignature, verifiedNativeJob } from "./job";
import { vi } from "vitest";
const job = {
  owner: "11111111-1111-4111-8111-111111111111",
  id: "22222222-2222-4222-8222-222222222222",
  revision: 2,
  lease: "33333333-3333-4333-8333-333333333333",
  expires: 120000,
};
beforeEach(() =>
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-job-key-longer-than-thirty-two-characters",
  ),
);
afterEach(() => vi.unstubAllEnvs());
it("binds every dispatch field and expiry without putting content or a provider key in the job", () => {
  const raw = JSON.stringify(job),
    sig = nativeJobSignature(raw);
  expect(verifiedNativeJob(raw, sig, 10000)).toEqual(job);
  expect(() =>
    verifiedNativeJob(raw.replace('"revision":2', '"revision":3'), sig, 10000),
  ).toThrow("UNAUTHORIZED");
  expect(() => verifiedNativeJob(raw, sig, 120000)).toThrow("UNAUTHORIZED");
  expect(() => verifiedNativeJob(raw, "not-a-signature", 10000)).toThrow(
    "UNAUTHORIZED",
  );
  expect(raw).not.toContain("transcript");
  expect(raw).not.toContain("key");
});

it("completeness-only dispatch is separately signed and rejects invented operation authority", () => {
  const raw = JSON.stringify({ ...job, operation: "coverage" });
  expect(verifiedNativeJob(raw, nativeJobSignature(raw), 10000).operation).toBe(
    "coverage",
  );
  expect(() =>
    verifiedNativeJob(
      raw.replace("coverage", "approve"),
      nativeJobSignature(raw),
      10000,
    ),
  ).toThrow("UNAUTHORIZED");
  const invalid = JSON.stringify({ ...job, operation: "approve" });
  expect(() =>
    verifiedNativeJob(invalid, nativeJobSignature(invalid), 10000),
  ).toThrow();
});
