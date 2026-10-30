import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { MOSES_CANONICAL_DID, MOSES_PUBLIC_PROFILE_SLUG } from "@/lib/identity";
import { verifyProjectionSignature } from "@/lib/pilot-w-projection";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(request.url), grantId = url.searchParams.get("grant_id") ?? "", window = url.searchParams.get("window");
  const timestamp = request.headers.get("x-iov-timestamp")?.trim() ?? "", signature = request.headers.get("x-iov-signature")?.trim() ?? "";
  const secret = process.env.WORD_WALLET_PROJECTION_SECRET;
  const signedPath = `${url.pathname}${url.search}`;
  if (!secret || !timestamp || Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60_000 || !verifyProjectionSignature(secret, timestamp, `GET:${signedPath}`, signature)) {
    return NextResponse.json({ error: "unavailable" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (slug !== MOSES_PUBLIC_PROFILE_SLUG || window !== "30d" || !/^[0-9a-f-]{36}$/.test(grantId)) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  const db = adminClient();
  const { data: binding } = await db.from("member_identity_bindings").select("owner_id").eq("did", MOSES_CANONICAL_DID).maybeSingle();
  if (!binding) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  const { data: state } = await db.from("current_founder_wellbeing_state").select("replay_run_id").eq("owner_id", binding.owner_id).eq("mode", "founder_v0_1_live").maybeSingle();
  if (!state) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const { data: revisions } = await db.from("founder_wellbeing_state_revisions").select("effective_at,w_after").eq("replay_run_id", state.replay_run_id).gte("effective_at", cutoff).order("effective_at", { ascending: true }).limit(5000);
  const points = new Map<string, { date: string; wellbeing_score: number; movement: number | null; calculation_time: string }>();
  let previous: number | null = null;
  for (const revision of revisions ?? []) {
    const score = Number(revision.w_after), calculationTime = new Date(revision.effective_at).toISOString(), date = calculationTime.slice(0, 10);
    points.set(date, { date, wellbeing_score: score, movement: previous === null ? null : score - previous, calculation_time: calculationTime });
    previous = score;
  }
  return NextResponse.json({ public_profile_slug: slug, window: "30d", calculation_version: "founder-wellbeing-v0.1.1-fixed12", points: [...points.values()] }, { status: 200, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" } });
}
