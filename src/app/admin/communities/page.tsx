import { notFound } from "next/navigation";
import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { isCohortAdmin } from "@/lib/cohort/server";
import { CohortAdmin } from "@/components/cohort/CohortAdmin";
export const dynamic = "force-dynamic";
export default async function CommunitiesPage() {
  const session = await memberPageSession();
  if (!(await isCohortAdmin(session.user.id))) notFound();
  return <CohortAdmin binding={memberWriteBinding(session.user.id)} />;
}
