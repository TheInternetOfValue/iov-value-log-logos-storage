import { redirect } from "next/navigation";
import { memberPageSession } from "@/lib/members/session";

/** Existing pilot screens/actions remain restricted. Valid new members return to their workspace. */
export async function pageSession() {
  const session = await memberPageSession();
  if (session.kind !== "pilot") redirect(session.onboarded ? "/day" : "/onboarding");
  return session;
}
