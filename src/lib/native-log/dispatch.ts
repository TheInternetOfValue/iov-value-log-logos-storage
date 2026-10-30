import "server-only";
import { adminClient } from "@/lib/supabase/admin-core";
import { valueLogOrigin } from "@/lib/app-origin";
import { nativeJobSignature } from "./job";
import { nativeProviderAllowance } from "./allowance";
import { rpcFailure } from "./storage-core";

/** The caller has already checked the owner, immutable source and expected revision. */
export async function dispatchNativeProcessing(
  owner: string,
  id: string,
  revision: number,
  operation: "structure" | "coverage" = "structure",
) {
  const db = adminClient(),
    lease = await db.rpc("reserve_native_log_processing", {
      p_owner: owner,
      p_id: id,
      p_revision: revision,
    });
  if (lease.error || typeof lease.data !== "string")
    throw new Error(rpcFailure(lease.error?.message ?? "UNAVAILABLE"));
  try {
    // Coverage is charged by its worker; normal interpretation is charged here.
    if (operation === "structure") await nativeProviderAllowance(owner, "chat");
    const body = JSON.stringify({
      owner,
      id,
      revision,
      lease: lease.data,
      expires: Date.now() + 120000,
      ...(operation === "coverage" ? { operation } : {}),
    });
    if (process.env.VALUE_LOG_LOCAL_JOBS === "inline") {
      // Local Logos Storage demo: no Netlify runtime, so run the same signed job in this process.
      const signature = nativeJobSignature(body);
      void import("./structure-worker").then(({ runNativeStructure }) => runNativeStructure(body, signature))
        .catch((error) => console.warn("native_log_local_job_failed", error instanceof Error ? error.message : error));
      return;
    }
    const response = await fetch(
      `${valueLogOrigin()}/.netlify/functions/native-log-structure-background`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-value-log-native-job": nativeJobSignature(body),
        },
        body,
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error("PROVIDER_UNAVAILABLE");
    await response.body?.cancel();
  } catch (error) {
    await db.rpc("release_native_log_processing", {
      p_owner: owner,
      p_id: id,
      p_token: lease.data,
    });
    throw error;
  }
}
