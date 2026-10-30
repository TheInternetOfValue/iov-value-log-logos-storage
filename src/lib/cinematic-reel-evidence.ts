const reelEligibleStatuses = new Set(["validation_pending", "validated", "calculated"]);

export function reelEvidenceEligibility(status: string) {
  const eligible = reelEligibleStatuses.has(status);
  return {
    observer_confirmed: eligible,
    reel_eligible: eligible,
    reel_eligibility_reason: eligible
      ? "Owner-approved completed activity; protocol validation or calculation may still be pending."
      : "Not eligible evidence for a cinematic reel.",
  };
}
