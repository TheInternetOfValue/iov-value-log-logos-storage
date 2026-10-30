# Native voice logging

**27 October capture repair released:** Final-audio retention, shared ten-minute turns, bounded upload retries and server-enforced capture checks are implemented. No database migration or model/prompt change. Synthetic verification is recorded in `docs/context/evidence/native-capture-reliability-2026-10-27/`. PR44 is verified at `d77673bdf5e2e53576c0f7caf295c5e50a08a169`; candidate/main standard Linux CI and public/private postflight pass.

**27 October incident:** long/device acceptance is reopened after the 26 October evening session. The saved owner capture contains substantially less input than reported, and blank-part/timeline completeness checks are insufficient. See `docs/context/NATIVE_VOICE_INCIDENT_2026-10-26.md`. Capture completeness is distinct from semantic timeline coverage; the latter and physical phone acceptance remain open.

Conversation repair released on 26 October 2026 through PR40, implementation `5328aa5156db68d6893c9d8ee9d8f8e0be374989`. Exact-head candidate and merged-main CI and live account/public-Identity preservation pass. The source-pinned Sarvam gate passed 14/14 twice. No migration, new credential or production record mutation. Physical microphone acceptance remains for the person’s device.

Status: released on 25 October 2026. PR35 deployed the beta after approval, fresh backup/restore and a guarded migration preserving all78 original tables. Live Sarvam transcription passed. PR36 moved proposal generation into a signed background job after the live synchronous handler stopped at30 seconds. Real Sarvam proposals and clarification now pass too. The synthetic draft was erased with no confirmed test activity. Thirteen original core tables still match the backup exactly; the public Identity response is byte-identical. The physical microphone remains for the person's first device check. Counts-only proof: `docs/context/evidence/native-voice-2026-10-25/production.json`.

## Person's journey — conversation repair, 26 October 2026

`/day` → **Log your day** microphone → finish on the same microphone → read-only table → optionally speak again → **Submit Value Log** → `/review`.
Existing `/log` and saved-draft links remain supported.

- The microphone action carries a visible private-saving/Sarvam-processing notice. No provider or storage checkbox, transcription gate, row selector or compulsory form sits between speaking and the table. The person still explicitly starts/finishes recording and explicitly submits. A browser may ask for its own microphone permission.
- Further voice turns resolve references across the entire table. Stable activity IDs, existing sources and unrelated answers remain. A changed end updates only a source-derived adjoining start; a separately stated start wins. The optional typed equivalent, transcript, date, file upload, recovery, export and removal remain under details.
- Bare single-digit clocks and supported morning narration retain adjoining context. Approximate and proposed boundaries are labelled; unknown time is not fabricated and gaps stay unknown. Contradictory known intervals, overlaps and future endpoints still block submission.
- Submit is revision-bound participant approval. Fully eligible activities retain the existing canonical confirmation/validation path. If assessment facts or recognition are missing, an immutable encrypted approved conversation is saved in the existing draft table with `capture_review_pending`. No canonical record, neutral effect, score, valuation or credential is invented. Review shows the complete table and its pending assessment state.
- Continue by voice creates a stable owner-scoped continuation of a submitted conversation. The previous approval remains immutable; changes require fresh submission. A removed continuation can be replaced without duplicating a live continuation. Each saved copy has its own export/removal controls. Earlier submitted generations stay in export and audit history.
- Saving is serialized and revision controlled. `/day?date=YYYY-MM-DD&draft=UUID` survives updates and reload through Next.js's supported native history API. Saved never means merely queued. Audio remains temporary in the tab; no transcript or audio is put in local storage.

## Provider and privacy boundary

Transcription and structuring are separate server operations. The server uses `SARVAM_API_KEY` only at `https://api.sarvam.ai`: `saaras:v4` transcription and the explicitly configured `glm5.3` Sarvam V2 chat profile for proposals/replies/review. The V2 request uses schema-constrained structured output, low reasoning and an 8000-token cap; server validation remains authoritative. There is no OpenAI migration or silent fallback. The key is never exposed to the browser. The application does not receive model tool calls, model confirmations, rates, credentials, scores or grants of authority. Responses and quoted evidence are validated as untrusted input. Exact source quotations must occur in the transcript. Clock grounding includes directly adjoining narrative context and actual participant replies. Truly unsupported clocks stay empty; missing facts can remain pending in Review.

The browser decodes a recording locally, downmixes/resamples to mono 16 kHz/16-bit PCM and sends sequential WAV parts of at most 25 seconds, within Sarvam's synchronous 30-second limit. Each result is saved before the next request. Retries reuse a hash-matching saved result; once words or activities are edited, a late transcription cannot replace them. The application retains no audio. Sarvam receives audio/text after explicit processing consent and has its own [privacy policy](https://www.sarvam.ai/privacy-policy); no zero-retention or no-training promise is made on Sarvam's behalf.

Drafts and transcripts are encrypted at rest with the existing narrative facilities and retained until owner removal. One shared `native_log_drafts` table serves all people. Removing a draft erases the encrypted source/proposals, leaving a content-free removal marker and audit event. Confirmed private activities have their own Today removal controls; canonical history remains append-only. Removing the original pilot source narrative also clears its linked native draft copy. Retained encrypted backups are not rewritten by removal.

**Privacy** offers a separate complete voice-draft export in bounded owner-filtered pages, including removal markers and confirmation receipts. Existing activity/audit exports retain their existing formats. Neither export includes provider credentials or another person's records.

## Server contracts and controls

- `GET/PUT/DELETE /api/native-log/drafts`: authenticated owner read, revision-controlled save and scoped removal.
- `POST /api/native-log/transcribe`: one validated WAV part, expected revision, recording ID, sequential part index, explicit processing consent.
- `POST /api/native-log/structure`: expected revision and explicit processing consent; queue a signed, expiring background job and return 202. The worker atomically rotates the owner/revision-bound lease before any provider call, validates strict proposals and saves the result. Owner-only reads report progress, including return after leaving the page. No worker can confirm an activity.
- `POST /api/native-log/confirm`: explicit human confirmation, expected revision; the existing atomic database transaction creates fully eligible records and stores the idempotent receipt; incomplete assessment uses an owner/revision/digest/status/lease compare-and-swap on the existing encrypted draft instead.
- `POST /api/native-log/reply`: authenticated text/audio conversation turn; sequential audio chunks assemble one durable message and retry by chunk hash.
- `POST /api/native-log/reopen`: authenticated revision-bound continuation of an approved pending conversation, retaining source while invalidating approval.
- `GET /api/native-log/export`: five owner-only records per page; a failed page produces no partial download. Export is a bounded traversal with a creation cutoff, not a frozen database snapshot of concurrent edits.

Verified server sessions derive ownership. Exact origin, content type, Fetch Metadata and the existing account-bound token protect mutations. Account changes in another tab fail closed. RLS permits only owner reads; all privileged mutations are service-only. Private responses are uncached. A processing lease prevents concurrent provider writes; the worker claims it once and extends it for up to 150 seconds. Signed dispatch carries identifiers only, expires after two minutes, and uses the existing server-only digest key with a separate purpose. Failure codes are content-free and saved beside the encrypted draft; all saves use compare-and-swap. Content-free errors/status may be logged; narratives, audio, key material and full provider bodies are not logged.

`VALUE_LOG_NATIVE_LOGGING=open` enables the entry and mutations. Closing it preserves reads/exports and disables processing/saving. The independent `VALUE_LOG_MEMBER_WRITING` control still applies to personal members. Deploy previews and branch deploys remain disabled and receive no new provider credential. `SARVAM_API_KEY` belongs only in Production as a protected server secret.

Processing requests have daily conservative caps: transcription 48 per person/240 globally, structuring 30 per person/120 globally. Every attempted provider request consumes an allowance; these are request limits rather than a guaranteed currency budget. Failed limits leave manual activity editing and draft recovery available. Transcription waits are bounded to 20 seconds. Proposal generation runs in an ordinary Netlify background function with a 120-second provider bound; the page reads saved progress with increasing intervals. This deployment actually stopped its initial synchronous model call at 30 seconds, so a route duration declaration is not treated as proof of available execution time. A stopped/expired job leaves its words and an explicit retry path. The background endpoint rejects unsigned, changed or expired dispatches before any provider access.

## Preservation and release

The new migration is additive: one encrypted table, service functions, a true `native_voice` intake source, a native/legacy overlap guard and source-removal propagation. It never rewrites or deletes existing rows, bindings, sharing settings, baselines, appointments, calculations or replay. Original checkouts remain preserved. Imported Identity material is not part of this feature.

Personal members cannot select the founder path through the service writer. They receive no founder DID, baseline, recognition, community, score, credits, calculation or Custom GPT authority. The original pilot's Performance recognition is read from the existing final source for the actual date/community/route; the model cannot assign a level. Existing GPT entry and planning remain available.

Before production migration: make a fresh encrypted backup, restore it into a new local socket-only cluster, compare all existing rows/ACL/RLS/original triggers before and after the single new migration, verify original DID access and personal isolation, then apply only the reviewed new migration separately from deployment. Never replay the full migration history against production. Do not drop native tables on rollback; close processing, keep saved records and roll forward.

Validation: `npm run check` on Node 22; `npm run test:members:db` includes native CAS/leases/RLS/atomic confirmation/removal and real simultaneous native/legacy writers in both orders. `npm run test:members:browser -- --native` uses synthetic local accounts and a simulated provider only; it never reads deployment credentials or sends a real provider request. Live Sarvam, a real microphone/device and original/separate-account acceptance must be recorded separately from these synthetic checks.

Primary references: [Sarvam transcription](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe), [Sarvam structured chat](https://docs.sarvam.ai/api-reference/chat/chat-completions-v1), [MediaStream Recording](https://www.w3.org/TR/mediastream-recording/).

## Conversation acceptance evidence

Two source-identical 14/14 synthetic suites passed through actual Sarvam GLM5.3. Thirteen checks per suite call the model; clear future-only narration is server deterministic. Sources and failures are retained under `docs/context/evidence/native-conversation-2026-10-26/`. The loaded source hash is `4662ea5763ed88d773e952ce66fd27a6bd9285d576ac7d15b06a9a200a346b2f`. The expanded suite covers flowing narration, whole-table correction, adjoining-start propagation and addition preserving existing rows. The diagnostic key was memory-only and cleared after three of four authorised suites. No real member data was sent. This does not claim comparative OpenAI quality or physical microphone acceptance.

## Capture completeness and recovery (27 October)

The browser reports a versioned capture manifest: wall-clock elapsed milliseconds,
decoded audio milliseconds, MIME type and a bounded stop reason. Each validated
WAV part retains its duration and blank/nonblank outcome beside the existing
encrypted draft. These optional fields preserve older draft reads; no new table,
migration, credential, provider or disclosure boundary is added. Audio itself is
not uploaded to storage or retained beyond the tab.

The recorder waits for final `dataavailable`/`stop` before releasing tracks. Track
mute/end, page hiding and recorder failure request an interrupted stop. A stopped
browser/process can still lose tab-only audio; this is not durable background or
offline recording. Both first and follow-up turns allow up to ten minutes and 25
parts; follow-up text is bounded to 50,000 characters, with existing request,
message-count and daily allowance limits retained.

Client uploads are sequential, with at most three attempts for transient
network/timeout/502/503/504 failures. Matching saved parts return without a new
provider call. A nonzero PCM part returning no words gets one explicit empty-result
retry; a successful part cannot be overwritten. Blank results still count as
provider requests. Authentication, revision conflict, quota and cancellation do
not loop. Once words are edited, source checks prevent late transcription from
replacing them.

`capture-health.ts` derives readiness from the sequential parts, recording
manifest and current encrypted review digest. Missing parts, duration differing
by more than max(3 seconds,10%), interrupted/limit/size stops, two or more blanks
covering at least half the recording, or two trailing blanks require recovery.
These are conservative warnings, not evidence that the provider lost speech.
One natural silence in a long recording is permitted. Structuring (including its
worker) and confirmation enforce readiness independently of the client.

`POST /api/native-log/capture-review` uses existing owner/session/CSRF checks,
expected revision and lease-protected writes. A deliberate `useCapturedWords`
acknowledgement binds the received parts and manifest with the existing
server-only digest key. It neither approves an activity nor invents unsent words;
a changed capture invalidates it. A wordless follow-up may instead be deliberately
discarded, preserving its diagnostic digest and the previous log. An empty initial
capture can be retried or replaced only while no saved words/activities would be
lost. Retrying acknowledgement is idempotent. Existing submitted receipts are
returned without retrospective changes.

Private owner reads/exports include capture summaries and the initial recording
ID/manifest for resume. Operational logging includes only bounded error/status,
part index/count/duration and blank/nonblank flags; no account IDs, words, audio,
provider bodies or keys. Client permission/decoder failures still need better
phase diagnostics. Full transcript-to-table coverage is a separate next repair;
the existing model-quality source hash and model settings are unchanged.
