import Link from "next/link";
import { EvolutionLedger } from "@/components/EvolutionLedger";
import { PageIntro } from "@/components/PageIntro";
import { PublicPageData } from "@/components/PublicPageData";
import { publicMetadata } from "@/lib/public-discovery";

export const metadata = publicMetadata("/changelog");

export default function ChangelogPage() {
  return <article className="changelog-page">
    <PublicPageData path="/changelog" />
    <PageIntro title="Product changelog">A curated history of how Value Log is evolving as a calm, private practice. This is a public summary—not a feed of personal records or a claim about outcomes.</PageIntro>
    <aside className="changelog-boundary" id="latest"><p className="meta">Privacy boundary</p><p>The written ledger never reproduces personal narratives, identifiers, or synchronization history. Owner-authorized screenshots are illustrative product-evolution evidence, not representative data or outcome claims. Read the <Link href="/method">method and safeguards</Link> for the pilot&apos;s public operating model.</p></aside>
    <p className="changelog-ledger-note"><span>24 July 2026</span>This public history now reads as an Evolution Ledger. The historical milestones below remain available; their full visual evidence lives in the linked archive.</p>
    <nav className="changelog-index" aria-label="Changelog sections"><a href="#latest">Latest</a><a href="#ledger">Ledger</a><Link href="/changelog/archive">Visual archive</Link></nav>
    <p className="changelog-ledger-note"><time dateTime="2026-10-27">Updated 27 October 2026</time> · Internet of Value Research Foundation. <a href="https://identity.theinternetofvalue.org/changelog">Follow the connected Identity chronology</a> · <Link href="/method">Read the current voice logging and privacy guide</Link>.</p>
    <EvolutionLedger />
    <footer className="method-footer"><Link href="/method">Method and safeguards</Link><Link href="/changelog/archive">Open visual archive</Link><Link href="/day">Open private Value Log</Link></footer>
  </article>;
}
