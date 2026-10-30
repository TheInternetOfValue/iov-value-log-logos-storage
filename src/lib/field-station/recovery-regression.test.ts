import { afterEach, expect, it, vi } from "vitest";
import { recoveryKey } from "@/lib/native-log/recovery-key";
import { decryptRecoveryChunk, encryptRecoveryChunk, saveRecoveryChunk, type RecoveryHandle } from "@/lib/native-log/device-recovery";
import { fixtureId } from "./fixtures";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup() {
  vi.stubEnv("NARRATIVE_ENCRYPTION_KEY_BASE64", Buffer.alloc(32, 7).toString("base64"));
  const value = recoveryKey(fixtureId(1), fixtureId(2), fixtureId(3), null);
  const key = await crypto.subtle.importKey("raw", Buffer.from(value.key, "base64"), "AES-GCM", false, ["encrypt", "decrypt"]);
  const handle: RecoveryHandle = { ownerScope: "a".repeat(64), draftId: fixtureId(2), turnId: fixtureId(3), ...value, key };
  return { handle, value };
}
it("U21: key reissue requires the exact owner, draft, turn, signature and unexpired ticket", async () => {
  const { value } = await setup();
  expect(recoveryKey(fixtureId(1), fixtureId(2), fixtureId(3), value.ticket).key).toBe(value.key);
  for (const args of [[fixtureId(4), fixtureId(2), fixtureId(3)], [fixtureId(1), fixtureId(4), fixtureId(3)], [fixtureId(1), fixtureId(2), fixtureId(4)]])
    expect(() => recoveryKey(args[0], args[1], args[2], value.ticket)).toThrow();
  expect(() => recoveryKey(fixtureId(1), fixtureId(2), fixtureId(3), value.ticket.slice(0, -1) + (value.ticket.endsWith("a") ? "b" : "a"))).toThrow();
  expect(() => recoveryKey(fixtureId(1), fixtureId(2), fixtureId(3), value.ticket, value.expiresAt)).toThrow();
});
it("U20/U21: exact bytes and progress decrypt only under their original scope; ciphertext tampering fails", async () => {
  const { handle } = await setup();
  const payload = { bytes: new Uint8Array([0, 1, 250, 255]), mime: "audio/wav", elapsedMs: 25000, total: 24, baseRevision: 7, uploaded: true };
  const chunk = await encryptRecoveryChunk(handle, "prepared", 3, payload);
  expect(await decryptRecoveryChunk(handle, chunk)).toEqual(payload);
  expect(chunk).not.toHaveProperty("key");
  expect(chunk).not.toHaveProperty("bytes");
  await expect(decryptRecoveryChunk({ ...handle, ownerScope: "b".repeat(64) }, chunk)).rejects.toThrow();
  const changed = structuredClone(chunk); new Uint8Array(changed.ciphertext)[0] ^= 1;
  await expect(decryptRecoveryChunk(handle, changed)).rejects.toThrow();
  const next = await encryptRecoveryChunk(handle, "prepared", 3, payload);
  expect(new Uint8Array(next.iv)).not.toEqual(new Uint8Array(chunk.iv));
});
it("U22: unavailable storage rejects saving instead of promising recovery", async () => {
  const { handle } = await setup(); vi.stubGlobal("indexedDB", undefined);
  await expect(saveRecoveryChunk(handle, "recording", 0, { bytes: new Uint8Array([1]), mime: "audio/webm", elapsedMs: 1000, baseRevision: 1 })).rejects.toThrow("DEVICE_STORAGE_UNAVAILABLE");
});
