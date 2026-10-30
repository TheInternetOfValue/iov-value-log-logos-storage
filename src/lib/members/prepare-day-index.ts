// Trusted maintenance core. The encryption setting stays in the existing runtime.
import { adminClient } from "@/lib/supabase/admin-core";
import { nativeColumns, type NativeRow } from "@/lib/native-log/storage-core";
import { legacyNativeDayIndex } from "./native-day-index";

export type DayIndexCursor = { owner: string; id: string; cutoff: string };
export async function prepareDayIndex(
  apply: boolean,
  cursor: DayIndexCursor | null,
) {
  if (
    Buffer.from(process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 ?? "", "base64")
      .length !== 32
  )
    throw new Error("UNAVAILABLE");
  const db = adminClient(),
    cutoff = cursor?.cutoff ?? new Date().toISOString();
  let query = db
    .from("native_log_drafts")
    .select(`owner_id,${nativeColumns}`)
    .eq("status", "submitted")
    .eq("receipt->>kind", "unassessed")
    .lte("submitted_at", cutoff)
    .order("owner_id")
    .order("id");
  if (cursor)
    query = query.or(
      `owner_id.gt.${cursor.owner},and(owner_id.eq.${cursor.owner},id.gt.${cursor.id})`,
    );
  const page = await query.limit(20);
  if (page.error) throw new Error("UNAVAILABLE");
  const metrics = {
    inspected: 0,
    indexedOccurrences: 0,
    needsOperatorReview: 0,
  };
  const existing = new Set<string>();
  if (page.data.length)
    for (let offset = 0; ; offset += 500) {
      const indexed = await db
        .from("native_log_day_index")
        .select("owner_id,native_draft_id,occurrence_id")
        .in(
          "native_draft_id",
          page.data.map((row) => row.id),
        )
        .order("owner_id")
        .order("native_draft_id")
        .order("occurrence_id")
        .range(offset, offset + 499);
      if (indexed.error) throw new Error("UNAVAILABLE");
      for (const item of indexed.data)
        existing.add(
          `${item.owner_id}:${item.native_draft_id}:${item.occurrence_id}`,
        );
      if (indexed.data.length < 500) break;
    }
  for (const row of page.data) {
    metrics.inspected++;
    let entries;
    try {
      entries = legacyNativeDayIndex(row as unknown as NativeRow).filter(
        (entry) =>
          !existing.has(`${row.owner_id}:${row.id}:${entry.occurrenceId}`),
      );
    } catch {
      metrics.needsOperatorReview++;
      continue;
    }
    if (apply && entries.length) {
      const saved = await db.rpc("index_legacy_native_day", {
        p_owner: row.owner_id,
        p_id: row.id,
        p_entries: entries,
      });
      if (saved.error) {
        metrics.needsOperatorReview++;
        continue;
      }
      const count = Number(saved.data);
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error("UNAVAILABLE");
      metrics.indexedOccurrences += count;
    } else metrics.indexedOccurrences += entries.length;
  }
  const last = page.data.at(-1);
  return {
    apply,
    metrics,
    next:
      page.data.length === 20 && last
        ? { owner: String(last.owner_id), id: String(last.id), cutoff }
        : null,
  };
}
