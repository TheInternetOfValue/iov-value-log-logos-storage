import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encryptNarrative } from "@/lib/crypto";
import { readMemberAudit } from "./export-audit";
afterEach(() => vi.unstubAllEnvs());
it("exports a readable owner community request without rewriting its stored ciphertext or changing legacy audit events", () => {
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-audit-export-key-more-than-thirty-two",
  );
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 3).toString("base64"),
  );
  const request = {
    name: "Synthetic தமிழ் community",
    reason: "I would like to participate.",
  };
  const row = {
    event_type: "cohort_community_requested",
    metadata: { content: encryptNarrative(JSON.stringify(request)) },
  };
  const exported = readMemberAudit(row);
  expect(exported.metadata.content).toEqual(request);
  expect(row.metadata.content).toHaveProperty("ciphertext");
  const old = { event_type: "native_log_confirmed", metadata: { count: 2 } };
  expect(readMemberAudit(old)).toEqual(old);
});
