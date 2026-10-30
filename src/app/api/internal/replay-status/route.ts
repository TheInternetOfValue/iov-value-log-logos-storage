import { NextResponse } from "next/server";
import { requireMoses } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { client } = await requireMoses();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing replay id" }, { status: 400 });
  const { data } = await client.from("replay_runs").select("id,status,started_at,completed_at,from_timestamp,failure_message,affected_count,heartbeat_at").eq("id", id).single();
  if (!data) return NextResponse.json({ error: "Replay not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}
