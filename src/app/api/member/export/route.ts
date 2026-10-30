import { NextRequest } from "next/server";
import { z } from "zod";
import { memberExportPage } from "@/lib/members/export-pages";
import { checkMemberBinding, memberFailure, personalSession, privateJson } from "@/lib/members/http";
export async function GET(request: NextRequest) {
  try {
    const session = await personalSession(); checkMemberBinding(request, session.user.id);
    const input = z.object({ stage: z.enum(["activities","audit"]), cutoff: z.iso.datetime(), cursor: z.uuid().optional() }).safeParse({
      stage: request.nextUrl.searchParams.get("stage") || "activities", cutoff: request.nextUrl.searchParams.get("cutoff") || new Date().toISOString(),
      ...(request.nextUrl.searchParams.has("cursor") ? { cursor: request.nextUrl.searchParams.get("cursor") } : {}),
    });
    if (!input.success || Date.parse(input.data.cutoff) > Date.now() + 1000) throw new Error("INVALID_INPUT");
    const page = await memberExportPage(session, input.data.stage, input.data.cutoff, input.data.cursor);
    return privateJson({ ...page, cutoff: input.data.cutoff, metadata: {
      schema: "value-log-private-activities-v1", exportedAt: input.data.cutoff,
      member: { name: session.name, timezone: session.timezone, did: session.did }, assessment: "unassessed",
    } });
  } catch (error) { return memberFailure(error); }
}
