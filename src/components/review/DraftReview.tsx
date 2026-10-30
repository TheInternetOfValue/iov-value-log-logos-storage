import Link from "next/link";
import { observerDecision } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { earliestOpenDate, isChronologicallyEligible } from "@/lib/chronology";
import { formatLocalDateTime, formatLocalTime } from "@/lib/format";
import { pageSession } from "@/lib/page-auth";

export async function DraftReview() {
  const { client } = await pageSession();
  const [{ data: drafts }, { data: pending }] = await Promise.all([
    client.from("draft_slices")
      .select("id,start_at,end_at,timezone,activity,proof,wellbeing_node,slice_type,community")
      .eq("status", "drafted").order("start_at").limit(100),
    client.from("canonical_slices").select("start_at,timezone").eq("status", "validation_pending").order("start_at").limit(100),
  ]);
  const openDate = earliestOpenDate([...(drafts ?? []), ...(pending ?? [])]);
  return <div className="grid">{drafts?.length ? drafts.map((slice) => {
    const eligible = isChronologicallyEligible(slice, openDate);
    return <article className={`card${eligible ? "" : " review-disabled"}`} key={slice.id}>
    <div><span className="badge">{slice.slice_type}</span><span className="badge orange">{slice.wellbeing_node}</span><span className="badge">{slice.community}</span></div>
    <h2>{slice.activity}</h2>
    <p className="meta">{formatLocalDateTime(slice.start_at, slice.timezone)}–{formatLocalTime(slice.end_at, slice.timezone)}</p>
    <p>{slice.proof || "No proof proposed."}</p>
    <div className="actions"><Link className="button secondary" href={`/slices/${slice.id}`}>Edit interpretation</Link></div>
    {!eligible ? <p className="notice">Complete earlier records first so calculations remain chronological.</p> : null}
    <form action={observerDecision} className="stack" style={{ marginTop: 18 }}>
      <input type="hidden" name="draft_id" value={slice.id} />
      <label>Optional note<textarea name="rationale" placeholder="Only add a note if something needs explanation." /></label>
      <div className="actions">
        <SubmitButton disabled={!eligible} name="decision" value="approved" idle="Keep" pending="Confirming log…" />
        <button disabled={!eligible} className="secondary" name="decision" value="rejected">Reject / remove draft</button>
      </div>
    </form>
  </article>}) : <div className="empty">No drafts await observer review.</div>}</div>;
}
