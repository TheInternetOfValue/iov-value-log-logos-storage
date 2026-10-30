import { describe, expect, it } from "vitest";
import { ownerReplayProjection, replayInput } from "./identity-replay-projection";

describe("identity replay projection", () => {
  it("uses the immutable canonical DID and no private facet values", () => {
    const projection = ownerReplayProjection();
    expect(projection.identityDid).toBe("did:iov:member:10000000-0000-4000-8000-000000000001");
    expect(JSON.stringify(projection)).not.toMatch(/canonicalSliceId|activityLabel|preW|postW|performanceRoute/);
    expect(projection.nodes).toHaveLength(8);
  });
  it("maps a transition without turning credits into Pilot W", () => {
    const input = replayInput({ id: "e", kind: "wellbeing", canonical_slice_id: "slice", settles_at: "2026-07-18T12:00:00Z", begins_at: "2026-07-18T11:00:00Z", timezone: "Asia/Kolkata", activity: "private", wellbeing_node: "~~IdentityState", pre_w: 800, applied_w: .2, post_w: 800.2, resulting_w: 800.2, performance: { community: "iov", credits: 42 } });
    expect(input.appliedPilotW).toBe(.2);
    expect(input.performanceRoute).toEqual({ destination: "iov", credits: 42 });
  });
});
