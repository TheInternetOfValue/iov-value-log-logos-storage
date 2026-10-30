// Server-only key derivation, purpose-separated from narrative encryption.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { RECOVERY_MAX_AGE_MS } from "./device-recovery";
const claims = z.object({ version: z.literal(1), owner: z.uuid(), draft: z.uuid(), turn: z.uuid(), issued: z.number().int(), expires: z.number().int(), salt: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function root() {
  const key = Buffer.from(process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 ?? "", "base64");
  if (key.length !== 32) throw new Error("RECOVERY_UNAVAILABLE"); return key;
}
const mac = (purpose: string, value: string) => createHmac("sha256", root()).update(`native-audio-recovery:${purpose}:v1:${value}`).digest();
export function recoveryKey(owner: string, draft: string, turn: string, ticket: string | null, now = Date.now()) {
  let encoded: string;
  if (ticket) {
    const parts = ticket.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{1,1500}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]) || !timingSafeEqual(mac("ticket", parts[0]), Buffer.from(parts[1], "hex"))) throw new Error("RECOVERY_UNAVAILABLE");
    encoded = parts[0];
  } else {
    encoded = Buffer.from(JSON.stringify(claims.parse({ version: 1, owner, draft, turn, issued: now, expires: now + RECOVERY_MAX_AGE_MS, salt: randomBytes(32).toString("hex") }))).toString("base64url");
  }
  const data = claims.parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
  if (data.owner !== owner || data.draft !== draft || data.turn !== turn || data.expires <= now || data.issued > now || data.expires - data.issued !== RECOVERY_MAX_AGE_MS) throw new Error("RECOVERY_UNAVAILABLE");
  return { key: mac("key", encoded).toString("base64"), ticket: `${encoded}.${mac("ticket", encoded).toString("hex")}`, expiresAt: data.expires };
}
