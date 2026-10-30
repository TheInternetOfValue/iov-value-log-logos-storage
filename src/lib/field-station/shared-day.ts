// Trusted server/worker capabilities; never derive permissions from a client flag.
import { adminClient } from "@/lib/supabase/admin-core";
import { DATED_QA_POLICY } from "./ids";

const memberDid = /^did:iov:member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * Staged rollout for real participants. While VALUE_LOG_SHARED_DAY=qa, these
 * verified DIDs receive the shared day alongside the QA accounts; `closed`
 * still stops everyone and `open` admits every member. Malformed entries are
 * ignored. Scoring enrollment stays separate and invitation-bound.
 */
export function rolloutDids() {
  return new Set((process.env.VALUE_LOG_ROLLOUT_DIDS ?? "").split(",").map(value => value.trim()).filter(value => memberDid.test(value)));
}
export async function sharedDayFor(owner: string, kind: "pilot" | "personal" = "personal") {
  if (process.env.VALUE_LOG_SHARED_DAY === "open") return true;
  if (process.env.VALUE_LOG_SHARED_DAY !== "qa" || kind !== "personal") return false;
  const listed = rolloutDids();
  if (listed.size) {
    const binding = await adminClient().from("member_identity_bindings").select("did").eq("owner_id", owner).maybeSingle();
    if (binding.error) throw new Error("UNAVAILABLE");
    if (binding.data && listed.has(String(binding.data.did))) return true;
  }
  const accepted = await adminClient().from("cohort_enrollments").select("owner_id").eq("owner_id", owner).eq("policy_id", DATED_QA_POLICY).maybeSingle();
  if (accepted.error) throw new Error("UNAVAILABLE"); if (accepted.data) return true;
  const result = await adminClient().from("cohort_invitations").select("id").eq("eligible_owner", owner).eq("policy_id", DATED_QA_POLICY).is("revoked_at", null).gt("expires_at", new Date().toISOString()).limit(1);
  if (result.error) throw new Error("UNAVAILABLE");
  return Boolean(result.data?.length);
}
export async function deviceRecoveryFor(owner: string, kind: "pilot" | "personal") {
  return process.env.VALUE_LOG_DEVICE_RECOVERY === "open" || process.env.VALUE_LOG_DEVICE_RECOVERY === "qa" && await sharedDayFor(owner, kind);
}
