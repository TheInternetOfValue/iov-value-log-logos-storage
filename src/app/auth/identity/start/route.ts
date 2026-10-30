import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { codeChallenge, handoffCookie } from "@/lib/identity-handoff";
import { valueLogOrigin } from "@/lib/app-origin";
import { serverClient } from "@/lib/supabase/server";
import { wellbeingIdentityBase } from "@/lib/identity";

const cookieName = "iov_identity_handoff";

export async function GET(request: NextRequest) {
  const client = await serverClient();
  const { data: { user } } = await client.auth.getUser();
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const returnTo = new URL("/auth/identity/callback", valueLogOrigin());
  const authorize = new URL("/v1/auth/value-log/authorize", wellbeingIdentityBase());
  authorize.searchParams.set("return_to", returnTo.toString());
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", codeChallenge(verifier));
  if (request.nextUrl.searchParams.get("provider") === "google") authorize.searchParams.set("provider", "google");
  const response = NextResponse.redirect(authorize);
  const invite=request.nextUrl.searchParams.get("invite");
  response.cookies.set(cookieName, handoffCookie({ verifier, state, expectedOwner: user?.id ?? null, ...invite&&/^[A-Za-z0-9_-]{32,100}$/.test(invite)?{cohortInvite:invite}:{} }), { httpOnly: true, sameSite: "lax", secure: valueLogOrigin().startsWith("https:"), path: "/auth/identity", maxAge: 5 * 60 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
