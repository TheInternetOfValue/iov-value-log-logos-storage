import { memberPageSession } from "@/lib/members/session";
import { memberWriteBinding } from "@/lib/members/http";
import { CohortAgent } from "@/components/cohort/CohortAgent";
export const dynamic = "force-dynamic";
export default async function AgentPage() {
  const s = await memberPageSession();
  return <CohortAgent binding={memberWriteBinding(s.user.id)} />;
}
