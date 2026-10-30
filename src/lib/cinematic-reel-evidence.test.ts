import { describe, expect, it } from "vitest";
import { reelEvidenceEligibility } from "@/lib/cinematic-reel-evidence";

describe("cinematic reel evidence eligibility", () => {
  it.each(["validation_pending", "validated", "calculated"])(
    "treats owner-approved completed %s activity as reel evidence",
    (status) => expect(reelEvidenceEligibility(status)).toMatchObject({
      observer_confirmed: true,
      reel_eligible: true,
    }),
  );

  it.each(["drafted", "observer_rejected", "validation_rejected", "superseded", "reversed"])(
    "excludes %s activity",
    (status) => expect(reelEvidenceEligibility(status)).toMatchObject({
      observer_confirmed: false,
      reel_eligible: false,
    }),
  );
});
