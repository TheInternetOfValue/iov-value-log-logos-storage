// Browser entry for the local, synthetic-only recovery fixture. No microphone.
import { DeviceVoiceRecovery, recoverDeviceTurn, clearDeviceDraft } from "../src/lib/native-log/recovery-client";
import { listRecoveryChunks, purgeExpiredRecovery, decryptRecoveryChunk } from "../src/lib/native-log/device-recovery";
import { unlockDeviceRecovery } from "../src/lib/native-log/recovery-client";
const scope = { ownerScope: "a".repeat(64), draftId: "10000000-0000-4000-8000-000000000002", turnId: "10000000-0000-4000-8000-000000000003" };
const expected = new Uint8Array(Array.from({ length: 32044 }, (_, i) => i % 251));
const binding = "synthetic-account-a";
const result = document.getElementById("result")!;
function show(value: unknown) { result.textContent = JSON.stringify(value, null, 2); }
function action(id: string, run: () => Promise<unknown>) {
  document.getElementById(id)!.addEventListener("click", () => {
    show({ state: "checking", syntheticOnly: true });
    void run().then(value => show(value)).catch(() => show({ passed: false, reason: "synthetic_check_failed", syntheticOnly: true }));
  });
}
async function account(value: "a" | "b") { await fetch("/qa/account", { method: "POST", body: value }); }
action("save", async () => {
  await account("a");
  const notices: string[] = [];
  const recovery = new DeviceVoiceRecovery(scope, "initial", 1, binding, async () => {}, notice => { notices.push(notice); });
  const blob = new Blob([expected], { type: "audio/wav" });
  await recovery.raw(blob, 0, 1000);
  await recovery.finish({ phase: "ready", elapsed: 1, elapsedMs: 1000, stopReason: "user", audio: blob, message: "" });
  await recovery.prepared([blob], { version: 1, elapsedMs: 1000, decodedMs: 1000, stopReason: "user", mimeType: "audio/wav" });
  await recovery.uploaded(0, blob, 1, { version: 1, elapsedMs: 1000, decodedMs: 1000, stopReason: "user", mimeType: "audio/wav" });
  const rows = await listRecoveryChunks(scope);
  const passed = await recovery.flush() && rows.length === 2 && rows.every(row => !("key" in row) && !("bytes" in row));
  return { id: "U20-save", passed, encryptedRows: rows.length, hasPlaintextKey: rows.some(row => "key" in row), lastNotice: notices.at(-1), syntheticOnly: true };
});
action("recover", async () => {
  await account("a");
  const rows = await listRecoveryChunks(scope), recovered = await recoverDeviceTurn(rows, binding);
  const bytes = new Uint8Array(await recovered.chunks![0].arrayBuffer());
  const exact = bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
  return { id: "U20-reload", passed: exact && recovered.scope.draftId === scope.draftId && recovered.scope.turnId === scope.turnId, exactPreparedBytes: exact, syntheticOnly: true };
});
action("wrong", async () => {
  const rows = await listRecoveryChunks(scope); await account("b");
  let denied = false; try { await recoverDeviceTurn(rows, binding); } catch { denied = true; }
  const ownRows = await listRecoveryChunks({ ownerScope: "b".repeat(64) });
  await account("a"); return { id: "U21-account", passed: denied && ownRows.length === 0, unlockDenied: denied, ownVisibleRows: ownRows.length, syntheticOnly: true };
});
action("tamper", async () => {
  await account("a"); const rows = await listRecoveryChunks(scope), original = rows[0];
  const handle = await unlockDeviceRecovery(scope, binding, original.ticket);
  const changed = structuredClone(original); new Uint8Array(changed.ciphertext)[0] ^= 1;
  let denied = false; try { await decryptRecoveryChunk(handle, changed); } catch { denied = true; }
  return { id: "U21-tamper", passed: denied, syntheticOnly: true };
});
action("expiry", async () => {
  await purgeExpiredRecovery(Date.now() + 86400001);
  const rows = await listRecoveryChunks(scope);
  return { id: "U22-expiry", passed: rows.length === 0, encryptedRows: rows.length, syntheticOnly: true };
});
action("cleanup", async () => {
  await clearDeviceDraft(scope.ownerScope, scope.draftId);
  return { id: "U22-removal", passed: (await listRecoveryChunks(scope)).length === 0, syntheticOnly: true };
});
