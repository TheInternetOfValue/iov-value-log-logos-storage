import { NextResponse } from "next/server";
import { apiError } from "@/lib/auth";
import { payloadHash, requireGptOwner } from "@/lib/gpt-api";
import { expectedWeeklyPlanDates, weeklyReviewInputSchema } from "@/lib/weekly-review";
import { latestWeeklyReviewPacket } from "@/lib/weekly-review-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireGptOwner(request);
  if ("error" in access) return access.error;
  try {
    const packet = await latestWeeklyReviewPacket(access.ownerId);
    return NextResponse.json({ ok: true, packet }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(500, "weekly_review_read_failed", error instanceof Error ? error.message : undefined);
  }
}

export async function POST(request: Request) {
  const access = await requireGptOwner(request);
  if ("error" in access) return access.error;
  const parsed = weeklyReviewInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(422, "validation_failed", parsed.error.flatten());
  const { data: packet, error: packetError } = await access.db.from("weekly_review_packets").select("id,week_end").eq("id", parsed.data.packet_id).eq("owner_id", access.ownerId).maybeSingle();
  if (packetError) return apiError(500, "packet_read_failed");
  if (!packet) return apiError(404, "packet_not_found");
  const actualDates = parsed.data.monday_friday_plan.map((day) => day.date);
  if (actualDates.join("|") !== expectedWeeklyPlanDates(packet.week_end).join("|")) return apiError(422, "invalid_plan_dates");
  const { data, error } = await access.db.rpc("save_weekly_review", {
    p_owner_id: access.ownerId,
    p_payload: parsed.data,
    p_payload_hash: payloadHash(parsed.data),
  });
  if (error) return apiError(error.message.includes("conflict") || error.message.includes("superseded") ? 409 : 422, error.message);
  return NextResponse.json({ ok: true, weekly_review_id: data }, { status: 201, headers: { "cache-control": "no-store" } });
}
