"use client";

export default function TrendsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="insights-page becoming-insights">
    <header className="page-intro"><p className="meta">Insights</p><h1>The completed reading could not open</h1><p>Your canonical record is unchanged. This view can be tried again safely.</p></header>
    <section className="becoming-weave weave-error" role="alert">
      <p className="meta">Read projection unavailable</p>
      <h2>The weave is temporarily quiet</h2>
      <p>No activity, movement, credit, or identity state was changed.</p>
      <button className="button" type="button" onClick={reset}>Try this reading again</button>
    </section>
  </section>;
}
