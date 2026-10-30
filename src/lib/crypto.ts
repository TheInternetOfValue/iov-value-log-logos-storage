import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function encryptionKey() {
  const encoded = process.env.NARRATIVE_ENCRYPTION_KEY_BASE64;
  if (!encoded) throw new Error("NARRATIVE_ENCRYPTION_KEY_BASE64 is required");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("Narrative encryption key must be 32 bytes");
  return key;
}

export function encryptNarrative(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: Number(process.env.NARRATIVE_KEY_VERSION ?? "1"),
    digest: narrativeDigest(plaintext),
  };
}

export function narrativeDigest(plaintext: string) {
  const secret = process.env.AUDIT_DIGEST_KEY;
  if (!secret || secret.length < 32) throw new Error("AUDIT_DIGEST_KEY must contain at least 32 characters");
  return createHmac("sha256", secret).update(plaintext, "utf8").digest("hex");
}

export function decryptNarrative(input: { ciphertext: string; iv: string; authTag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(input.iv, "base64"));
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
