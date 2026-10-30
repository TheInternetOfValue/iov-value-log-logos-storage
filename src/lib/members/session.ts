import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import { logosDemoActive } from "@/lib/logos-demo";
import { logosDemoClient } from "@/lib/logos-demo-client";

export const memberSession = cache(async () => {
  // Local demo without Supabase: a read-only founder session over the export stored on Logos Storage.
  if (logosDemoActive()) {
    const demo = await logosDemoClient();
    return { kind: "pilot" as const, client: demo.client, user: demo.user as unknown as Awaited<ReturnType<Awaited<ReturnType<typeof serverClient>>["auth"]["getUser"]>>["data"]["user"] & object };
  }
  const client = await serverClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  const allowed = (process.env.MOSES_EMAIL_ALLOWLIST ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (user.email && allowed.includes(user.email.toLowerCase())) return { kind: "pilot" as const, client, user };
  const [access, binding, member] = await Promise.all([
    client.from("member_log_access").select("onboarded_at").eq("owner_id", user.id).maybeSingle(),
    client.from("member_identity_bindings").select("did").eq("owner_id", user.id).maybeSingle(),
    client.from("members").select("display_name,timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (access.error || binding.error || member.error || !access.data || !binding.data || !member.data) throw new Error("UNAUTHORIZED");
  return { kind: "personal" as const, client, user, did: binding.data.did as string,
    name: member.data.display_name as string, timezone: member.data.timezone as string,
    onboarded: Boolean(access.data.onboarded_at) };
});
export async function memberPageSession() {
  try { return await memberSession(); } catch { redirect("/login"); }
}
