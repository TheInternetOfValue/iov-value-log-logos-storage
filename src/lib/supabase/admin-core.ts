import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client shared by trusted Next.js server code and standalone
 * Netlify workers. Do not import this module from browser code.
 */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Local Logos Storage demo (development only, registered by logos-demo-client): no Supabase settings.
  const demo = (globalThis as { __valueLogDemoAdmin?: () => ReturnType<typeof createClient> }).__valueLogDemoAdmin;
  if (!url && !key && demo) return demo();
  if (!url || !key) throw new Error("Supabase service configuration is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
