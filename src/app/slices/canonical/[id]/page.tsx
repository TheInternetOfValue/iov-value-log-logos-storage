import { notFound } from "next/navigation";
import { removeCanonicalDuplicate, reviseCanonicalSlice } from "@/app/actions";
import { PageIntro } from "@/components/PageIntro";
import { SetupRequired } from "@/components/SetupRequired";
import { isConfigured } from "@/lib/env";
import { logosDemoEnabled } from "@/lib/logos-demo";
import { pageSession } from "@/lib/page-auth";
import { formatLocalDateTimeInput } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { canRemoveCanonicalDuplicate } from "@/lib/canonical-lifecycle";

const choices = (items: string[]) => items.map((item) => <option key={item} value={item}>{item}</option>);

export default async function CanonicalRevisionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured() && !logosDemoEnabled()) return <SetupRequired />;
  const { client } = await pageSession();
  const { data: slice } = await client.from("canonical_slices").select("*").eq("id", (await params).id).single();
  if (!slice) notFound();
  const removable = canRemoveCanonicalDuplicate(slice.status);
  return <section>
    <PageIntro title="Correct activity">Edit the activity in India Standard Time. It will return to community confirmation before being recalculated.</PageIntro>
    <div className="warning">ProtocolLinkId {slice.protocol_link_id} · current revision {slice.revision_number}. Saving creates a new revision, supersedes this active revision, and returns only the replacement to community-role confirmation. Historical events are not mutated.</div>
    <form action={reviseCanonicalSlice} className="stack card" style={{marginTop:20}}>
      <input type="hidden" name="canonical_slice_id" value={slice.id} />
      <input type="hidden" name="timezone" value="Asia/Kolkata" />
      <div className="grid two">
        <label>Start time (IST)<input type="datetime-local" name="start_local" defaultValue={formatLocalDateTimeInput(slice.start_at)} required /></label>
        <label>End time (IST)<input type="datetime-local" name="end_local" defaultValue={formatLocalDateTimeInput(slice.end_at)} required /></label>
      </div>
      <p className="status-note"><strong>Timezone:</strong> India Standard Time (Asia/Kolkata, UTC+05:30)</p>
      <label>Activity<input name="activity" defaultValue={slice.activity} /></label>
      <label>Proof<textarea name="proof" defaultValue={slice.proof ?? ""} /></label>
      <div className="grid two">
        <label>Node<select name="wellbeing_node" defaultValue={slice.wellbeing_node}>{choices(["Physiology","Emotion","Feeling","Thought","Habit","Performance"])}</select></label>
        <label>Type<select name="slice_type" defaultValue={slice.slice_type}>{choices(["non_performance","performance"])}</select></label>
        <label>Community<select name="community" defaultValue={slice.community}>{choices(["house_of_bros","iov","gfe"])}</select></label>
        <label>SAO lane<select name="sao_lane" defaultValue={slice.sao_lane ?? ""}><option value="">N/A</option>{choices(["Learning","Earning","OrgBuilding"])}</select></label>
        <label>Skill level<select name="skill_level" defaultValue={slice.skill_level ?? ""}><option value="">N/A</option>{choices(["L0","L1","L2","L3","L4"])}</select></label>
        <label>Direction<select name="impact_direction" defaultValue={slice.impact_direction ?? ""}><option value="">N/A</option>{choices(["positive","neutral","negative"])}</select></label>
        <label>Intensity<select name="impact_intensity" defaultValue={slice.impact_intensity ?? ""}><option value="">N/A</option>{choices(["low","medium","high"])}</select></label>
        <label>Confidence<select name="confidence" defaultValue={slice.confidence ?? ""}><option value="">N/A</option>{choices(["observed","inferred","uncertain"])}</select></label>
      </div>
      <SubmitButton idle="Save correction" pending="Saving correction…" />
    </form>
    {removable ? <form action={removeCanonicalDuplicate} className="stack card removal-card" style={{marginTop:16}}>
      <input type="hidden" name="canonical_slice_id" value={slice.id} />
      <div><h2>Remove duplicate</h2><p className="meta">This removes the activity from the current day and reverses any calculation. The audit record remains for integrity.</p></div>
      <SubmitButton className="danger" idle="Remove duplicate" pending="Removing duplicate…"
        confirmMessage="This removes the activity from the current day and reverses any calculation. The audit record remains for integrity." />
    </form> : null}
  </section>;
}
