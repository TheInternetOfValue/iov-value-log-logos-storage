import { activityInstants } from "@/lib/native-log/draft";
import { sleepSegments } from "@/lib/native-log/time";
import { readNativeContent, type NativeRow } from "@/lib/native-log/storage-core";
/** Only typed, already-approved legacy native source can supply legacy clocks. */
export function legacyNativeDayIndex(row: NativeRow) {
  if (row.status !== "submitted" || row.receipt?.kind !== "unassessed" || row.receipt.dayIndexVersion === 1) return [];
  const document = readNativeContent(row).document;
  if (document.mode !== "personal") return [];
  let cursor = 0;
  const rows = document.activities.map(activity => {
    const { start, end } = activityInstants(activity, document.timezone);
    if (!start || !end) throw new Error("LEGACY_INDEX_REVIEW_REQUIRED");
    const segments = sleepSegments(start, end, document.timezone, activity.sleepRest);
    const memberIds = row.receipt!.ids.slice(cursor, cursor + segments.length); cursor += segments.length;
    if (memberIds.length !== segments.length) throw new Error("LEGACY_INDEX_REVIEW_REQUIRED");
    return { occurrenceId: activity.id, activityId: activity.id, sourceId: memberIds[0], memberEntryIds: memberIds, start, end };
  });
  if (cursor !== row.receipt.ids.length || cursor !== row.receipt.count) throw new Error("LEGACY_INDEX_REVIEW_REQUIRED");
  return rows;
}
