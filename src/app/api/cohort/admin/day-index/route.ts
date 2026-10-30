import { NextRequest } from "next/server";
import { z } from "zod";
import { cohortFailure, cohortRequest } from "@/lib/cohort/http";
import { isCohortAdmin } from "@/lib/cohort/server";
import { privateJson } from "@/lib/members/http";
import { prepareDayIndex } from "@/lib/members/prepare-day-index";

const input = z
  .object({
    apply: z.boolean(),
    cursor: z
      .object({ owner: z.uuid(), id: z.uuid(), cutoff: z.iso.datetime() })
      .strict()
      .nullable(),
  })
  .strict();
export async function POST(request: NextRequest) {
  try {
    const { session, input: body } = await cohortRequest(request);
    if (!(await isCohortAdmin(session.user.id)))
      throw new Error("UNAUTHORIZED");
    const parsed = input.safeParse(body);
    if (
      !parsed.success ||
      (parsed.data.cursor &&
        Date.parse(parsed.data.cursor.cutoff) > Date.now() + 5000)
    )
      throw new Error("INVALID_INPUT");
    return privateJson(
      await prepareDayIndex(parsed.data.apply, parsed.data.cursor),
    );
  } catch (error) {
    return cohortFailure(error);
  }
}
