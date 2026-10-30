import type { CampaignDirection } from "@/lib/campaign-direction";

export function CampaignDirectionCard({ direction }: { direction: CampaignDirection | null }) {
  if (!direction) return null;
  const { card, map } = direction;
  return <section className="campaign-direction" aria-label="Campaign direction">
    <p className="meta">Campaign direction</p>
    <p className="campaign-direction-intro">Strategic guidance from the approved campaign map</p>
    <p className="campaign-direction-phase">{card.campaign_phase}</p>
    <h2>{card.daily_direction}</h2>
    <div className="campaign-direction-intent"><span>Validated-demand intent</span><p>{card.validated_demand_intent}</p></div>
    <div className="campaign-direction-priorities"><span>Founder priorities</span><ul>{card.founder_priorities.map((priority) => <li key={priority.id}>{priority.title}{priority.intended_output ? <small>{priority.intended_output}</small> : null}</li>)}</ul></div>
    <details>
      <summary>Campaign details</summary>
      <div className="campaign-direction-details">
        <p><strong>Hypothesis</strong>{card.campaign_hypothesis}</p>
        {card.ai_codex_deliverables.length ? <div><strong>AI/Codex deliverables</strong><ul>{card.ai_codex_deliverables.map((deliverable) => <li key={deliverable.id}>{deliverable.title}{deliverable.intended_output ? <small>{deliverable.intended_output}</small> : null}</li>)}</ul></div> : null}
        {card.dependencies_or_risks?.length ? <div><strong>Dependencies or risks</strong><ul>{card.dependencies_or_risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div> : null}
        <p className="campaign-direction-provenance">Map v{map.version} · {map.commit_sha}{map.committed_at ? ` · ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(map.committed_at))}` : ""}</p>
      </div>
    </details>
    <p className="campaign-direction-boundary">Guidance only · Not an approved personal schedule · Map v{map.version}</p>
  </section>;
}
