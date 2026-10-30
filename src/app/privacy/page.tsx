import { NativeExport } from "@/components/native-log/NativeExport";
import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { SourceSubmissions } from "@/components/privacy/SourceSubmissions";
import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { MemberPrivacy } from "@/components/members/MemberPrivacy";
import { loadCohort } from "@/lib/cohort/server";
import { CohortExport } from "@/components/cohort/CohortExport";
import { deviceRecoveryFor } from "@/lib/field-station/shared-day";
import { DeviceRecoveryPrivacy } from "@/components/native-log/DeviceRecoveryPrivacy";

export const dynamic = "force-dynamic";

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; reveal?: string }>;
}) {
  const session = await memberPageSession();
  const recovery = await deviceRecoveryFor(session.user.id, session.kind);
  if (session.kind === "personal") {
    const cohort = await loadCohort(session.user.id);
    return (
      <>
        {cohort ? (
          <section className="cohort-panel">
            <h1>Your Field Station data</h1>
            <p>
              Your accepted memberships, confirmed activities, automated and
              human review decisions, corrections and provisional score history
              stay private. Sarvam processes the approved records you consent to
              review. Moses receives unresolved cases and appeals. Confirmed
              records and decisions are retained for audit; removing a voice
              draft does not erase its confirmed pilot records. Pause further
              processing in Profile.
            </p>
            <CohortExport binding={memberWriteBinding(session.user.id)} />
            <p>
              <Link href="/profile">Manage my pilot permissions</Link>
            </p>
          </section>
        ) : null}
        <MemberPrivacy
          binding={memberWriteBinding(session.user.id)}
          cohort={Boolean(cohort)}
          deviceRecovery={recovery}
        />
      </>
    );
  }
  const query = await searchParams;
  return (
    <section className="privacy-page">
      <PageIntro title="Privacy & data">
        Your private source material, export, and deletion controls.
      </PageIntro>
      <div className="privacy-actions">
        <a className="button" href="/api/v1/export">
          Export my private data
        </a>
        {query.date ? (
          <Link className="button secondary" href="/privacy">
            Show all submissions
          </Link>
        ) : null}
      </div>
      {recovery ? (
        <>
          <h2>Pending audio on this device</h2>
          <DeviceRecoveryPrivacy />
        </>
      ) : null}
      <h2>Voice-log drafts</h2>
      <p>
        Using the microphone saves your words privately and sends audio and text
        to Sarvam to prepare your log under its{" "}
        <a
          href="https://www.sarvam.ai/privacy-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          privacy policy
        </a>
        . Value Log saves words, not audio. Speak again to correct the table,
        then submit it when it is right. If assessment facts are missing, the
        approved conversation stays in Review without an invented score or
        effect. Submitted conversations and unsubmitted drafts remain until you
        remove them from <Link href="/log">Log by voice</Link>. Removal clears
        that conversation copy; any continuation is a separate saved copy, and
        confirmed activities have separate controls.
      </p>
      <NativeExport binding={memberWriteBinding(session.user.id)} />
      <div className="privacy-heading">
        <p className="meta">Source submissions</p>
        <h2>{query.date ? `Activity date ${query.date}` : "Newest first"}</h2>
        <p>
          Original narratives stay encrypted at rest and appear only after you
          explicitly reveal them.
        </p>
      </div>
      <SourceSubmissions date={query.date} reveal={query.reveal} />
    </section>
  );
}
