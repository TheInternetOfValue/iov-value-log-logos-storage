import { decryptRecoveryChunk, listRecoveryChunks, purgeExpiredRecovery, removeRecoveryTurn, saveRecoveryChunk, type RecoveryChunk, type RecoveryHandle, type RecoveryPayload, type RecoveryScope } from "./device-recovery";
import type { CaptureManifest } from "./capture-health";
import type { RecordingSnapshot } from "./recording";

type Notice = (message: string) => void;
export async function unlockDeviceRecovery(scope: RecoveryScope, binding: string, ticket: string | null): Promise<RecoveryHandle> {
  const response = await fetch("/api/native-log/recovery-key", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-value-log-session": binding }, body: JSON.stringify({ id: scope.draftId, turn: scope.turnId, ticket }) });
  const body = await response.json();
  if (!response.ok || body.ownerScope !== scope.ownerScope) throw new Error("RECOVERY_UNAVAILABLE");
  const bytes = Uint8Array.from(atob(body.key), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  bytes.fill(0);
  return { ...scope, key, ticket: body.ticket, expiresAt: body.expiresAt };
}
export class DeviceVoiceRecovery {
  private pending: Promise<unknown> = Promise.resolve();
  private failed = false;
  private last: { index: number; blob: Blob; elapsedMs: number } | null = null;
  private ready: Promise<RecoveryHandle>;
  constructor(readonly scope: RecoveryScope, readonly turnKind: "initial" | "reply", private baseRevision: number, binding: string, saveDraft: () => Promise<unknown>, private notice: Notice) {
    this.ready = saveDraft().then(() => unlockDeviceRecovery(scope, binding, null));
    // A failed key/network request leaves the recorder in memory. Never reject
    // an unobserved promise or claim that an uncommitted chunk is device-saved.
    void this.ready.catch(() => this.unavailable());
  }
  private unavailable() {
    this.failed = true;
    this.notice("Device recovery is unavailable. Keep this tab open; you can download the recording if processing fails.");
  }
  private enqueue(operation: (handle: RecoveryHandle) => Promise<unknown>) {
    this.pending = this.pending.then(async () => {
      if (this.failed) return;
      try { await operation(await this.ready); this.notice("Encrypted audio saved on this device for up to 24 hours. Browser storage can still be cleared."); }
      catch { this.unavailable(); }
    });
    return this.pending;
  }
  raw(blob: Blob, index: number, elapsedMs: number) {
    this.last = { blob, index, elapsedMs };
    return this.enqueue(async handle => saveRecoveryChunk(handle, "recording", index, { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, elapsedMs, baseRevision: this.baseRevision, turnKind: this.turnKind }));
  }
  finish(snapshot: RecordingSnapshot) {
    const last = this.last;
    if (!last) return;
    return this.enqueue(async handle => saveRecoveryChunk(handle, "recording", last.index, { bytes: new Uint8Array(await last.blob.arrayBuffer()), mime: last.blob.type, elapsedMs: snapshot.elapsedMs ?? snapshot.elapsed * 1000, stopReason: snapshot.stopReason ?? "interrupted", baseRevision: this.baseRevision, turnKind: this.turnKind }));
  }
  async prepared(chunks: Blob[], capture: CaptureManifest) {
    for (const [index, blob] of chunks.entries()) await this.enqueue(async handle => saveRecoveryChunk(handle, "prepared", index, { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, elapsedMs: capture.elapsedMs ?? capture.decodedMs ?? 0, stopReason: capture.stopReason, capture, uploaded: false, total: chunks.length, baseRevision: this.baseRevision, turnKind: this.turnKind }));
  }
  async uploaded(index: number, blob: Blob, total: number, capture: CaptureManifest) {
    await this.enqueue(async handle => saveRecoveryChunk(handle, "prepared", index, { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, elapsedMs: capture.elapsedMs ?? capture.decodedMs ?? 0, stopReason: capture.stopReason, capture, uploaded: true, total, baseRevision: this.baseRevision, turnKind: this.turnKind }));
  }
  async flush() { await this.pending; return !this.failed; }
  async clear() { await this.pending; await removeRecoveryTurn(this.scope); }
}
export async function recoverDeviceTurn(rows: RecoveryChunk[], binding: string) {
  if (!rows.length) throw new Error("RECOVERY_UNAVAILABLE");
  const first = rows[0], handle = await unlockDeviceRecovery(first, binding, first.ticket);
  const own = rows.filter(row => row.turnId === first.turnId && row.draftId === first.draftId && row.ownerScope === first.ownerScope);
  const prepared = own.filter(row => row.kind === "prepared").sort((a, b) => a.index - b.index);
  const decoded: RecoveryPayload[] = [];
  for (const row of prepared) decoded.push(await decryptRecoveryChunk(handle, row));
  if (decoded.length && decoded.length === decoded[0].total && prepared.every((row, i) => row.index === i) && decoded.every(item => item.total === decoded.length && item.capture && JSON.stringify(item.capture) === JSON.stringify(decoded[0].capture))) {
    return { scope: first, turnKind: decoded[0].turnKind ?? "initial", chunks: decoded.map(item => new Blob([item.bytes], { type: item.mime })), manifest: decoded[0].capture!, audio: null, snapshot: null };
  }
  const raw = own.filter(row => row.kind === "recording").sort((a, b) => a.index - b.index);
  if (!raw.length || !raw.every((row, i) => row.index === i)) throw new Error("RECOVERY_INCOMPLETE");
  const parts = []; for (const row of raw) parts.push(await decryptRecoveryChunk(handle, row));
  const last = parts.at(-1)!;
  const snapshot: RecordingSnapshot = { phase: "ready", audio: new Blob(parts.map(p => p.bytes), { type: parts[0].mime }), elapsed: Math.floor(last.elapsedMs / 1000), elapsedMs: last.elapsedMs, stopReason: ["user", "limit", "size"].includes(last.stopReason ?? "") ? last.stopReason as RecordingSnapshot["stopReason"] : "interrupted", message: "Recovered the chunks saved on this device. Check the recording before continuing." };
  return { scope: first, turnKind: last.turnKind ?? "initial", chunks: null, manifest: null, audio: snapshot.audio, snapshot };
}
export async function availableDeviceTurns(ownerScope: string) {
  await purgeExpiredRecovery();
  const chunks = await listRecoveryChunks({ ownerScope });
  return [...new Map(chunks.map(chunk => [chunk.turnId, chunk])).values()].sort((a, b) => b.expiresAt - a.expiresAt);
}
export async function clearDeviceDraft(ownerScope: string, draftId: string) {
  const chunks = await listRecoveryChunks({ ownerScope, draftId });
  for (const row of new Map(chunks.map(chunk => [chunk.turnId, chunk])).values()) await removeRecoveryTurn(row);
}
