import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { serverClient } from "@/lib/supabase/server";
import { valueLogOrigin } from "@/lib/app-origin";
import { publicEnv } from "@/lib/env";
import { resolveIdentityMember } from "@/lib/members/admission";
import { codeChallenge, codeHash, readHandoffCookie, verifyIdentityHandoff } from "@/lib/identity-handoff";

const cookieName = "iov_identity_handoff";
function finish(request: NextRequest, destination: string) {
  const response = NextResponse.redirect(new URL(destination, valueLogOrigin()));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(cookieName, "", { httpOnly: true, sameSite: "lax", secure: valueLogOrigin().startsWith("https:"), path: "/auth/identity", maxAge: 0 });
  return response;
}
const fail = (r: NextRequest, reason: string) => {const invite=readHandoffCookie(r.cookies.get(cookieName)?.value)?.cohortInvite;return finish(r, `/login?identity=${encodeURIComponent(reason)}${invite?`&invite=${encodeURIComponent(invite)}`:""}`);};
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code"), state = request.nextUrl.searchParams.get("state");
  const pending = readHandoffCookie(request.cookies.get(cookieName)?.value);
  const handoff = code ? verifyIdentityHandoff(code) : null;
  if (!code || !state || !pending || !handoff || state !== pending.state || handoff.state !== pending.state
    || handoff.returnTo !== valueLogOrigin() + request.nextUrl.pathname
    || handoff.codeChallenge !== codeChallenge(pending.verifier)) return fail(request, "invalid-or-expired");
  try {
    const current = await serverClient();
    const { data: { user: currentUser } } = await current.auth.getUser();
    if ((currentUser?.id ?? null) !== pending.expectedOwner) return fail(request, "account-changed");
    const db = adminClient();
    // Consume before any admission/session work. A failed attempt needs a fresh handoff.
    const consumed = await db.from("identity_handoff_redemptions").insert({ code_hash: codeHash(code), did: handoff.did, expires_at: new Date(handoff.expiresAt).toISOString() });
    if (consumed.error) return fail(request, "already-used");
    const member = await resolveIdentityMember(db, handoff.did, currentUser?.id);
    if (currentUser && currentUser.id !== member.ownerId) return fail(request, "account-mismatch");
    const { data: generated, error: generatedError } = await db.auth.admin.generateLink({ type: "magiclink", email: member.email });
    if (generatedError || !generated?.properties.hashed_token || generated.user?.id !== member.ownerId) return fail(request, "session-unavailable");
    // An explicit destination query stops the hosting redirect from carrying
    // the incoming one-use code and state into the private page URL.
    const response = finish(request, pending.cohortInvite ? `/onboarding/field-station?invite=${encodeURIComponent(pending.cohortInvite)}&identity=connected` : "/day?identity=connected");
    const env = publicEnv();
    const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: { getAll: () => request.cookies.getAll(), setAll: items => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) },
    });
    const verified = await supabase.auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: generated.properties.verification_type as EmailOtpType });
    if (verified.error || verified.data.user?.id !== member.ownerId) return fail(request, "session-unavailable");
    await db.from("audit_events").insert({ owner_id: member.ownerId, actor_id: member.ownerId, actor_type: "observer", event_type: "wellbeing_identity_sign_in", entity_type: "identity_handoff", entity_id: codeHash(code), metadata: {} });
    let minimal = process.env.VALUE_LOG_SHARED_DAY === "open";
    if (process.env.VALUE_LOG_SHARED_DAY === "qa") {
      const qa = await db.rpc("bind_qa_member", { p_owner: member.ownerId });
      if (qa.error) console.warn("value_log_qa_binding_unavailable", { count: 1 });
      minimal = qa.data === true;
    }
    if (minimal) {
      const setup = await db.rpc("complete_minimal_member_setup", { p_owner: member.ownerId });
      if (setup.error) console.warn("value_log_minimal_setup_unavailable", { count: 1 });
    }
    return response;
  } catch (error) {
    return fail(request, error instanceof Error && error.message === "ADMISSION_PAUSED" ? "admission-paused" : error instanceof Error && error.message === "ACCOUNT_MISMATCH" ? "account-mismatch" : "session-unavailable");
  }
}
