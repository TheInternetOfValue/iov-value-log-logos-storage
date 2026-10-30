# Value Log · Logos Storage review

Source for reviewing the Logos Storage integration in Value Log. This independent repository is a reviewed snapshot of `claude/logos-storage-local` at `8dd9938e3dc959bebf55db3176264e9d293034ce`, plus the local initial-voice-dispatch repair. It has its own history and no connection to the production deployment pipeline.

Anyone can read this public repository, including the Logos team. No collaborator invitation is needed to inspect or clone the code.

## Start with these files

| Area | Source |
| --- | --- |
| Local node, pinned release and checksum | [`scripts/logos-storage-node.mjs`](scripts/logos-storage-node.mjs) |
| Ciphertext upload, CID, read and deletion | [`src/lib/native-log/mirror.ts`](src/lib/native-log/mirror.ts) |
| AES-256-GCM narrative envelope | [`src/lib/crypto.ts`](src/lib/crypto.ts) |
| Verified export import and per-day objects | [`scripts/logos-storage-records.mts`](scripts/logos-storage-records.mts) |
| Local encryption and readback | [`src/lib/logos-demo.ts`](src/lib/logos-demo.ts) |
| Query adapter and encrypted local write overlay | [`src/lib/logos-demo-client.ts`](src/lib/logos-demo-client.ts) |
| Local voice-job dispatch | [`src/lib/native-log/dispatch.ts`](src/lib/native-log/dispatch.ts), [`structure/route.ts`](src/app/api/native-log/structure/route.ts) |
| Optional hosted mirror schema | [`202610290001_native_log_mirrors.sql`](supabase/migrations/202610290001_native_log_mirrors.sql) |
| Auth proxy/container examples | [`ops/logos-storage/`](ops/logos-storage/) |

## Run the synthetic local demo

Requirements: Node.js 22, npm, `unzip`, and macOS Apple Silicon or Linux x64/arm64. The first node start needs internet access to download the checksum-pinned Logos Storage v0.5.3 binary. No Supabase account or private npm token is required.

```bash
git clone https://github.com/TheInternetOfValue/iov-value-log-logos-storage.git
cd iov-value-log-logos-storage
npm ci
cp .env.example .env.local
```

In terminal 1, start Storage and leave it running:

```bash
LOGOS_API_PORT=8081 npm run logos:node
```

In terminal 2, use the same Storage URL for the check, import and app:

```bash
export LOGOS_STORAGE_URL=http://127.0.0.1:8081/api/storage/v1
npm run logos:check
npm run logos:import -- examples/synthetic-export
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open [the synthetic day](http://127.0.0.1:3000/day?date=2026-10-28), [Insights](http://127.0.0.1:3000/trends?range=7&date=2026-10-28), [Review](http://127.0.0.1:3000/review), or [Storage inspection](http://127.0.0.1:3000/logos). The two activities and any supplied measures are fictional examples, not observations about a person or calculated results. The sample has no score movement or Performance credits.

`logos:check` uses a throwaway key and object to verify encrypt → upload → read → decrypt → delete → 404. It deletes only its own synthetic object. `logos:demo` provides a narrated synthetic command-line walkthrough.

### Optional voice

Set your own `SARVAM_API_KEY` in `.env.local` to enable provider processing. Voice transcription and structuring send the supplied audio/text to Sarvam. The default structuring model is `glm5.3`; no provider call is needed to inspect the code, run unit tests, or browse the supplied dataset. Review and confirmation remain explicit user actions.

## Storage boundaries and limits

- The app encrypts before upload using AES-256-GCM. Storage receives an envelope containing ciphertext, IV and authentication tag; the local demo key stays in ignored `.logos-storage/demo-key.json`.
- Objects are addressed by CID and uploaded with `advertise=false`. This flag is not access control. The local REST API has no authentication and must remain on loopback. The local demo supplies a pilot session automatically; do not expose it as a public web app.
- Node data, keys and CID indexes persist in `.logos-storage/`. Keep that directory private and retain it between restarts. The node uses a ten-year block TTL because v0.5.3 deletes zero-TTL blocks during startup maintenance.
- Imported rows are read-only. Newly created local drafts and pending submissions use a separately encrypted, persisted overlay. This demo does not calculate new W or credits and does not implement review decisions.
- Deletion is deletion from this node, not a guarantee of erasure from other copies. Availability depends on retained node data and key custody.
- The optional hosted mirror keeps Supabase authoritative and mirrors existing submitted ciphertext. It is separate from the database-free local adapter. Its source is included for inspection; no database migration, cron job, production worker or deployment is configured by this repository.
- This integration demonstrates Storage. It does not anchor wellbeing scores to a blockchain or establish scientific validation of a score.

## What this snapshot includes

The app, integration helpers, schema/migrations, tests, reviewed SDK build archives, and synthetic CSV export are included. Historical private screenshots use a labelled placeholder in this copy. Personal exports, credentials, local Storage contents, internal incident/research evidence, the owner-specific frozen Genesis dossier/qualification helper, and private Git history are excluded. Production workflows are not active here; the weekly-review workflow is retained only as an inert source example for its privacy-boundary tests.

[`SOURCE_PROVENANCE.md`](SOURCE_PROVENANCE.md) records the upstream revision and review-copy changes. Generic calculation and policy source remain available for code review; their presence is not an instruction to apply migrations to an existing database. Canonical protocol definitions are maintained at [the IoV Spec API](https://spec.theinternetofvalue.org), not in this demonstration repository.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

The build checks the included Identity SDK archives locally. The source repository does not auto-deploy or run production schedules. Existing upstream copyright and dependency notices remain applicable; this snapshot does not select a new project-wide open-source license.
