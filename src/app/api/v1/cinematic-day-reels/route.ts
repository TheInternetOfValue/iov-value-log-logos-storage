import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/auth";
import { requireGptOwner, payloadHash } from "@/lib/gpt-api";
import { cinematicDayReelInputSchema, cinematicReelTemporalError } from "@/lib/operating-protocol";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireGptOwner(request);
  if ("error" in access) return access.error;
  const body = await request.json().catch(() => null);
  const parsed = cinematicDayReelInputSchema.safeParse(body);
  if (!parsed.success) return apiError(422, "validation_failed", parsed.error.flatten());
  const temporalError = cinematicReelTemporalError(parsed.data);
  if (temporalError) return apiError(422, temporalError);
  const { data, error } = await access.db.rpc("save_cinematic_day_reel", {
    p_owner_id: access.ownerId,
    p_payload: parsed.data,
    p_payload_hash: payloadHash(parsed.data),
  });
  if (error) return apiError(error.message.includes("conflict") ? 409 : 422, error.message);
  return NextResponse.json({ ok: true, cinematic_day_reel_id: data }, { status: 201 });
}
