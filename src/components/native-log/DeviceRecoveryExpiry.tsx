"use client";
import { useEffect } from "react";
/** No key, audio, session or provider access; only purge expired local ciphertext. */
export function DeviceRecoveryExpiry() {
  useEffect(() => {
    const purge = () => { if (globalThis.indexedDB) void import("@/lib/native-log/device-recovery").then(module => module.purgeExpiredRecovery()).catch(() => {}); };
    const visible = () => { if (document.visibilityState === "visible") purge(); };
    purge(); const timer = setInterval(purge, 3600000);
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return null;
}
