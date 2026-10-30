import { NextRequest } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { profileSchema } from "@/lib/members/entries";
import { memberFailure, memberWrite, privateJson } from "@/lib/members/http";
export async function POST(request: NextRequest) {
  try {
    const { session, body } = await memberWrite(request);
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) throw new Error("INVALID_INPUT");
    const result = await adminClient().rpc("setup_value_log_member", { p_owner_id: session.user.id, p_name: parsed.data.name, p_timezone: parsed.data.timezone });
    if (result.error || result.data !== true) throw new Error("UNAVAILABLE");
    return privateJson({ saved: true });
  } catch (error) { return memberFailure(error); }
}
