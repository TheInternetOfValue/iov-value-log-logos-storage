import { NativeExport } from "@/components/native-log/NativeExport";
import { MemberExport } from "./MemberExport";
import Link from "next/link";
import { DeviceRecoveryPrivacy } from "@/components/native-log/DeviceRecoveryPrivacy";
export function MemberPrivacy({
  binding,
  cohort = false,
  deviceRecovery = false,
}: {
  binding: string;
  cohort?: boolean;
  deviceRecovery?: boolean;
}) {
  return (
    <section className="member-log">
      <h1>Privacy &amp; data</h1>
      <p className="lede">
        Your Value Log belongs to you. Activities stay private, and your writing
        is encrypted in storage.
      </p>
      <MemberExport binding={binding} />
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
        approved conversation stays in Insights without an invented score or
        effect. Submitted conversations and unsubmitted drafts remain until you
        remove them from <Link href="/log">Log by voice</Link>.{" "}
        {cohort && deviceRecovery
          ? "Approved Field Station source conversations remain with their private review history; ordinary unsubmitted drafts can be removed. Any continuation is a separate saved version."
          : "Removal clears that conversation copy; any continuation is a separate saved copy, and confirmed activities have separate controls."}
      </p>
      <NativeExport binding={binding} />
      {deviceRecovery ? (
        <>
          <h2>Pending audio on this device</h2>
          <DeviceRecoveryPrivacy />
          {cohort ? (
            <p>
              Approved Field Station conversations are private supporting
              evidence for review and replay. Removing their draft removes it
              from the draft list but retains the approved source and review
              history. Revoking review consent stops new processing; it does not
              rewrite completed decisions. Export includes the retained approved
              source.
            </p>
          ) : null}
        </>
      ) : null}
      <h2>What is saved</h2>
      <p>
        Your chosen name and timezone, a private link to your Wellbeing
        Identity, and the activities you deliberately save. Google sign-in is
        handled by Wellbeing Identity; your Google email and profile are not
        copied into this Value Log.
      </p>
      <h2>Change or remove an activity</h2>
      <p>
        Open the activity&apos;s date in <Link href="/day">Today</Link>, then
        choose Edit or Remove. Removal erases its stored writing. A content-free
        record of the removal remains for the audit trail. Saved activities
        remain until you remove them. Encrypted backups follow the
        service&apos;s backup retention; removal does not rewrite an existing
        backup.
      </p>
      <h2>Your Identity stays separate</h2>
      <p>
        {cohort
          ? "Personal notes outside the Field Station pilot remain unassessed. Your provisional pilot score stays private in Value Log and does not change your public Identity."
          : "Your activities are unassessed. They create no wellbeing score, credit, community membership or public profile change."}{" "}
        Manage Identity details and sharing in{" "}
        <a href="https://identity.theinternetofvalue.org/me">
          Wellbeing Identity
        </a>
        .
      </p>
      <p className="meta">
        The export includes all your saved activities, removal markers and your
        own audit records. It contains no other member&apos;s data.
      </p>
    </section>
  );
}
