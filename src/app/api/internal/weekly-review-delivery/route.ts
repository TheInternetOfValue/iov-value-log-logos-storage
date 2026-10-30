import { NextResponse } from "next/server";
import { z } from "zod";
import { secureSecretVerifier } from "@/lib/auth";
import { recordWeeklyReviewReminder } from "@/lib/weekly-review-server";

export const runtime = "nodejs";

const bodySchema = z.object({
  packet_id: z.string().uuid(),
  delivery: z.enum(["sent", "failed"]),
  trigger: z.enum(["scheduled", "manual"]),
}).strict();

export async function POST(request: Request) {
  const expected = process.env.WEEKLY_REVIEW_CRON_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secureSecretVerifier(supplied, expected)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "validation_failed" }, { status: 422 });
  try {
    return NextResponse.json(await recordWeeklyReviewReminder(parsed.data.packet_id, parsed.data.delivery, parsed.data.trigger));
  } catch {
    return NextResponse.json({ ok: false, error: "audit_failed" }, { status: 500 });
  }
}
