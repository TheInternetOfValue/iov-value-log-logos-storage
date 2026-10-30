import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectMemberDay, type MemberDaySource } from "./day-projection";
import { dateSchema } from "./entries";
import { FOUNDER_POLICY_ID } from "@/lib/founder-wellbeing";

/** Read the owner's existing canonical ledger; never initialise a cohort score. */
export async function founderDayProjection(
  client: SupabaseClient,
  owner: string,
  date: string,
) {
  dateSchema.parse(date);
  const start = `${date}T00:00:00+05:30`,
    end = new Date(Date.parse(start) + 86400000).toISOString();
  const sources: MemberDaySource[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await client
      .from("current_time_slices")
      .select(
        "id,owner_id,activity,wellbeing_node,start_at,end_at,status",
      )
      .eq("owner_id", owner)
      .lt("start_at", end)
      .gt("end_at", start)
      .order("start_at")
      .order("id")
      .range(offset, offset + 99);
    if (page.error) throw new Error("UNAVAILABLE");
    const refs = page.data.length ? await client.from("canonical_slices").select("id,activity_occurrence_id").eq("owner_id", owner).in("id", page.data.map(row => row.id)) : { data: [], error: null };
    if (refs.error) throw new Error("UNAVAILABLE");
    const occurrences = new Map((refs.data ?? []).map(row => [row.id, row.activity_occurrence_id]));
    for (const row of page.data)
      sources.push({
        ownerId: row.owner_id,
        sourceId: row.id,
        occurrenceId: occurrences.get(row.id) ?? row.id,
        activity: row.activity,
        node: row.wellbeing_node,
        start: row.start_at,
        end: row.end_at,
        state:
          row.status === "calculated"
            ? "reviewed"
            : row.status === "validation_rejected"
              ? "clarification"
              : "pending",
      });
    if (page.data.length < 100) break;
  }
  const promoted = await client
    .from("current_promoted_founder_replay")
    .select("replay_run_id,baseline_effective_at,baseline_wellbeing_score")
    .eq("owner_id", owner)
    .eq("mode", "founder_v0_1_live")
    .maybeSingle();
  if (promoted.error) throw new Error("UNAVAILABLE");
  const run = promoted.data;
  type Event = {
    w_before: number | string;
    w_after: number | string;
    policy_id: string;
    canonical_slices:
      | { start_at: string; end_at: string }
      | Array<{ start_at: string; end_at: string }>
      | null;
  };
  const events: Event[] = [];
  if (run)
    for (let offset = 0; ; offset += 100) {
      const page = await client
        .from("founder_wellbeing_value_events")
        .select(
          "w_before,w_after,policy_id,canonical_slices!inner(start_at,end_at)",
        )
        .eq("owner_id", owner)
        .eq("replay_run_id", run.replay_run_id)
        .lt("canonical_slices.end_at", end)
        .order("id")
        .range(offset, offset + 99);
      if (page.error) throw new Error("UNAVAILABLE");
      events.push(...(page.data as Event[]));
      if (page.data.length < 100) break;
    }
  const completed = events
    .flatMap((event) => {
      const source = Array.isArray(event.canonical_slices)
        ? event.canonical_slices[0]
        : event.canonical_slices;
      return source ? [{ ...event, end: Date.parse(source.end_at) }] : [];
    })
    .sort((a, b) => a.end - b.end);
  const canonical = Boolean(
    run && Date.parse(start) >= Date.parse(run.baseline_effective_at),
  );
  const opening = canonical
    ? Number(
        completed.filter((event) => event.end <= Date.parse(start)).at(-1)
          ?.w_after ?? run!.baseline_wellbeing_score,
      )
    : null;
  const current = canonical
    ? Number(completed.at(-1)?.w_after ?? opening)
    : null;
  return {
    ...projectMemberDay(owner, date, sources),
    score: {
      status: "founder",
      opening,
      current,
      completedMovement:
        opening !== null && current !== null
          ? Number((current - opening).toFixed(12))
          : null,
      policy: canonical
        ? (completed.at(-1)?.policy_id ?? FOUNDER_POLICY_ID)
        : null,
      unavailableReason: canonical
        ? null
        : "existing_founder_history_uses_original_day_reading",
    },
    recovery: { audio: "device_only_if_saved", maxAgeHours: 24 },
  };
}
