import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

export function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function secureSecretVerifier(supplied: string, configured: string) {
  if (!supplied || !configured) return false;
  if (!configured.startsWith("sha256:")) return secureEqual(supplied, configured);
  const digest = createHash("sha256").update(supplied).digest("hex");
  return secureEqual(`sha256:${digest}`, configured);
}

export function apiError(status: number, code: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: code, details }, { status });
}
