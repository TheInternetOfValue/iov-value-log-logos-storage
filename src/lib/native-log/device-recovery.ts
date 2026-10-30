/** Browser-only encrypted recovery. Keys are memory-only and obtained after auth. */
export const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DATABASE = "value-log-audio-recovery-v1";
const STORE = "chunks";
export type RecoveryScope = { ownerScope: string; draftId: string; turnId: string };
export type RecoveryHandle = RecoveryScope & { key: CryptoKey; ticket: string; expiresAt: number };
export type RecoveryChunk = RecoveryScope & {
  id: string; ticket: string; expiresAt: number; index: number;
  kind: "recording" | "prepared"; iv: ArrayBuffer; ciphertext: ArrayBuffer;
};
export type RecoveryPayload = { bytes: Uint8Array<ArrayBuffer>; mime: string; elapsedMs: number; stopReason?: string; uploaded?: boolean; total?: number; baseRevision: number; turnKind?: "initial" | "reply"; capture?: import("./capture-health").CaptureManifest };
const scopeId = (scope: RecoveryScope) => `${scope.ownerScope}:${scope.draftId}:${scope.turnId}`;
const chunkId = (scope: RecoveryScope, kind: RecoveryChunk["kind"], index: number) => `${scopeId(scope)}:${kind}:${index}`;
const aad = (chunk: Pick<RecoveryChunk, "ownerScope" | "draftId" | "turnId" | "expiresAt" | "kind" | "index">) => new TextEncoder().encode(JSON.stringify([1, scopeId(chunk), chunk.expiresAt, chunk.kind, chunk.index]));
function assertHandle(handle: RecoveryHandle, now = Date.now()) {
  if (!Number.isSafeInteger(handle.expiresAt) || handle.expiresAt <= now || !/^[a-f0-9]{64}$/.test(handle.ownerScope)) throw new Error("RECOVERY_UNAVAILABLE");
}
export async function encryptRecoveryChunk(handle: RecoveryHandle, kind: RecoveryChunk["kind"], index: number, payload: RecoveryPayload): Promise<RecoveryChunk> {
  assertHandle(handle);
  if (!Number.isSafeInteger(index) || index < 0 || payload.bytes.byteLength > 25 * 1024 * 1024) throw new Error("RECOVERY_UNAVAILABLE");
  const header = { ownerScope: handle.ownerScope, draftId: handle.draftId, turnId: handle.turnId, expiresAt: handle.expiresAt, kind, index };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const metadata = new TextEncoder().encode(JSON.stringify({ ...payload, bytes: undefined }));
  const plaintext = new Uint8Array(4 + metadata.length + payload.bytes.byteLength);
  new DataView(plaintext.buffer).setUint32(0, metadata.length);
  plaintext.set(metadata, 4); plaintext.set(payload.bytes, 4 + metadata.length);
  return { ...header, id: chunkId(handle, kind, index), ticket: handle.ticket, iv: iv.buffer,
    ciphertext: await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(header) }, handle.key, plaintext) };
}
export async function decryptRecoveryChunk(handle: RecoveryHandle, chunk: RecoveryChunk): Promise<RecoveryPayload> {
  assertHandle(handle);
  if (scopeId(handle) !== scopeId(chunk) || handle.ticket !== chunk.ticket || handle.expiresAt !== chunk.expiresAt || chunk.id !== chunkId(chunk, chunk.kind, chunk.index)) throw new Error("RECOVERY_UNAVAILABLE");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: chunk.iv, additionalData: aad(chunk) }, handle.key, chunk.ciphertext);
  const size = new DataView(plaintext).getUint32(0);
  if (size > plaintext.byteLength - 4) throw new Error("RECOVERY_UNAVAILABLE");
  const metadata = JSON.parse(new TextDecoder().decode(plaintext.slice(4, 4 + size)));
  return { ...metadata, bytes: new Uint8Array(plaintext.slice(4 + size)) };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("DEVICE_STORAGE_UNAVAILABLE")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onerror = () => reject(new Error("DEVICE_STORAGE_UNAVAILABLE"));
    request.onblocked = () => reject(new Error("DEVICE_STORAGE_UNAVAILABLE"));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await database();
  try { return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode); let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(new Error("DEVICE_STORAGE_UNAVAILABLE"));
    try { operation(tx.objectStore(STORE), next => { value = next; }); } catch { tx.abort(); }
  }); } finally { db.close(); }
}
/** Success means this encrypted chunk committed; it does not promise browser retention. */
export async function saveRecoveryChunk(handle: RecoveryHandle, kind: RecoveryChunk["kind"], index: number, payload: RecoveryPayload) {
  const encrypted = await encryptRecoveryChunk(handle, kind, index, payload);
  await transaction<void>("readwrite", store => { store.put(encrypted); });
  return { state: "device_saved" as const, expiresAt: handle.expiresAt };
}
export async function listRecoveryChunks(scope: Pick<RecoveryScope, "ownerScope"> & { draftId?: string }): Promise<RecoveryChunk[]> {
  return transaction<RecoveryChunk[]>("readonly", (store, done) => {
    const request = store.getAll(); request.onsuccess = () => done((request.result as RecoveryChunk[]).filter(row => row.ownerScope === scope.ownerScope && (!scope.draftId || row.draftId === scope.draftId) && row.expiresAt > Date.now()));
  });
}
export async function removeRecoveryTurn(scope: RecoveryScope) {
  await transaction<void>("readwrite", store => {
    const request = store.openCursor(); request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      if (scopeId(cursor.value as RecoveryChunk) === scopeId(scope)) cursor.delete(); cursor.continue();
    };
  });
}
export async function purgeExpiredRecovery(now = Date.now()) {
  await transaction<void>("readwrite", store => {
    const request = store.openCursor(); request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      if ((cursor.value as RecoveryChunk).expiresAt <= now) cursor.delete(); cursor.continue();
    };
  });
}
