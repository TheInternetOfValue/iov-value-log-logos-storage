export default function TrendsLoading() {
  return <section className="insights-page becoming-insights" aria-busy="true" aria-label="Opening Insights">
    <div className="trend-heading">
      <header className="page-intro insights-loading-intro">
        <h1>Insights</h1>
        <p aria-hidden="true"><i /></p>
      </header>
      <div className="trend-range loading-range" aria-hidden="true"><span>7 days</span><span>14 days</span><span>30 days</span></div>
    </div>
    <section className="period-ledger loading-ledger" aria-hidden="true">
      <p className="meta">Completed records only</p>
      <dl>{["Days recorded", "Recorded life", "Recorded time", "Completed movement", "Performance outward"].map((label) => <div key={label}><dt>{label}</dt><dd><i /></dd></div>)}</dl>
    </section>
    <section className="becoming-weave weave-loading" aria-label="Opening the becoming weave">
      <div className="weave-heading"><div><p className="meta">The becoming weave</p><h2>Where recorded life gathered</h2></div></div>
      <div className="weave-loading-field" aria-hidden="true">
        {(["Physiology", "Emotion", "Feeling", "Thought", "Habit", "Performance"] as const).map((node) => <div className={node === "Performance" ? "performance" : ""} key={node}><span>{node}</span><i /></div>)}
      </div>
      <p className="sr-only" role="status">Opening the completed record.</p>
    </section>
  </section>;
}
