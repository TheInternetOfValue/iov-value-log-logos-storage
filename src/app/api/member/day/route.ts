import { NextRequest } from "next/server";
import { memberSession } from "@/lib/members/session";
import {
  checkMemberBinding,
  privateJson,
  memberFailure,
} from "@/lib/members/http";
import { memberDayProjection } from "@/lib/members/day-server";
import { dateSchema } from "@/lib/members/entries";
import { sharedDayFor } from "@/lib/field-station/shared-day";
import { founderDayProjection } from "@/lib/members/founder-day-server";
export async function GET(request: NextRequest) {
  try {
    const session = await memberSession();
    checkMemberBinding(request, session.user.id);
    const date = dateSchema.safeParse(request.nextUrl.searchParams.get("date"));
    if (!date.success) throw new Error("INVALID_INPUT");
    if (!(await sharedDayFor(session.user.id, session.kind)))
      throw new Error("WRITING_PAUSED");
    if (session.kind === "pilot")
      return privateJson(
        await founderDayProjection(session.client, session.user.id, date.data),
      );
    const projection = await memberDayProjection(
      session.client,
      session.user.id,
      date.data,
    );
    const { cohort: _cohort, ...day } = projection;
    void _cohort;
    return privateJson(day);
  } catch (error) {
    return memberFailure(error);
  }
}
