"use client";

type FacetValue = string | number | boolean | null | readonly FacetValue[] | { readonly [key: string]: FacetValue };

export function FacetPresenter({ value }: { value: FacetValue }) {
  if (value === null) return <>Not disclosed</>;
  if (typeof value === "string") {
    const parsed = parseRecordedValue(value);
    if (parsed !== value) return <FacetPresenter value={parsed} />;
    if (isUrl(value)) return <ExternalLink href={value} />;
  }
  if (Array.isArray(value)) return <ul className="facet-value-list">{value.map((item, index) => <li key={index}><FacetPresenter value={item} /></li>)}</ul>;
  if (typeof value === "object") return <StructuredFacet value={value as { readonly [key: string]: FacetValue }} />;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  return <>{String(value)}</>;
}

function StructuredFacet({ value }: { value: { readonly [key: string]: FacetValue } }) {
  const entries = Object.entries(value);
  const history = entries.find(([key]) => /score\s*history|history/i.test(key));
  const summary = history ? "Recorded history" : "Recorded identity reference";
  return <div className="structured-facet-value"><strong>{summary}</strong><span>{history ? `${Array.isArray(history[1]) ? history[1].length : entries.length} recorded ${Array.isArray(history[1]) && history[1].length === 1 ? "entry" : "entries"}` : "A structured recorded value."}</span><details><summary>Show recorded fields</summary><dl>{entries.map(([key, fieldValue]) => <div key={key}><dt>{humanize(key)}</dt><dd><FacetPresenter value={fieldValue} /></dd></div>)}</dl></details></div>;
}

function ExternalLink({ href }: { href: string }) {
  const platform = platformFor(href);
  return <a className="facet-external-link" href={href} target="_blank" rel="noreferrer" title={`Open ${platform.label} in a new tab`} aria-label={`Open ${platform.label} in a new tab`}><span aria-hidden="true">{platform.icon}</span><span>{platform.label}</span></a>;
}

function isUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function parseRecordedValue(value: string): FacetValue {
  if (!/^[\[{]/.test(value.trim())) return value;
  try { const parsed: unknown = JSON.parse(value); return isFacetValue(parsed) ? parsed : value; } catch { return value; }
}
function isFacetValue(value: unknown): value is FacetValue { return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value) && value.every(isFacetValue) || typeof value === "object" && value !== null && Object.values(value).every(isFacetValue); }
function platformFor(value: string) { const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase(); if (host.includes("youtube")) return { label: "YouTube", icon: "▶" }; if (host.includes("linkedin")) return { label: "LinkedIn", icon: "in" }; if (host.includes("instagram")) return { label: "Instagram", icon: "◎" }; if (host.includes("github")) return { label: "GitHub", icon: "◖" }; if (host.includes("docs.google")) return { label: "Google Docs", icon: "▤" }; if (host.includes("academia")) return { label: "Academia", icon: "A" }; if (host.includes("mirror.xyz")) return { label: "Mirror", icon: "◇" }; return { label: "External link", icon: "↗" }; }
function humanize(value: string) { return value.replace(/^~+/, "").replace(/([a-z])([A-Z])/g, "$1 $2"); }
