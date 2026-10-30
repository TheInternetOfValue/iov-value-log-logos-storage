"use client";

import { useState } from "react";
import { WellbeingIdentityRenderer } from "@theinternetofvalue/wellbeing-identity-renderer";
import type { OwnerWellbeingIdentityProjection, WellbeingIdentityNode } from "@theinternetofvalue/wellbeing-identity-contracts";
import { FacetPresenter } from "@/components/FacetPresenter";
import { wellbeingIdentityHomeUrl } from "@/lib/identity";

export function PrivateIdentityProfile({ projection, currentW, performanceCredits }: { projection: OwnerWellbeingIdentityProjection | null; currentW: number | null; performanceCredits: number | null }) {
  const [selected, setSelected] = useState<WellbeingIdentityNode>("~~IdentityState");
  const [preview, setPreview] = useState<WellbeingIdentityNode | null>(null);
  if (!projection) return <section className="private-identity-unavailable card"><p className="meta">Private identity portrait</p><h2>Your identity profile is unavailable</h2><p>The owner-authorised identity projection could not be read. Check that the secure connection and owner authorisation are available; your activities, canonical WellbeingScore, and public projection controls remain separate and unchanged.</p><a className="button secondary" href={wellbeingIdentityHomeUrl()}>Manage my Wellbeing Identity</a></section>;
  const selectedNode = projection.nodes.find((candidate) => candidate.path === selected) ?? projection.nodes[6];
  const previewedNode = preview ? projection.nodes.find((candidate) => candidate.path === preview) ?? null : null;
  const glanceNode = previewedNode ?? selectedNode;
  return <section className="private-identity-portrait" aria-labelledby="private-identity-title">
    <div className="private-identity-intro"><p className="meta">Private Wellbeing Identity</p><h1 id="private-identity-title">{projection.displayName}</h1><p>One private identity portrait. Hover or focus to glance; select a ring to open its authorised facets.</p></div>
    <div className="private-identity-layout">
      <div className="private-identity-render" onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}><WellbeingIdentityRenderer projection={projection} profile="replay" activeNode={selected} previewNode={preview} onNodePreview={setPreview} onNodePreviewEnd={() => setPreview(null)} onNodeSelect={(node) => { setSelected(node); setPreview(null); }} /><div className="private-identity-state"><span>Current canonical state</span><strong>{currentW === null ? "No completed state" : `${currentW.toFixed(3)} W`}</strong><small>HouseOfBros WellbeingScore · Founder Policy v0.1</small></div></div>
      <aside className="private-ring-reading">
        <div className="private-ring-glance" aria-live="polite" aria-atomic="true">
          <p className="identity-kicker">{previewedNode ? "Previewing ring" : "Ring selected"}</p>
          <h2>{glanceNode.label}</h2>
          <p>{glanceNode.facets.length} owner-authorised {glanceNode.facets.length === 1 ? "facet" : "facets"} available.</p>
          <p className="meta">{previewedNode ? "Select this ring to open its exact authorised facets. The current reading remains unchanged." : "The exact authorised facets for this ring are open below the portrait."}</p>
        </div>
        <a href="#private-facet-ledger">Read selected facets ↓</a>
        <a href={wellbeingIdentityHomeUrl()}>Manage my Wellbeing Identity →</a>
      </aside>
    </div>
    <section className="private-facet-ledger" id="private-facet-ledger" aria-labelledby="private-facet-ledger-title">
      <header><div><p className="identity-kicker">Selected identity reading</p><h2 id="private-facet-ledger-title">{selectedNode.label}</h2></div><p>{selectedNode.facets.length} owner-authorised {selectedNode.facets.length === 1 ? "facet" : "facets"}</p></header>
      {selectedNode.facets.length ? <dl>{selectedNode.facets.map((facet) => <div key={facet.path}><dt>{facet.label}</dt><dd><FacetPresenter value={facet.value} /><small>{facet.disclosure}</small></dd></div>)}</dl> : <p className="private-facet-empty">No owner-authorised facets are available for this ring.</p>}
    </section>
    <div className="private-identity-separation"><div><p className="identity-kicker">Canonical state</p><strong>{currentW === null ? "No completed state" : `${currentW.toFixed(3)} W`}</strong><span>Calculated from the ratified Genesis baseline and eligible post-Genesis events.</span></div><div><p className="identity-kicker">Performance value</p><strong>{performanceCredits === null ? "—" : performanceCredits.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong><span>Only valued VCperformance events enter this total. Missing valuation remains null and distinct from the WellbeingScore.</span></div></div>
    <details className="private-identity-method"><summary>Current score method</summary><p>The HouseOfBros WellbeingScore begins at the constituted Genesis baseline. Historical Pilot W remains available only inside pre-Genesis dated history and never joins the canonical series.</p></details>
  </section>;
}
