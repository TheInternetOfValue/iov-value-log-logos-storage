import { adminClient } from "@/lib/supabase/admin-core";
import { nativeOwnerScope } from "./storage-core";
export async function nativeProviderAllowance(owner: string, operation: "stt" | "chat") {
  const db = adminClient(), day = new Date().toISOString().slice(0, 10);
  const limits = operation === "stt" ? [48, 240] : [30, 120];
  for (const [index, bucket] of [`native-${operation}:${nativeOwnerScope(owner)}:${day}`, `native-${operation}:global:${day}`].entries()) {
    const result = await db.rpc("consume_ingestion_rate_limit", { p_bucket: bucket, p_limit: limits[index] });
    if (result.error) throw new Error("UNAVAILABLE"); if (result.data !== true) throw new Error("PROVIDER_ALLOWANCE");
  }
}
