import { type ReactNode } from "react";
import { formatLocalTime } from "@/lib/format";

type Block = { id: string; start_at: string; end_at: string; timezone: string; responsible_party: string; founder_activity: string; ai_codex_activity: string | null; intended_outcome: string | null; context: string | null; status: string };
type Plan = { id: string; daily_focus: string | null; status: string; blocks: Block[] } | null;
type CampaignMetric = { id: string; label: string; unit: string; total: number; target: number | null };
type Campaign = { name: string; north_star_label: string; ends_on: string; metrics: CampaignMetric[] } | null;

function metricValue(metric: CampaignMetric) {
  return metric.unit === "inr" ? `₹${Math.round(metric.total).toLocaleString("en-IN")}` : Math.round(metric.total).toLocaleString("en-IN");
}

export function DailyOperatingPanel({ selected, today, plan, campaign, campaignDirection }: { selected: string; today: string; plan: Plan; campaign: Campaign; campaignDirection?: ReactNode }) {
  const visibleMetrics = campaign?.metrics.slice(0, 4) ?? [];

  return <section className="day-supporting-context" aria-label="Supporting day context">
    {plan ? <details className="today-schedule">
      <summary><span>Plan</span><span>{plan.blocks.length} {plan.blocks.length === 1 ? "block" : "blocks"}</span></summary>
      <div className="plan-reading">{plan.daily_focus ? <div className="daily-focus"><p className="meta">{selected === today ? "Today’s focus" : "Daily focus"}</p><h2>{plan.daily_focus}</h2></div> : null}{plan.blocks.map((block) => <article key={block.id} className={`plan-block ${block.status}`}><time>{formatLocalTime(block.start_at, block.timezone)}–{formatLocalTime(block.end_at, block.timezone)}</time><div><strong>{block.founder_activity}</strong>{block.ai_codex_activity ? <span>AI/Codex · {block.ai_codex_activity}</span> : null}{block.intended_outcome ? <span>Goal · {block.intended_outcome}</span> : null}</div><em>{block.status}</em></article>)}</div>
    </details> : null}
    {campaign ? <details className="campaign-disclosure">
      <summary><span>Campaign movement</span><span>{campaign.name}</span></summary>
      <section className="campaign-overlay">
      <div><p className="meta">{campaign.name}</p><h2>{campaign.north_star_label}</h2></div>
      <div className="campaign-metrics">{visibleMetrics.map((metric) => <div key={metric.id}><span>{metric.label}</span><strong>{metricValue(metric)}</strong>{metric.target !== null ? <small>of {metric.unit === "inr" ? `₹${Math.round(metric.target).toLocaleString("en-IN")}` : Math.round(metric.target).toLocaleString("en-IN")}</small> : null}</div>)}</div>
      <a href="https://chatgpt.com/g/g-JxRtWybbJ-value-log-assistant" target="_blank" rel="noopener noreferrer">Record campaign movement ↗</a>
      </section>
    </details> : null}
    {campaignDirection}
  </section>;
}
