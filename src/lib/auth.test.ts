import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { secureSecretVerifier } from "@/lib/auth";

describe("secureSecretVerifier", () => {
  it("accepts the configured raw secret for local compatibility", () => {
    expect(secureSecretVerifier("ritual-secret", "ritual-secret")).toBe(true);
    expect(secureSecretVerifier("wrong", "ritual-secret")).toBe(false);
  });

  it("accepts a raw secret against a sha256 verifier", () => {
    const digest = createHash("sha256").update("ritual-secret").digest("hex");
    expect(secureSecretVerifier("ritual-secret", `sha256:${digest}`)).toBe(true);
    expect(secureSecretVerifier("wrong", `sha256:${digest}`)).toBe(false);
  });

  it("fails closed for missing values and malformed verifiers", () => {
    expect(secureSecretVerifier("", "sha256:abc")).toBe(false);
    expect(secureSecretVerifier("ritual-secret", "")).toBe(false);
    expect(secureSecretVerifier("ritual-secret", "sha256:not-a-digest")).toBe(false);
  });
});
