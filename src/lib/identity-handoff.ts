import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalMemberDid } from "@/lib/members/admission";

export type IdentityHandoff = {
  version: 1; audience: "iov-value-log"; did: string; returnTo: string;
  state: string; codeChallenge: string; issuedAt: number; expiresAt: number; nonce: string;
};
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const token = /^[A-Za-z0-9_-]{20,200}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function codeChallenge(verifier: string) { return digest(verifier); }
export function codeHash(code: string) { return digest(code); }
export function verifyIdentityHandoff(code: string): IdentityHandoff | null {
  const secret = process.env.WORD_WALLET_PROJECTION_SECRET;
  if (!secret || code.length > 6000) return null;
  const [encoded, signature, extra] = code.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(encoded).digest("base64url"));
  const supplied = Buffer.from(signature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as IdentityHandoff;
    if (p.version !== 1 || p.audience !== "iov-value-log" || typeof p.did !== "string" || !canonicalMemberDid.test(p.did)
      || typeof p.returnTo !== "string" || typeof p.state !== "string" || !token.test(p.state)
      || typeof p.codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(p.codeChallenge)
      || typeof p.nonce !== "string" || !uuid.test(p.nonce)) return null;
    const now = Date.now();
    if (!Number.isInteger(p.issuedAt) || !Number.isInteger(p.expiresAt) || p.issuedAt > now + 30_000
      || p.expiresAt <= now || p.expiresAt <= p.issuedAt || p.expiresAt - p.issuedAt > 5 * 60_000) return null;
    return p;
  } catch { return null; }
}
export function handoffCookie(value: { verifier: string; state: string; expectedOwner: string | null; cohortInvite?: string }) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function readHandoffCookie(value: string | undefined) {
  if (!value || value.length > 1200) return null;
  try {
    const p = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof p.verifier === "string" && /^[A-Za-z0-9_-]{43}$/.test(p.verifier)
      && typeof p.state === "string" && token.test(p.state)
      && (p.expectedOwner === null || typeof p.expectedOwner === "string" && uuid.test(p.expectedOwner))
      && (p.cohortInvite === undefined || typeof p.cohortInvite === "string" && /^[A-Za-z0-9_-]{32,100}$/.test(p.cohortInvite))
      ? p as { verifier: string; state: string; expectedOwner: string | null; cohortInvite?: string } : null;
  } catch { return null; }
}
