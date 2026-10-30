import { redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { memberWritingOpen } from "@/lib/members/admission";
import {
  nativeColumns,
  nativeLoggingOpen,
  nativeOwnerScope,
  nativeView,
  loadNative,
  type NativeRow,
} from "@/lib/native-log/server";
import { sarvamConfigured } from "@/lib/native-log/sarvam";
import { localDateFor } from "@/lib/format";
import { dateSchema } from "@/lib/members/entries";
import { NativeLog } from "@/components/native-log/NativeLog";
import { loadCohort } from "@/lib/cohort/server";
import { isDatedPolicy } from "@/lib/field-station/ids";
import { sharedDayFor, deviceRecoveryFor } from "@/lib/field-station/shared-day";

export const dynamic = "force-dynamic";
export async function NativeWorkspace({
  searchParams,
  embedded = false,
}: {
  searchParams: Promise<{ date?: string; draft?: string }>;
  embedded?: boolean;
}) {
  const session = await memberPageSession();
  const sharedEnabled = await sharedDayFor(session.user.id, session.kind);
  if (session.kind === "personal" && !session.onboarded)
    redirect("/onboarding");
  const enabled = nativeLoggingOpen();
  const query = await searchParams;
  const profile =
    session.kind === "pilot"
      ? await session.client
          .from("members")
          .select("timezone")
          .eq("id", session.user.id)
          .single()
      : null;
  const cohort =
    session.kind === "personal" ? await loadCohort(session.user.id) : null;
  const timezone =
    session.kind === "personal"
      ? (sharedEnabled ? "Asia/Kolkata" : cohort?.enrollment.timezone ?? session.timezone)
      : String(profile?.data?.timezone || "Asia/Kolkata");
  const today = localDateFor(new Date().toISOString(), timezone),
    selected = dateSchema.safeParse(query.date);
  const date =
    selected.success && selected.data <= today ? selected.data : today;
  const result = await session.client
    .from("native_log_drafts")
    .select(nativeColumns)
    .eq("owner_id", session.user.id)
    .neq("status", "removed")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (result.error && !enabled)
    return (
      <section>
        <h1>Native voice logging is being prepared.</h1>
        <p>Your existing saved activities remain available.</p>
        <Link href="/day">Back to Today</Link>
      </section>
    );
  if (result.error)
    return (
      <section>
        <h1>Your saved drafts could not load.</h1>
        <p>Try again before starting a new recording.</p>
        <Link href="/day">Back to Today</Link>
      </section>
    );
  let initial: Parameters<typeof NativeLog>[0]["initial"] = null;
  if (query.draft) {
    if (!z.uuid().safeParse(query.draft).success) redirect("/log");
    try {
      const view = nativeView(await loadNative(session, query.draft));
      if (view.document)
        initial = {
          id: view.id,
          revision: view.revision,
          document: view.document,
          receipt: view.receipt,
          processingUntil: view.processingUntil,
          processingError: view.processingError,
          unmatchedRows: view.unmatchedRows,
          captures: view.captures,
          recording: view.recording,
        };
    } catch {
      return (
        <section>
          <h1>This draft is not available in this account.</h1>
          <Link href="/log">Open my drafts</Link>
        </section>
      );
    }
  }
  const savedDrafts = (result.data as unknown as NativeRow[]).flatMap((row) => {
    try {
      const view = nativeView(row);
      return view.document
        ? [
            {
              id: row.id,
              revision: row.revision,
              status: row.status,
              updatedAt: row.updated_at,
              date: view.document.date,
              count: view.document.activities.length,
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
  const scope = nativeOwnerScope(session.user.id);

  return (
    <NativeLog
      key={`${scope}:${initial?.id ?? "new"}`}
      ownerScope={scope}
      mode={session.kind}
      date={date}
      today={today}
      timezone={timezone}
      binding={memberWriteBinding(session.user.id)}
      writing={enabled && (session.kind === "pilot" || memberWritingOpen())}
      processing={enabled && sarvamConfigured()}
      deviceRecovery={await deviceRecoveryFor(session.user.id, session.kind)}
      sharedDay={session.kind === "personal" && sharedEnabled}
      initial={initial}
      savedDrafts={savedDrafts}
      embedded={embedded}
      cohort={cohort && (!isDatedPolicy(cohort.enrollment.policy_id) || cohort.enrollment.active && cohort.enrollment.review_consent) ? cohort.context : undefined}
      confirming={!cohort || cohort.enrollment.active}
      cohortBoundary={cohort?.enrollment.boundary_at}
    />
  );
}
