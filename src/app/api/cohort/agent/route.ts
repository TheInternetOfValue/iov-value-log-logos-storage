import { NextRequest } from "next/server";
import { z } from "zod";
import { memberSession } from "@/lib/members/session";
import { adminClient } from "@/lib/supabase/admin";
import { privateJson } from "@/lib/members/http";
import { cohortRequest, cohortFailure } from "@/lib/cohort/http";
import { cohortCommand, isCohortAdmin } from "@/lib/cohort/server";
const command = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("accept_operator"), consent: z.literal(true) })
    .strict(),
  z.object({ action: z.literal("agent_pause"), active: z.boolean() }).strict(),
]);
async function scope(owner: string) {
  const db = adminClient(),
    [agent, binding] = await Promise.all([
      db
        .from("cohort_agents")
        .select("operator_label,operator_did,active,accepted_at,version")
        .eq("id", "system:field-station-reviewer:v1")
        .single(),
      db
        .from("member_identity_bindings")
        .select("did")
        .eq("owner_id", owner)
        .single(),
    ]);
  if (
    agent.error ||
    binding.error ||
    (agent.data.operator_did !== binding.data.did &&
      !(await isCohortAdmin(owner)))
  )
    throw new Error("UNAUTHORIZED");
  return agent.data;
}
export async function GET() {
  try {
    const session = await memberSession(),
      agent = await scope(session.user.id);
    return privateJson({ agent });
  } catch (error) {
    return cohortFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { session, input } = await cohortRequest(request);
    await scope(session.user.id);
    const c = command.safeParse(input);
    if (!c.success) throw new Error("INVALID_INPUT");
    await cohortCommand(session.user.id, c.data.action, c.data);
    return privateJson({ saved: true });
  } catch (error) {
    return cohortFailure(error);
  }
}
