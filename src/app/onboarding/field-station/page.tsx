import Link from "next/link";
import { memberPageSession } from "@/lib/members/session";
import { memberSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import {
  cohortEnrollmentOpen,
  loadCohort,
  readInvitation,
} from "@/lib/cohort/server";
import { CohortEnrollment } from "@/components/cohort/CohortEnrollment";
import { CohortMemberships } from "@/components/cohort/CohortMemberships";
export const dynamic = "force-dynamic";
export default async function FieldStationOnboarding({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const query = await searchParams;
  let session: Awaited<ReturnType<typeof memberPageSession>>;
  try {
    session = await memberSession();
  } catch {
    return (
      <section>
        <h1>Your Field Station invitation</h1>
        <p>Sign in with your Wellbeing Identity to review the invitation.</p>
        <a
          className="button"
          href={`/auth/identity/start?provider=google&invite=${encodeURIComponent(query.invite ?? "")}`}
        >
          Continue with Google
        </a>
      </section>
    );
  }
  if (session.kind !== "personal")
    return (
      <section>
        <h1>Your existing Value Log is ready.</h1>
        <Link href="/day">Open Today</Link>
      </section>
    );
  if (!session.onboarded)
    return (
      <section>
        <h1>Start with your name and timezone.</h1>
        <Link
          href={`/onboarding?invite=${encodeURIComponent(query.invite ?? "")}`}
        >
          Set up my Value Log
        </Link>
      </section>
    );
  const existing = await loadCohort(session.user.id);
  const token = query.invite ?? "";
  const invitation = await readInvitation(token, session.did).catch(() => null);
  if (!invitation)
    return (
      <section>
        <h1>This invitation is unavailable.</h1>
        <p>
          Ask Moses for a current invitation. Your private Value Log remains
          available.
        </p>
        <Link href="/day">Open Today</Link>
      </section>
    );
  if (existing)
    return (
      <CohortMemberships
        token={token}
        binding={memberWriteBinding(session.user.id)}
        communities={invitation.communities}
      />
    );
  return (
    <CohortEnrollment
      token={token}
      binding={memberWriteBinding(session.user.id)}
      communities={invitation.communities}
      enabled={cohortEnrollmentOpen()}
    />
  );
}
