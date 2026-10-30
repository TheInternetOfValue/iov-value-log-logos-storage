import { beforeEach, describe, expect, it } from "vitest";
import { decryptNarrative, encryptNarrative, narrativeDigest } from "@/lib/crypto";

describe("narrative privacy", () => {
  beforeEach(() => {
    process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 7).toString("base64");
    process.env.NARRATIVE_KEY_VERSION = "1";
    process.env.AUDIT_DIGEST_KEY = "separate-audit-digest-key-with-32-chars";
  });

  it("round-trips AES-GCM ciphertext", () => {
    const encrypted = encryptNarrative("private daily narrative");
    expect(decryptNarrative({ ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag })).toBe("private daily narrative");
  });

  it("creates a stable keyed digest without retaining plaintext", () => {
    expect(narrativeDigest("same")).toBe(narrativeDigest("same"));
    expect(narrativeDigest("same")).not.toContain("same");
  });
});
