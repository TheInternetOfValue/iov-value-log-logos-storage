import "server-only";
import { decryptNarrative } from "@/lib/crypto";
import { entrySchema, type SavedMemberEntry } from "./entries";
export const entryColumns = "id,revision,activity_date,wellbeing_node,content_ciphertext,content_iv,content_auth_tag,created_at,updated_at,removed_at";
export function readMemberEntry(row: Record<string, unknown>): SavedMemberEntry | { id: string; revision: number; removedAt: string } {
  if (row.removed_at) return { id: String(row.id), revision: Number(row.revision), removedAt: String(row.removed_at) };
  const raw = JSON.parse(decryptNarrative({ ciphertext: String(row.content_ciphertext), iv: String(row.content_iv), authTag: String(row.content_auth_tag) }));
  const entry = entrySchema.parse({ ...raw, id: row.id, revision: row.revision });
  if (entry.date !== row.activity_date || entry.node !== row.wellbeing_node) throw new Error("INVALID_ENTRY");
  return { ...entry, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
