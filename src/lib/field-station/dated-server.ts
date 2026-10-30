import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { DATED_POLICY, DATED_QA_POLICY, datedStageOpen, DATED_BOUNDARY } from "./dated-policy";
import { sharedDayFor } from "./shared-day";

export async function datedAvailability(owner: string, did: string) {
  if (!await sharedDayFor(owner)) return null;
  const enabled = [DATED_QA_POLICY, DATED_POLICY].filter(id => datedStageOpen(id, "ENROLLMENT"));
  if (!enabled.length) return null;
  const db = adminClient();
  if (enabled.includes(DATED_POLICY)) {
    const recorded = await db.rpc("record_dated_field_station_eligibility", { p_owner: owner });
    if (recorded.error) throw new Error("UNAVAILABLE");
  }
  const result = await db.from("cohort_invitations").select("id,policy_id,assigned_house,revoked_at,expires_at")
    .eq("eligible_owner", owner).eq("target_did", did).in("policy_id", enabled).order("created_at");
  if (result.error) throw new Error("UNAVAILABLE");
  const invite = result.data?.find(row => !row.revoked_at && Date.parse(row.expires_at) > Date.now());
  return invite ? { eligible: true as const, policy: invite.policy_id as string, assignedHouse: invite.assigned_house as string | null,
    communityPending: !invite.assigned_house, boundary: DATED_BOUNDARY, startingValues: 700,
    termsVersion: "dated-700-non-performance-v1", qa: invite.policy_id === DATED_QA_POLICY } : { eligible: false as const };
}
