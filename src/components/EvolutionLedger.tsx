import Image from "next/image";
import Link from "next/link";
import { chapterMilestones, chapters, milestones } from "@/lib/changelog-data";

export function EvolutionLedger() {
  const latest = milestones[0];
  return <section className="evolution-ledger" id="ledger" aria-labelledby="ledger-title">
    <header className="ledger-heading"><p className="meta">Evolution Ledger</p><h2 id="ledger-title">A public record, kept readable</h2><p>Five chapters trace how the private pilot became more legible without becoming a feed of private records.</p></header>
    <div className="ledger-index" aria-label="Ledger chapters">{chapters.map((chapter) => <a href={`#${chapter.id}`} key={chapter.id}>{chapter.title}</a>)}<Link href="/changelog/archive">Visual archive</Link></div>
    <div className="ledger-chapters">{chapters.map((chapter) => <section className="ledger-chapter" id={chapter.id} key={chapter.id}>
      <header><p className="meta">Chapter</p><h3>{chapter.title}</h3><p>{chapter.summary}</p></header>
      <ol>{chapterMilestones(chapter.id).map((milestone) => <li key={milestone.id}><details name="evolution-ledger" open={milestone.id === latest.id}>
        <summary><time>{milestone.date}</time><span><strong>{milestone.title}</strong><small>{milestone.summary}</small></span><i>{milestone.proof ? "Visual proof" : "Record"}</i></summary>
        <div className="ledger-folio"><div><p className="meta">What changed</p><p>{milestone.summary}</p></div><div><p className="meta">Boundary preserved</p><p>{milestone.boundary}</p></div>
          {milestone.proof ? <figure><div className="ledger-proof"><Image alt={milestone.proof.alt} fill sizes="(max-width: 760px) 88vw, 390px" src={milestone.proof.src} /></div><figcaption>Illustrative private-pilot interface evidence, not representative data or an outcome claim.</figcaption></figure> : null}
          <Link className="ledger-archive-link" href="/changelog/archive#evolution-gallery-title">View this chapter’s visual evidence <span aria-hidden="true">→</span></Link>
        </div>
      </details></li>)}</ol>
    </section>)}</div>
  </section>;
}
