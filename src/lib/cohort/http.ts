import "server-only";
import { NextRequest } from "next/server";
import { nativeSession, nativeJson } from "@/lib/native-log/server";
import { valueLogOrigin } from "@/lib/app-origin";
import { privateJson } from "@/lib/members/http";
export async function cohortRequest(request: NextRequest) {
  if (
    request.headers.get("origin") !== valueLogOrigin() ||
    !request.headers.get("content-type")?.startsWith("application/json") ||
    ["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "")
  )
    throw new Error("ORIGIN_REQUIRED");
  return {
    session: await nativeSession(request),
    input: await nativeJson(request),
  };
}
export function cohortFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "UNAVAILABLE";
  const messages: Record<string, string> = {
    UNAUTHORIZED: "This action is not available in this account.",
    ORIGIN_REQUIRED: "Open Value Log and try again.",
    ACCOUNT_CHANGED:
      "Return to the original signed-in account before continuing.",
    INVALID_INPUT: "Check the information and try again.",
    REVISION_CONFLICT:
      "This record changed. Reload it before continuing; your writing is still here.",
    INVITATION_UNAVAILABLE:
      "This invitation is unavailable, expired or belongs to another account.",
    COHORT_FULL:
      "The first ten pilot places are filled. Your private Value Log remains available.",
    CONSENT_REQUIRED:
      "Confirm the starting assumptions and review permissions before joining.",
    HOUSE_ASSIGNMENT_REQUIRED: "That community is not assigned to this account. You can continue your private Value Log while Moses checks it.",
    POLICY_ALREADY_ACCEPTED: "Your existing policy is preserved. Moses needs to review any change before a new policy can be accepted.",
    RATE_LIMITED:
      "Too many requests. Your saved work is safe; try again shortly.",
    MEMBERSHIP_REQUIRED:
      "Rejoining this pilot needs a new community invitation from Moses.",
    WRITING_PAUSED:
      "This part of the pilot is temporarily paused. Your saved records remain available.",
  };
  return privateJson(
    {
      error:
        messages[code] ??
        "Value Log could not finish. Your writing is still here; try again.",
      code: messages[code] ? code : "UNAVAILABLE",
    },
    code === "RATE_LIMITED"
      ? 429
      : code === "UNAUTHORIZED"
        ? 403
        : ["ORIGIN_REQUIRED", "ACCOUNT_CHANGED"].includes(code)
          ? 403
          : code === "INVALID_INPUT" || code === "CONSENT_REQUIRED"
            ? 400
            : [
                  "REVISION_CONFLICT",
                  "COHORT_FULL",
                  "INVITATION_UNAVAILABLE",
                  "HOUSE_ASSIGNMENT_REQUIRED",
                  "POLICY_ALREADY_ACCEPTED",
                ].includes(code)
              ? 409
              : 503,
  );
}
