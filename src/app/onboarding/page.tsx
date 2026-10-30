import { redirect } from "next/navigation";
import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { memberWritingOpen } from "@/lib/members/admission";
import { MemberSetup } from "@/components/members/MemberSetup";
export const dynamic = "force-dynamic";
export default async function OnboardingPage({searchParams}:{searchParams:Promise<{invite?:string}>}) {
  const session = await memberPageSession();
  const invite=(await searchParams).invite;
  const minimal = process.env.VALUE_LOG_SHARED_DAY === "open";
  if (session.kind === "pilot" || session.onboarded) redirect(session.kind==="personal"&&invite&&/^[A-Za-z0-9_-]{32,100}$/.test(invite)?`/onboarding/field-station?invite=${encodeURIComponent(invite)}`:"/day");
  return <section className="member-log"><h1>Your Value Log</h1><p className="lede">{minimal ? "Your Google sign-in has connected your Wellbeing Identity. You can start logging your day." : "A private place to record your day, connected to the Wellbeing Identity you just used to sign in. Start with your name and timezone."}</p>
    <MemberSetup minimal={minimal} binding={memberWriteBinding(session.user.id)} writing={memberWritingOpen()} cohortInvite={(await searchParams).invite} />
    <p className="meta">You can edit your display name later. Identity details and sharing choices stay in Wellbeing Identity.</p>
  </section>;
}
