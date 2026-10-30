import { parseCanonicalMemberDid, type IdentityStateReplayInput, type ReplayIdentityProjection, WELLBEING_IDENTITY_NODES } from "@theinternetofvalue/wellbeing-identity-contracts";
import { MOSES_CANONICAL_DID } from "@/lib/identity";
import type { IdentityReplayTransition } from "@/lib/identity-replay";

const labels: Record<(typeof WELLBEING_IDENTITY_NODES)[number], string> = {
  "~~GivenIdentity": "Given identity", "~~EarnedIdentity": "Earned identity", "~~RentedIdentity": "Rented identity", "~~Skills": "Skills", "~~MoralCompass": "Moral compass", "~~Story": "Story", "~~IdentityState": "Identity state", "~~ConsentAndDisclosure": "Consent and disclosure",
};

export function ownerReplayProjection(): ReplayIdentityProjection {
  return { identityDid: parseCanonicalMemberDid(MOSES_CANONICAL_DID), protocolVersion: "0.6.0", projectionSchemaVersion: "wellbeing-identity-projection-v1", disclosureVersion: "owner-replay-v1", purpose: "owner-authorised-replay", audience: "identity-owner", displayName: "Moses Sam Paul Johnraj", nodes: WELLBEING_IDENTITY_NODES.map((path) => ({ path, label: labels[path], visible: true })) };
}

export function replayInput(transition: IdentityReplayTransition): IdentityStateReplayInput {
  if (transition.kind !== "wellbeing" || transition.pre_w === null || transition.post_w === null || transition.applied_w === null) throw new Error("WELLBEING_REPLAY_INPUT_REQUIRED");
  return { identityDid: parseCanonicalMemberDid(MOSES_CANONICAL_DID), canonicalSliceId: transition.canonical_slice_id, settledAt: transition.settles_at, prePilotW: transition.pre_w, appliedPilotW: transition.applied_w, postPilotW: transition.post_w, node: "~~IdentityState", calculatorVersion: "wim-legacy-v1", reversed: false, ...(transition.performance ? { performanceRoute: { destination: transition.performance.community, credits: transition.performance.credits } } : {}) };
}
