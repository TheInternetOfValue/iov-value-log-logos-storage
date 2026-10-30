import type { NativeSession, NativeRow } from "@/lib/native-log/server";
import { nativeColumns, readNativeContent } from "@/lib/native-log/server";
import { memberWriteBinding } from "@/lib/members/http";
import { ReadbackTable } from "./ReadbackTable";
import { longDate, spokenTimeText } from "./flow/flow-model";
import { SourceDraftButton } from "./SourceDraftButton";
export async function UnassessedSubmissions({
  session,
  page = 0,
  day,
}: {
  session: NativeSession;
  page?: number;
  day?: string;
}) {
  let query = session.client
    .from("native_log_day_index")
    .select("source_id,native_draft_id,activity_id,outcome")
    .eq("owner_id", session.user.id)
    .neq("source_kind", "cohort")
    .is("superseded_at", null);
  if (day) {
    const start = `${day}T00:00:00+05:30`;
    const end = new Date(Date.parse(start) + 86400000).toISOString();
    query = query.or(`and(start_at.lt.${end},end_at.gt.${start}),note_date.eq.${day}`);
  }
  const result = await query.order("created_at", { ascending: false })
    .order("source_id")
    .range(page * 20, page * 20 + 19);
  if (result.error)
    return (
      <p>
        Private submitted logs could not load. Your saved records remain
        available.
      </p>
    );
  const ids = [...new Set(result.data.map((row) => row.native_draft_id))];
  if (!ids.length) return null;
  const sources = await session.client
    .from("native_log_drafts")
    .select(nativeColumns)
    .eq("owner_id", session.user.id)
    .in("id", ids);
  if (sources.error)
    return <p>Private submitted logs could not load. Try again.</p>;
  return (
    <section className="native-log review-history">
      <header className="review-history-heading"><p>YOUR ACTIVITY</p><h2>Saved activities</h2><span>Private logs and activities waiting for more detail.</span></header>
      <div className="review-history-list">
      {result.data.map((index) => {
        const row = (sources.data as unknown as NativeRow[]).find(
          (row) => row.id === index.native_draft_id,
        );
        if (
          !row?.content_ciphertext ||
          (row.status === "removed" && !row.receipt?.sourceReferenced)
        )
          return null;
        const content = readNativeContent(
            row.status === "removed" ? { ...row, status: "submitted" } : row,
          ),
          activity = content.document.activities.find(
            (activity) => activity.id === index.activity_id,
          );
        if (!activity) return null;
        return (
          <article className="review-history-card" key={index.source_id} id={`record-${index.source_id}`}>
            <div className="review-history-card-top"><time dateTime={content.document.date}>{longDate(content.document.date)}</time><span className={index.outcome === "clarification" ? "review-history-status needs-detail" : "review-history-status"}>{index.outcome === "clarification" ? "Needs detail" : "Private · unassessed"}</span></div>
            <h3>{activity.activity}</h3>
            <p className="review-history-meta">{spokenTimeText(activity) ?? "Time not stated"}{activity.node ? ` · ${activity.node}` : ""}</p>
            {index.outcome === "clarification" ? <p className="review-history-explanation">More detail is needed before assessment. Your last calculated score is preserved.</p> : null}
            <details className="review-history-details"><summary>View details</summary><ReadbackTable document={{ ...content.document, activities: [activity] }} /></details>
            <div className="review-history-action"><SourceDraftButton action="continue" sourceId={index.source_id} binding={memberWriteBinding(session.user.id)} /></div>
          </article>
        );
      })}
      </div>
      {result.data.length === 20 ? (
        <a href={`/review?${day ? `date=${day}&` : ""}privatePage=${page + 1}`}>More private logs</a>
      ) : null}
    </section>
  );
}
