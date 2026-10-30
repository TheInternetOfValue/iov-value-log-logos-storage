export const dynamic = "force-static";
export function GET() {
  return new Response(
    `# Value Log

> A private activity log connected to Wellbeing Identity. Speak, check a structured table, speak again to correct or add, then Submit Value Log.

## Public documentation
- [How Value Log works](https://valuelog.theinternetofvalue.org/method): Voice logging, Identity connection, approval, review, calculation and privacy boundaries.
- [Product evolution](https://valuelog.theinternetofvalue.org/changelog): Dated, public-safe releases.
- [Build your Wellbeing Identity](https://identity.theinternetofvalue.org/): The eight canonical rings and private authoring.
- [Identity product evolution](https://identity.theinternetofvalue.org/changelog): Shared chronology with experience and technical lanes.
- [Canonical IoV Spec](https://spec.theinternetofvalue.org/): Protocol authority.

## Interpretation boundaries
Google users can create separate private, unassessed Value Logs through Identity. Native voice logging uses Sarvam for transcription and structuring. The person approves the proposed log; the model cannot grant membership, approve on their behalf, invent missing effects or calculate a score. Incomplete assessment can wait privately in Review.

The invited Field Station policy is deployed but inactive as of 26 October 2026. Its assumed 700 state is experimental, not ratified Genesis; it must not be applied to all users or confused with the existing founder policy.

Account pages, drafts, narratives, salary, evidence, review queues and exports require authorisation and are excluded from this public guide. This file aids documentation readers; it does not grant access or guarantee search inclusion.
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
