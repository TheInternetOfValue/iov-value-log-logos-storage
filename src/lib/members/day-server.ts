import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectMemberDay, type MemberDaySource } from "./day-projection";
import { entryColumns, readMemberEntry } from "./storage";
import {
  nativeColumns,
  readNativeContent,
  type NativeRow,
} from "@/lib/native-log/storage-core";
import { cohortSnapshot } from "@/lib/cohort/server";
import { dateSchema } from "./entries";
import { formatWMovement } from "@/lib/w-presentation";
type IndexRow = {
  native_draft_id: string;
  activity_id: string;
  occurrence_id: string;
  source_id: string;
  source_kind: "native" | "member" | "cohort" | "adopted";
  start_at: string | null;
  end_at: string | null;
  outcome: MemberDaySource["state"];
  created_at: string;
  member_entry_ids: string[];
};
export async function memberDayProjection(
  client: SupabaseClient,
  owner: string,
  date: string,
  suppliedCohort?: Awaited<ReturnType<typeof cohortSnapshot>>,
) {
  dateSchema.parse(date);
  const start = `${date}T00:00:00+05:30`,
    end = new Date(Date.parse(start) + 86400000).toISOString();
  const sources: MemberDaySource[] = [],
    index: IndexRow[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await client
      .from("native_log_day_index")
      .select(
        "native_draft_id,activity_id,occurrence_id,source_id,source_kind,start_at,end_at,outcome,created_at,member_entry_ids",
      )
      .eq("owner_id", owner)
      .is("superseded_at", null)
      .or(`and(start_at.lt.${end},end_at.gt.${start}),note_date.eq.${date}`)
      .order("native_draft_id")
      .order("occurrence_id")
      .range(offset, offset + 99);
    if (page.error) throw new Error("UNAVAILABLE");
    index.push(...(page.data as IndexRow[]));
    if (page.data.length < 100) break;
  }
  const cohort =
    suppliedCohort === undefined ? await cohortSnapshot(owner) : suppliedCohort;
  const completedMovement = new Map(
    cohort?.state.events.map((event) => [
      event.recordId,
      formatWMovement(event.delta),
    ]) ?? [],
  );
  const records = new Map(
    cohort?.records.map((record) => [record.id, record]) ?? [],
  );
  const draftIds = [...new Set(index.filter(row => row.source_kind !== "member").map((row) => row.native_draft_id))];
  for (let offset = 0; offset < draftIds.length; offset += 50) {
    const rows = await client
      .from("native_log_drafts")
      .select(nativeColumns)
      .eq("owner_id", owner)
      .in("id", draftIds.slice(offset, offset + 50));
    if (rows.error) throw new Error("UNAVAILABLE");
    for (const raw of rows.data as unknown as NativeRow[]) {
      if (!raw.content_ciphertext) continue; // Explicitly removed private source.
      const content = readNativeContent(
        raw.status === "removed" && raw.receipt?.sourceReferenced
          ? { ...raw, status: "submitted" }
          : raw,
      );
      for (const row of index.filter((i) => i.native_draft_id === raw.id)) {
        const record = records.get(row.source_id);
        if (record?.review_status === "superseded") continue;
        const activity = content.document.activities.find(
          (a) => a.id === row.activity_id,
        );
        if (!activity) throw new Error("DAY_SOURCE_INCOMPLETE");
        sources.push({
          ownerId: owner,
          versionPriority: 2,
          sourceId: row.source_id,
          occurrenceId: row.occurrence_id,
          activity: activity.activity,
          node: activity.node || null,
          start: row.start_at,
          end: row.end_at,
          movement: completedMovement.get(row.source_id),
          state: record
            ? record.review_status === "reviewed"
              ? "reviewed"
              : record.review_status === "pending"
                ? "pending"
                : "clarification"
            : row.outcome,
        });
      }
    }
  }
  // Legacy cohort rows retain structured instants; old free-text member notes do not.
  for (const record of cohort?.records ?? []) {
    if (
      record.review_status === "superseded" ||
      sources.some((source) => source.sourceId === record.id)
    )
      continue;
    sources.push({
      ownerId: owner,
      versionPriority: 2,
      sourceId: record.id,
      occurrenceId: record.occurrence_id,
      activity: record.activity.activity,
      node: record.activity.node,
      start: record.start_at,
      end: record.end_at,
      movement: completedMovement.get(record.id),
      state:
        record.review_status === "reviewed"
          ? "reviewed"
          : record.review_status === "pending"
            ? "pending"
            : "clarification",
    });
  }
  for (let offset = 0; ; offset += 100) {
    const page = await client
      .from("member_activity_entries")
      .select(entryColumns)
      .eq("owner_id", owner)
      .eq("activity_date", date)
      .is("removed_at", null)
      .order("id")
      .range(offset, offset + 99);
    if (page.error) throw new Error("UNAVAILABLE");
    for (const raw of page.data) {
      const entry = readMemberEntry(raw);
      if (!("text" in entry)) continue;
      const linked = index.find(row => row.member_entry_ids?.includes(entry.id));
      if (linked?.source_kind === "member") {
        // The legacy confirmed entry owns its content/removal; the index supplies only approved clocks.
        sources.push({ ownerId: owner, versionPriority: 1, sourceId: linked.source_id, occurrenceId: linked.occurrence_id, activity: entry.text, node: entry.node, start: linked.start_at, end: linked.end_at, state: "unassessed" });
      } else if (!linked) sources.push({ ownerId: owner, sourceId: entry.id, occurrenceId: entry.id, activity: entry.text, node: entry.node, state: "unassessed" });
    }
    if (page.data.length < 100) break;
  }
  const events = cohort?.state.events ?? [];
  const opening =
    events.filter((event) => Date.parse(event.end) < Date.parse(start)).at(-1)
      ?.after ??
    (cohort && Date.parse(start) >= Date.parse(cohort.enrollment.boundary_at)
      ? 700
      : null);
  const closing =
    events.filter((event) => Date.parse(event.end) < Date.parse(end)).at(-1)
      ?.after ?? opening;
  return {
    ...projectMemberDay(owner, date, sources),
    score: {
      status: cohort ? "provisional" : "unassessed",
      opening,
      current: closing,
      completedMovement:
        opening !== null && closing !== null
          ? Number((closing - opening).toFixed(12))
          : null,
      policy: cohort?.enrollment.policy_id ?? null,
    },
    recovery: { audio: "device_only_if_saved", maxAgeHours: 24 },
    cohort,
  };
}
