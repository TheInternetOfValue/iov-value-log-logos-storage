import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const canonicalMemberDid = /^did:iov:member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const memberAdmissionsOpen = () => process.env.VALUE_LOG_MEMBER_ADMISSION === "open";
export const memberWritingOpen = () => process.env.VALUE_LOG_MEMBER_WRITING === "open";
export function memberAuthLocator(did: string) {
  if (!canonicalMemberDid.test(did)) throw new Error("INVALID_IDENTITY");
  const secret = process.env.WORD_WALLET_PROJECTION_SECRET;
  if (!secret) throw new Error("MEMBERSHIP_UNAVAILABLE");
  const opaque = createHmac("sha256", secret).update(`value-log-auth-locator:${did}`).digest("hex");
  return `identity-${opaque}@members.valuelog.invalid`;
}

/** Resolve a verified DID first. Never merge by email/name or rewrite a binding. */
export async function resolveIdentityMember(db: SupabaseClient, did: string, expectedOwner?: string) {
  if (!canonicalMemberDid.test(did)) throw new Error("INVALID_IDENTITY");
  const existing = await db.from("member_identity_bindings").select("owner_id").eq("did", did).maybeSingle();
  if (existing.error) throw new Error("MEMBERSHIP_UNAVAILABLE");
  if (existing.data) {
    const member = await db.from("members").select("email").eq("id", existing.data.owner_id).single();
    if (member.error || !member.data?.email) throw new Error("MEMBERSHIP_UNAVAILABLE");
    return { ownerId: existing.data.owner_id as string, email: member.data.email as string };
  }
  if (expectedOwner) throw new Error("ACCOUNT_MISMATCH");
  if (!memberAdmissionsOpen()) throw new Error("ADMISSION_PAUSED");
  const email = memberAuthLocator(did);
  const candidate = async () => {
    const result = await db.rpc("value_log_identity_candidate", { p_did: did, p_email: email });
    if (result.error) throw new Error("MEMBERSHIP_UNAVAILABLE");
    return result.data?.[0] as { owner_id: string; email: string } | undefined;
  };
  let user = await candidate();
  if (!user) {
    const created = await db.auth.admin.createUser({ email, email_confirm: true,
      app_metadata: { identity_issuer: "word-wallet-web", identity_did: did } });
    if (!created.error && created.data.user) user = { owner_id: created.data.user.id, email };
    else user = await candidate(); // A concurrent request or interrupted bootstrap may already have created it.
  }
  if (!user) throw new Error("MEMBERSHIP_UNAVAILABLE");
  const admitted = await db.rpc("admit_value_log_member", { p_owner_id: user.owner_id, p_did: did, p_email: email });
  if (admitted.error || admitted.data !== user.owner_id) throw new Error("MEMBERSHIP_UNAVAILABLE");
  return { ownerId: user.owner_id, email };
}
