import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

export async function serverClient() {
  const store = await cookies();
  const env = publicEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy refresh handles this.
        }
      },
    },
  });
}

export async function requireMoses() {
  const client = await serverClient();
  const { data: { user } } = await client.auth.getUser();
  const allowed = (process.env.MOSES_EMAIL_ALLOWLIST ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!user?.email || !allowed.includes(user.email.toLowerCase())) throw new Error("UNAUTHORIZED");
  return { client, user };
}
