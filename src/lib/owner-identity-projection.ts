import "server-only";

import { buildProjectionSignature } from "@/lib/pilot-w-projection";
import { MOSES_CANONICAL_DID, wordWalletApiBase } from "@/lib/identity";
import type { OwnerWellbeingIdentityProjection } from "@theinternetofvalue/wellbeing-identity-contracts";

/**
 * Fetches an owner-authorised projection only on the Value Log server. The
 * browser receives the projection as rendered page data; it never receives a
 * Wallet credential or talks to Word Wallet directly.
 */
export async function ownerIdentityProjection(): Promise<OwnerWellbeingIdentityProjection | null> {
  // The private owner route may have a different key from live-card
  // publication. Reuse Word Wallet's existing credential name, retaining
  // the legacy shared-key setup only when no owner credential is configured.
  const ownerSecret = process.env.OWNER_IDENTITY_PROJECTION_SECRET?.trim();
  const secret = ownerSecret || process.env.WORD_WALLET_PROJECTION_SECRET?.trim();
  const credential = ownerSecret ? "owner" : "legacy";
  if (!secret) {
    console.warn("owner_identity_projection_unavailable", { reason: "configuration" });
    return null;
  }
  const timestamp = new Date().toISOString();
  const path = `/v1/internal/owner-wellbeing-identities/${encodeURIComponent(MOSES_CANONICAL_DID)}`;
  try {
    const response = await fetch(`${wordWalletApiBase()}${path}`, {
      headers: {
        "x-iov-timestamp": timestamp,
        "x-iov-signature": buildProjectionSignature(secret, timestamp, `GET:${path}`),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn("owner_identity_projection_unavailable", { reason: "http", status: response.status, credential });
      return null;
    }
    const projection = await response.json() as OwnerWellbeingIdentityProjection;
    if (String(projection?.identityDid) === MOSES_CANONICAL_DID && projection.audience === "identity-owner" && projection.purpose === "owner-private-profile") return projection;
    console.warn("owner_identity_projection_unavailable", { reason: "projection" });
    return null;
  } catch (error) {
    // Exceptions may embed request URLs, signatures or source content. Emit
    // only a bounded transport classification, never the exception or body.
    const code = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? error.cause.code : null;
    const transport = typeof code === "string" && ["ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code) ? code : "unknown";
    const reason = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "timeout" : "request";
    console.warn("owner_identity_projection_unavailable", { reason, transport });
    return null;
  }
}
