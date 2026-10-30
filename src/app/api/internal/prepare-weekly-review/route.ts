import { NextResponse } from "next/server";
import { secureSecretVerifier } from "@/lib/auth";
import { prepareWeeklyReviewPacket } from "@/lib/weekly-review-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.WEEKLY_REVIEW_CRON_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secureSecretVerifier(supplied, expected)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const trigger = request.headers.get("x-iov-review-trigger") === "manual" ? "manual" : "scheduled";
  try {
    const result = await prepareWeeklyReviewPacket(new Date(), trigger);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "weekly_review_preparation_failed";
    const status = code === "review_window_not_closed" ? 409 : code.includes("configured") || code.includes("initialized") ? 503 : 500;
    const publicCode = status === 500 ? "weekly_review_preparation_failed" : code;
    return NextResponse.json({ ok: false, error: publicCode }, { status });
  }
}
