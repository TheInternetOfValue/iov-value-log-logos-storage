import { createHash } from "node:crypto";
import { apiError, secureEqual } from "@/lib/auth";
import { adminClient } from "@/lib/supabase/admin";

export async function requireGptOwner(request: Request) {
  const expected = process.env.GPT_INGESTION_API_KEY;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !secureEqual(supplied, expected)) return { error: apiError(401, "invalid_api_key") } as const;
  const configuredEmail = (process.env.MOSES_EMAIL_ALLOWLIST ?? "").split(",")[0]?.trim().toLowerCase();
  if (!configuredEmail) return { error: apiError(503, "owner_not_configured") } as const;
  const db = adminClient();
  const { data: owner } = await db.from("members").select("id").ilike("email", configuredEmail).maybeSingle();
  if (!owner) return { error: apiError(503, "owner_not_initialized") } as const;
  return { db, ownerId: owner.id } as const;
}

export function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
