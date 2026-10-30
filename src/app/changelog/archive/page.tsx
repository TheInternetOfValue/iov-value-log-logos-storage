import type { Metadata } from "next";
import Link from "next/link";
import { EvolutionGallery } from "@/components/EvolutionGallery";
import { PageIntro } from "@/components/PageIntro";
import { VisualEvolution } from "@/components/VisualEvolution";

export const metadata: Metadata = { title: "Value Log visual changelog archive", description: "Public-safe illustrative interface evidence from the Value Log pilot.", robots: { index: false, follow: false } };

export default function ChangelogArchivePage() {
  return <article className="changelog-page changelog-archive"><PageIntro title="Visual changelog archive">Historical screenshots are omitted from this public source review. Gallery code is retained with labelled placeholders; use the synthetic dataset to inspect the running interface.</PageIntro><p className="archive-back"><Link href="/changelog">← Return to the Evolution Ledger</Link></p><VisualEvolution /><EvolutionGallery /></article>;
}
