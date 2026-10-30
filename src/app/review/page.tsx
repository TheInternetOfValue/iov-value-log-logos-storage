import { PageIntro } from "@/components/PageIntro";
import { SetupRequired } from "@/components/SetupRequired";
import { HouseOfBrosIntro } from "@/components/review/HouseOfBrosIntro";
import { CommunityReview } from "@/components/review/CommunityReview";
import { isConfigured } from "@/lib/env";
import { logosDemoEnabled } from "@/lib/logos-demo";
import Link from "next/link";
import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { cohortSnapshot } from "@/lib/cohort/server";
import { CohortDashboard } from "@/components/cohort/CohortDashboard";
import { PendingCaptureReview } from "@/components/native-log/PendingCaptureReview";
import { UnassessedSubmissions } from "@/components/native-log/UnassessedSubmissions";
import { HistoricalAdoption } from "@/components/native-log/HistoricalAdoption";
import { DATED_POLICY } from "@/lib/field-station/ids";
import { dateSchema } from "@/lib/members/entries";
import { localDateFor } from "@/lib/format";
import { MemberInsights } from "@/components/members/MemberInsights";
import { ReviewDays } from "@/components/members/ReviewDays";
import { sharedDayFor } from "@/lib/field-station/shared-day";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    range?: string;
    error?: string;
    corrected?: string;
    saved?: string;
    authority?: string;
    settlement?: string;
    capturePage?: string;
    privatePage?: string;
    historyPage?: string;
  }>;
}) {
  if (!isConfigured() && !logosDemoEnabled()) return <SetupRequired />;
  const session = await memberPageSession();
  const query = await searchParams;
  const sharedEnabled = session.kind === "personal" && await sharedDayFor(session.user.id);
  const capturePage = Math.max(
    0,
    Math.min(1000, Number(query.capturePage) || 0),
  );
  const selectedDay = dateSchema.safeParse(query.date);
  const day = selectedDay.success ? selectedDay.data : undefined;
  const captures = (
    <PendingCaptureReview session={session} page={Math.floor(capturePage)} shared={sharedEnabled} />
  );
  const privateLogs = sharedEnabled ? <UnassessedSubmissions session={session} day={day} page={Math.max(0, Math.min(1000, Number(query.privatePage) || 0))} /> : null;
  if (session.kind === "personal") {
    const cohort = await cohortSnapshot(session.user.id);
    const today = localDateFor(new Date().toISOString(), sharedEnabled ? "Asia/Kolkata" : cohort?.enrollment.timezone ?? session.timezone);
    const insights = <MemberInsights client={session.client} owner={session.user.id} cohort={cohort} today={localDateFor(new Date().toISOString(), "Asia/Kolkata")} range={query.range} />;
    const days = <ReviewDays selected={day} today={today} />;
    return cohort ? (
      <>
        <header className="member-page-heading"><p className="member-kicker">Your space <span> / </span> 01</p><h1>Insights<span className="heading-dot">.</span></h1><p>A place to follow your activities and respond when needed.</p></header>
        <HouseOfBrosIntro destination="Insights" />
        {insights}
        {days}
        <CohortDashboard
          day={day}
          initial={cohort}
          binding={memberWriteBinding(session.user.id)}
          view="review"
        />
        {day ? <p className="review-all-dates-note">Submitted conversations below are shown across all dates.</p> : null}
        {captures}
        {privateLogs}
        {cohort.enrollment.policy_id === DATED_POLICY ? <HistoricalAdoption session={session} policy={cohort.enrollment.policy_id} page={Math.max(0, Math.min(1000, Number(query.historyPage) || 0))} /> : null}
      </>
    ) : (
      <>
        <div className="member-review-intro"><header className="member-page-heading"><p className="member-kicker">Your space <span> / </span> 01</p><h1>Insights<span className="heading-dot">.</span></h1><p>A place to return to the things you have shared.</p></header>
          <HouseOfBrosIntro destination="Insights" />
          {insights}
          {days}
          <p className="review-footnote">Your activities are private and unassessed. Community review is available to invited pilot participants.</p></div>
        {day ? <p className="review-all-dates-note">Submitted conversations below are shown across all dates.</p> : null}
        {captures}
        {privateLogs}
      </>
    );
  }
  return (
    <section className="review-page">
      <PageIntro title="Review">Community validation queue</PageIntro>
      <HouseOfBrosIntro />
      <p>
        <Link href="/admin/communities">
          Field Station communities and review →
        </Link>
      </p>
      <CommunityReview
        error={query.error}
        corrected={query.corrected}
        saved={query.saved}
        authority={query.authority}
        settlement={query.settlement}
      />
      {captures}
    </section>
  );
}
