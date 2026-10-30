import Link from "next/link";
import { deleteNarrative } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { decryptNarrative } from "@/lib/crypto";
import { formatLocalDateTime, localDateFor } from "@/lib/format";
import { pageSession } from "@/lib/page-auth";

type Intake = {
  id: string;
  received_at: string;
  timezone: string;
  narrative_ciphertext: string | null;
  narrative_iv: string | null;
  narrative_auth_tag: string | null;
  narrative_deleted_at: string | null;
  draft_slices: Array<{ id: string; start_at: string; activity: string }>;
};

export async function SourceSubmissions({ date, reveal }: { date?: string; reveal?: string }) {
  const { client } = await pageSession();
  const { data } = await client.from("intake_sessions").select("id,received_at,timezone,narrative_ciphertext,narrative_iv,narrative_auth_tag,narrative_deleted_at,draft_slices(id,start_at,activity)").order("received_at", { ascending: false }).limit(100);
  const intakes = ((data ?? []) as Intake[]).filter((intake) => !date || intake.draft_slices.some((slice) => localDateFor(slice.start_at, intake.timezone) === date));

  return <div className="source-submissions">{intakes.length ? intakes.map((intake) => {
    const dates = [...new Set(intake.draft_slices.map((slice) => localDateFor(slice.start_at, intake.timezone)))].sort();
    const isRevealed = reveal === intake.id;
    let narrative = "The encrypted narrative has been deleted. Its keyed digest and protocol history remain for integrity.";
    if (isRevealed && !intake.narrative_deleted_at && intake.narrative_ciphertext && intake.narrative_iv && intake.narrative_auth_tag) {
      try { narrative = decryptNarrative({ ciphertext: intake.narrative_ciphertext, iv: intake.narrative_iv, authTag: intake.narrative_auth_tag }); }
      catch { narrative = "The narrative cannot be decrypted with the active key version."; }
    }
    const baseHref = `/privacy${date ? `?date=${date}` : ""}`;
    const revealHref = `/privacy?${new URLSearchParams({ ...(date ? { date } : {}), reveal: intake.id }).toString()}#source-${intake.id}`;
    return <article className="card source-submission" id={`source-${intake.id}`} key={intake.id}>
      <div className="source-submission-heading"><div><p className="meta">Received {formatLocalDateTime(intake.received_at, intake.timezone)}</p><h2>{intake.draft_slices.length} ValueLog{intake.draft_slices.length === 1 ? "" : "s"} generated</h2></div>{dates.map((value) => <Link href={`/day?date=${value}`} key={value}>{value}</Link>)}</div>
      {intake.narrative_deleted_at ? <details className="raw-narrative"><summary>Narrative deleted</summary><div className="raw">{narrative}</div></details> : isRevealed ? <div className="revealed-narrative"><div className="raw">{narrative}</div><Link href={baseHref}>Hide narrative</Link></div> : <Link className="reveal-narrative" href={revealHref}>Reveal original private narrative</Link>}
      {!intake.narrative_deleted_at ? <form action={deleteNarrative} className="actions"><input type="hidden" name="intake_session_id" value={intake.id} /><SubmitButton className="secondary" idle="Delete encrypted narrative" pending="Deleting encrypted narrative…" confirmMessage="Delete the encrypted narrative? Its keyed digest and protocol history will remain." /></form> : <p className="meta deletion-state">Deleted narrative cannot be recovered. The keyed digest and append-only protocol history remain.</p>}
    </article>;
  }) : <div className="empty">No source submissions{date ? " for this date" : ""}.</div>}</div>;
}
