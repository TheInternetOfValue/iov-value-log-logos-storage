import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { memberSession } from "@/lib/members/session";
import { checkMemberBinding, privateJson } from "@/lib/members/http";
import { cohortRequest, cohortFailure } from "@/lib/cohort/http";
import {
  cohortCommand,
  cohortEnrollmentOpen,
  cohortSnapshot,
  inviteHash,
  readInvitation,
  loadCohort,
} from "@/lib/cohort/server";
import { salarySchema, salaryRate } from "@/lib/cohort/policy";
import { encryptNarrative } from "@/lib/crypto";
import { datedAvailability } from "@/lib/field-station/dated-server";
import { DATED_POLICY, DATED_QA_POLICY, datedStageOpen, isDatedPolicy } from "@/lib/field-station/dated-policy";
import { adminClient } from "@/lib/supabase/admin";
const enrollment = z
  .object({
    action: z.literal("enroll"),
    token: z.string().regex(/^[A-Za-z0-9_-]{32,100}$/),
    house: z.string().min(2).max(64),
    communities: z.array(z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/)).max(20),
    consent: z.literal(true),
    startingValuesConfirmed: z.literal(true),
    salary: salarySchema.nullable(),
  })
  .strict();
const commands = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll_dated"), policy: z.enum([DATED_POLICY, DATED_QA_POLICY]), house: z.enum(["house_of_bros", "house_of_sis"]), consent: z.literal(true), startingValuesConfirmed: z.literal(true), termsVersion: z.literal("dated-700-non-performance-v1") }).strict(),
  enrollment,
  z.object({ action: z.literal("consent"), consent: z.boolean() }).strict(),
  z.object({ action: z.literal("rate"), salary: salarySchema }).strict(),
  z
    .object({
      action: z.literal("accept_memberships"),
      token: z.string().regex(/^[A-Za-z0-9_-]{32,100}$/),
      communities: z
        .array(z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/))
        .min(1)
        .max(20),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("leave_membership"),
      community: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("request_community"),
      name: z.string().trim().min(1).max(120),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);
export async function GET(request: NextRequest) {
  try {
    const session = await memberSession();
    checkMemberBinding(request,session.user.id);
    const token = request.nextUrl.searchParams.get("invite");
    if (token) {
      if (session.kind !== "personal") throw new Error("UNAUTHORIZED");
      return privateJson(await readInvitation(token, session.did));
    }
    return privateJson({ cohort: await cohortSnapshot(session.user.id), dated: session.kind === "personal" ? await datedAvailability(session.user.id, session.did) : null });
  } catch (error) {
    return cohortFailure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { session, input } = await cohortRequest(request),
      checked = commands.safeParse(input);
    if (!checked.success) throw new Error("INVALID_INPUT");
    if (session.kind !== "personal") throw new Error("UNAUTHORIZED");
    const command = checked.data;
    if (command.action === "rate" || command.action === "accept_memberships") {
      const existing = await loadCohort(session.user.id);
      if (existing && isDatedPolicy(existing.enrollment.policy_id) && (command.action === "rate" || command.communities.length !== 1 || command.communities[0] !== existing.enrollment.house_id)) throw new Error("INVALID_INPUT");
    }
    if (command.action === "enroll_dated") {
      if (!datedStageOpen(command.policy, "ENROLLMENT")) throw new Error("WRITING_PAUSED");
      const result = await adminClient().rpc("enroll_dated_field_station", { p_owner: session.user.id, p_policy: command.policy, p_consent: true, p_values: true, p_house: command.house });
      if (result.error) throw new Error(["UNAUTHORIZED", "INVITATION_UNAVAILABLE", "HOUSE_ASSIGNMENT_REQUIRED", "POLICY_ALREADY_ACCEPTED", "CONSENT_REQUIRED"].find(code => result.error!.message.includes(code)) ?? "UNAVAILABLE");
    } else if (command.action === "enroll") {
      if (!cohortEnrollmentOpen()) throw new Error("WRITING_PAUSED");
      await readInvitation(command.token, session.did);
      await cohortCommand(session.user.id, "enroll", {
        hash: inviteHash(command.token),
        house: command.house,
        communities: command.communities,
        consent: true,
        startingValuesConfirmed: true,
        rateId: randomUUID(),
        salary: command.salary
          ? encryptNarrative(
              JSON.stringify({
                salary: command.salary,
                rate: salaryRate(command.salary),
              }),
            )
          : null,
      });
      console.info("cohort_enrollment_completed", { count: 1 });
    } else if (command.action === "rate")
      await cohortCommand(session.user.id, "rate", {
        id: randomUUID(),
        content: encryptNarrative(
          JSON.stringify({
            salary: command.salary,
            rate: salaryRate(command.salary),
          }),
        ),
      });
    else if (command.action === "request_community")
      await cohortCommand(session.user.id, command.action, {
        content: encryptNarrative(
          JSON.stringify({ name: command.name, reason: command.reason }),
        ),
      });
    else if (command.action === "accept_memberships") {
      await readInvitation(command.token, session.did);
      await cohortCommand(session.user.id, command.action, {
        hash: inviteHash(command.token),
        communities: command.communities,
        consent: true,
      });
    } else if (command.action === "leave_membership")
      await cohortCommand(session.user.id, command.action, {
        community: command.community,
      });
    else
      await cohortCommand(session.user.id, "consent", {
        consent: command.consent,
      });
    return privateJson({ saved: true });
  } catch (error) {
    return cohortFailure(error);
  }
}
