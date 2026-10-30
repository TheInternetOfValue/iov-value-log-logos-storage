export const MOSES_CANONICAL_DID = "did:iov:member:10000000-0000-4000-8000-000000000001";
export const MOSES_PUBLIC_PROFILE_SLUG = "moses-sam-paul-johnraj";
export const PILOT_W_CONSENT_SCOPE = "public-profile:pilot-w";
export const PILOT_W_METHOD_VERSION = "wim-legacy-v1";
export const PILOT_W_LIMITATIONS = [
  "Experimental projection; not the canonical composite WellbeingScore.",
  "Duration is excluded from Non-Performance movement magnitude.",
  "Moses currently acts in multiple validator roles; this is not independent external review.",
] as const;

export function wordWalletApiBase() {
  return (process.env.WORD_WALLET_API_URL || "https://wordwallet.theinternetofvalue.org").replace(/\/+$/, "");
}

/** The member-facing Identity home. Value Log never receives an email or profile from it. */
export function wellbeingIdentityBase() {
  return "https://identity.theinternetofvalue.org";
}

export function publicIdentityUrl() {
  return `https://theinternetofvalue.org/wellbeing-identity/people/${MOSES_PUBLIC_PROFILE_SLUG}`;
}

/** The owner-controlled identity home; Value Log never owns disclosure policy. */
export function wellbeingIdentityHomeUrl() {
  return "https://identity.theinternetofvalue.org/me";
}
