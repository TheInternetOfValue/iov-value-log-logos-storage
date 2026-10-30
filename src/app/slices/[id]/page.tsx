import { notFound } from "next/navigation";
import Link from "next/link";
import { rejectDraft, saveDraft } from "@/app/actions";
import { PageIntro } from "@/components/PageIntro";
import { SetupRequired } from "@/components/SetupRequired";
import { isConfigured } from "@/lib/env";
import { logosDemoEnabled } from "@/lib/logos-demo";
import { pageSession } from "@/lib/page-auth";
import { SubmitButton } from "@/components/SubmitButton";
import { formatLocalDateTimeInput } from "@/lib/format";

const options = (values: string[]) => values.map((value) => <option value={value} key={value}>{value}</option>);

export default async function SliceEditorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured() && !logosDemoEnabled()) return <SetupRequired />;
  const { id } = await params;
  const { client } = await pageSession();
  const { data: slice } = await client.from("draft_slices").select("*").eq("id", id).single();
  if (!slice) notFound();
  const { data: canonical } = await client.from("canonical_slices")
    .select("id,status,revision_number")
    .eq("draft_slice_id", slice.id)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const editable = slice.status === "drafted";
  return <section>
    <PageIntro title={editable ? "Check this draft" : "Confirmed log"}>{editable ? "Correct the machine proposal before you confirm it." : "This draft has already been confirmed and is locked to preserve its audit history."}</PageIntro>
    {!editable ? <div className="warning" style={{marginBottom:20}}>
      Saving is unavailable because this is no longer a draft. Nothing is broken.
      <div className="actions" style={{marginTop:12}}>
        {canonical ? <Link className="button" href={`/slices/canonical/${canonical.id}`}>Create a correction</Link> : null}
        <Link className="button secondary" href="/day">Return to Today</Link>
      </div>
    </div> : null}
    <form action={saveDraft} className="stack card">
      <input type="hidden" name="id" value={slice.id} />
      <input type="hidden" name="timezone" value="Asia/Kolkata" />
      <div className="grid two">
        <label>Start time (IST)<input type="datetime-local" name="start_local" defaultValue={formatLocalDateTimeInput(slice.start_at)} required disabled={!editable} /></label>
        <label>End time (IST)<input type="datetime-local" name="end_local" defaultValue={formatLocalDateTimeInput(slice.end_at)} required disabled={!editable} /></label>
      </div>
      <p className="status-note"><strong>Timezone:</strong> India Standard Time (Asia/Kolkata, UTC+05:30)</p>
      <label>Activity<input name="activity" defaultValue={slice.activity} required disabled={!editable} /></label>
      <label>Proof<textarea name="proof" defaultValue={slice.proof ?? ""} disabled={!editable} /></label>
      <div className="grid two">
        <label>Node<select name="wellbeing_node" defaultValue={slice.wellbeing_node} disabled={!editable}>{options(["Physiology","Emotion","Feeling","Thought","Habit","Performance"])}</select></label>
        <label>Slice type<select name="slice_type" defaultValue={slice.slice_type} disabled={!editable}>{options(["non_performance","performance"])}</select></label>
        <label>Community<select name="community" defaultValue={slice.community} disabled={!editable}>{options(["house_of_bros","iov","gfe"])}</select></label>
        <label>SAO lane<select name="sao_lane" defaultValue={slice.sao_lane ?? ""} disabled={!editable}><option value="">Not applicable</option>{options(["Learning","Earning","OrgBuilding"])}</select></label>
        <label>Skill level<select name="skill_level" defaultValue={slice.skill_level ?? ""} disabled={!editable}><option value="">Not applicable</option>{options(["L0","L1","L2","L3","L4"])}</select></label>
        <label>Direction<select name="impact_direction" defaultValue={slice.impact_direction ?? ""} disabled={!editable}><option value="">Not applicable</option>{options(["positive","neutral","negative"])}</select></label>
        <label>Intensity<select name="impact_intensity" defaultValue={slice.impact_intensity ?? ""} disabled={!editable}><option value="">Not applicable</option>{options(["low","medium","high"])}</select></label>
        <label>Confidence<select name="confidence" defaultValue={slice.confidence ?? ""} disabled={!editable}><option value="">Not applicable</option>{options(["observed","inferred","uncertain"])}</select></label>
      </div>
      {editable ? <SubmitButton idle="Save corrections" pending="Saving corrections…" /> : null}
    </form>
    {editable ? <form action={rejectDraft} className="stack card removal-card" style={{marginTop:16}}>
      <input type="hidden" name="draft_id" value={slice.id} />
      <div><h2>Reject / remove draft</h2><p className="meta">This removes the draft from review while preserving its observer and audit records.</p></div>
      <SubmitButton className="danger" idle="Reject / remove draft" pending="Removing draft…"
        confirmMessage="This removes the draft from review. The audit record remains for integrity." />
    </form> : null}
  </section>;
}
