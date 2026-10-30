import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { PublicPageData } from "@/components/PublicPageData";
import { publicMetadata } from "@/lib/public-discovery";

export const metadata = publicMetadata("/method");

const bands = [
  ["100–300", "5%", "0.010–0.009"],
  ["301–500", "4%", "0.008–0.007"],
  ["501–700", "3%", "0.006–0.005"],
  ["701–800", "2%", "0.004"],
  ["801–900", "1%", "0.003"],
  ["901–1000", "0.5%", "0.002"],
];

export default function MethodPage() {
  return <article className="method-page">
    <PublicPageData path="/method" />
    <PageIntro title="How Value Log works">
      Value Log lets you speak about your day, check a structured table, correct it by speaking again and submit your private log. Your approval and the later assessment are separate steps.
    </PageIntro>
    <p className="meta">Internet of Value Research Foundation · Updated <time dateTime="2026-10-26">26 October 2026</time></p>
    <p className="card">Identity members can keep their own private, unassessed activities in Value Log. The calculation, validation and founder policies described below apply to the existing pilot. They are not automatically assigned to new members.</p>
    <Link className="method-changelog-callout" href="/changelog">
      <span>Product changelog</span>
      <strong>See how the private pilot is evolving →</strong>
      <small>Reviewed visual comparisons, product milestones, and safeguards.</small>
    </Link>
    <nav className="method-index" aria-label="Method contents">
      <a href="#flow">Voice logging</a><a href="#identity-and-access">Identity and access</a><a href="#approval">Approval and Review</a><a href="#pilot-status">Pilot status</a><a href="#roles">Roles</a><a href="#founder-w">Canonical score</a><a href="#pilot-w">Historical Pilot W</a>
      <a href="#performance">Performance</a><a href="#provenance">Provenance</a><a href="#privacy">Privacy</a>
    </nav>

    <section id="flow" className="method-section">
      <p className="meta">Native logging · live</p><h2>How do I log by voice?</h2>
      <div className="flow-strip"><span>Speak</span><b>→</b><span>Check the table</span><b>→</b><span>Speak again if needed</span><b>→</b><span>Submit Value Log</span><b>→</b><span>Review</span></div>
      <p>Open Today and tap the microphone. Tap it again when you finish; Sarvam transcribes your recording and proposes activities. You can speak again to correct the whole table or add something, then submit when it is right. Typing and recovery options remain available. No ChatGPT plugin or separate transfer is required.</p>
      <p>Transcription and structuring are separate operations. Approximate times are labelled, missing time stays unknown, and missing effects stay unreported. The model cannot approve a log, grant authority or calculate value. The older Custom GPT Actions remain available only to the original owner.</p>
    </section>

    <section id="identity-and-access" className="method-section"><h2>How does Wellbeing Identity connect to Value Log?</h2><p>Sign in through Wellbeing Identity with Google. Value Log receives a verified Identity reference and creates or reopens your own private account. Identity and Value Log keep separate sessions and data. Signing in does not copy your private facets, publish your profile or grant a wellbeing baseline.</p><p><a href="https://identity.theinternetofvalue.org/">Build your Wellbeing Identity</a> · <a href="https://identity.theinternetofvalue.org/changelog">Read Identity’s product evolution</a></p></section>
    <section id="approval" className="method-section"><h2>What happens when I submit my log?</h2><p>Submit Value Log approves the exact version you checked. If assessment facts or recognition are missing, the approved conversation waits privately in Review. Nothing is silently treated as a neutral effect or calculated. You can continue the conversation; changes require fresh approval.</p><p>Fully eligible activities follow the applicable validation and calculation policy. Ordinary new members retain private, unassessed logging. The original founder policy and its historical records remain separate.</p></section>
    <section id="pilot-status" className="method-section"><h2>Who receives a wellbeing score?</h2><p>Google sign-in alone does not assign a score. The existing founder calculation uses its own constituted baseline and policy. The invited Field Station pilot has deployed controls, but enrollment, automated review and provisional calculation remain inactive as of 26 October 2026.</p><p>The planned invited policy uses six explicitly assumed starting values of 700, with community acceptance and review consent. This is experimental and does not claim a completed assessment or ratified Genesis. Optional salary-derived valuation is separate from wellbeing and remains non-payable. It is not a default for everyone.</p></section>

    <section id="roles" className="method-section">
      <p className="meta">Human protocol actions</p><h2>Observation and validation are different acts.</h2>
      <div className="grid two">
        <div className="card"><h3>Observer</h3><p>Confirms that the activity, time, route, and effect accurately represent the person’s observation.</p></div>
        <div className="card"><h3>Validator</h3><p>Confirms evidence adequacy and classification in the routed community role. HouseOfBros does not claim to externally prove subjective inner truth.</p></div>
      </div>
      <div className="warning">Pilot disclosure: Moses acts in multiple validator roles. Role separation is not independent external review.</div>
    </section>

    <section id="founder-w" className="method-section">
      <p className="meta">HouseOfBros WellbeingScore · Founder Policy v0.1</p><h2>The canonical score begins at Genesis.</h2>
      <p>The constituted six-component baseline is 771.00. Only eligible occurrences beginning strictly after the stored Genesis timestamp move the live state. Pre-Genesis observations remain baseline evidence and are never counted again as movement.</p>
      <pre>{`W = 0.20P + 0.10E + 0.10F + 0.20T + 0.10H + 0.30Performance`}</pre>
      <p>Historical Pilot W and the canonical founder score are separate series. A Genesis marker connects their chronology without treating the method change as a wellbeing gain or loss.</p>
    </section>

    <section id="pilot-w" className="method-section">
      <p className="meta">Historical calculator · wim-legacy-v1 · frozen at Genesis</p><h2>Pilot W records the pre-Genesis experiment.</h2>
      <p><strong>Pilot W is not the canonical HouseOfBros WellbeingScore.</strong> It remains visible only in dated historical views and is never joined to the canonical series.</p>
      <pre>{`requested_post_w = clamp(
  pre_w × (1 + signed_effect × band_rate × adjustment_factor
  × intensity_factor × confidence_factor),
  100,
  1000
)`}</pre>
      <ul>
        <li>Positive = +1, neutral = 0, negative = −1.</li>
        <li>Low, medium, and high intensity use 0.5, 1.0, and 1.5.</li>
        <li>Observed, inferred, and uncertain confidence use 1.0, 0.75, and 0.5.</li>
        <li>Slices shorter than five minutes create no movement.</li>
        <li>Total calendar-day movement is limited to ±5 points.</li>
        <li>Duration is recorded but excluded from movement magnitude—an explicit pilot limitation.</li>
      </ul>
      <table><thead><tr><th>Pre-slice W band</th><th>Rate</th><th>Adjustment</th></tr></thead>
        <tbody>{bands.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table>
    </section>

    <section id="performance" className="method-section">
      <p className="meta">Performance calculator · performance-credit-v1</p><h2>Contribution is bounded by time, state, and a versioned community rate.</h2>
      <pre>{`credit = duration_hours × (pre_slice_w / 1000) × community_rate`}</pre>
      <p>Rates are selected by community, SAO lane, skill level, and effective date. Credits are non-monetary pilot reference units—not wages, payouts, tokens, equity, or settlement claims.</p>
    </section>

    <section id="provenance" className="method-section">
      <p className="meta">Replay integrity</p><h2>Events for truth; projections for use.</h2>
      <p>Every transition records its pre- and post-state, parser and calculator versions, rate version where applicable, formula inputs, requested and applied results, input hash, replay run, source revision, and reversal references. Corrections create a new revision and deterministic chronological replay.</p>
      <div className="card worked-example"><p className="meta">Redacted worked example</p><h3>30-minute positive physiology observation</h3><p>Pre-slice Pilot W: 843.00 · matrix band: 801–900 · intensity: medium · confidence: observed</p><p><strong>Requested and applied movement: +0.025 W</strong></p></div>
    </section>

    <section id="privacy" className="method-section">
      <p className="meta">Privacy boundary</p><h2>The narrative is not the public record.</h2>
      <p>Raw narratives are application-encrypted. Deletion removes recoverable ciphertext while preserving a non-reconstructable keyed digest, canonical derived records, formula inputs, and audit events required for replay. Historical Pilot records remain private and frozen. Canonical founder disclosure remains controlled only by the owner in Word Wallet.</p>
    </section>

    <footer className="method-footer">
      <a href="https://spec.theinternetofvalue.org">Canonical IoV Spec</a>
      <a href="https://spec.theinternetofvalue.org/protocols/wellbeing-identity/">Wellbeing Identity specification</a>
      <a href="https://github.com/TheInternetOfValue/word-wallet-web/blob/main/docs/product/README.md">Product and engineering handoff</a>
      <a href="https://theinternetofvalue.org/insights/observer-attention-is-all-you-need">Observer Attention whitepaper</a>
      <Link href="/changelog">Product changelog</Link>
      <Link href="/day">Open private Value Log</Link>
    </footer>
  </article>;
}
