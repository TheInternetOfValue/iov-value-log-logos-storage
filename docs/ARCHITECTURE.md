# Value Log v1 Architecture

## Identity boundary

Machine authorship, observer authorship, and validator-role authorship are separate records. A machine intake cannot call human workflow actions. The service-role key is server-only.

## Lifecycle

```text
drafted
  ├─ observer_rejected
  └─ observer_approved → validation_pending
       ├─ validation_rejected
       └─ validated
            ├─ overlap blocked (remains validated)
            └─ calculated → reversed → superseded
```

`ProtocolLinkId` begins at observer approval. Revisions preserve it unless the underlying time slice or activity materially changes.

## Truth and read models

Observer, validator, W, credit, and audit events are append-only. Current slices and operational queues are projections:

- `current_time_slices`
- `pending_intake_review`
- `validation_queue`
- `daily_w_state`
- `daily_credit_summary`
- `audit_timeline`

## Calculation limits

`wim-legacy-v1` assumes the attached historical matrix and excludes duration from movement magnitude. This is an explicit pilot limitation. The minimum duration and daily cap are safeguards, not scientific validation.

Performance credit is `duration_hours × normalized_W × effective_rate`. It is a non-monetary community credit, not compensation or settlement.

## Replay

Canonical corrections create a new revision under the same `ProtocolLinkId` and return to validation. Once validated, the synchronous pilot replay path appends reversal events for affected calculations and recalculates the current chronological projection. Original events remain immutable. A background queue can replace the synchronous runner when the data volume grows.
# Wellbeing Identity projection

Value Log is not an identity authority. It binds the Moses pilot member to the
canonical DID issued by Word Wallet Web and publishes only a consent-gated
daily projection:

`Value Log → signed consented projections → Word Wallet Web → Foundation public profile`

The projection contains current Pilot W, 24-hour and seven-day changes, an
input window, calculator version, aggregate provenance hash, update time, and
limitations. It excludes narratives, activities, communities, evidence,
validator rationale, and record identifiers.

The scheduled publisher runs at 00:15 Asia/Kolkata. Word Wallet Web verifies
the server signature, freshness, idempotency, DID binding, and active
`public-profile:pilot-w` consent before making the projection public.

Pilot W is an experimental Value Log projection and is not the canonical
composite WellbeingScore.

Community-value publication is a separate projection and requires the separate
`public-profile:community-value` consent scope. It publishes only 30-day and
lifetime aggregates:

- HouseOfBros: calculated wellbeing time and positive, negative, and net W
  movement;
- Growth Flow Engineering and IoV Research Foundation: calculated Performance
  time and non-monetary credits.

W movement and Performance credits are distinct measures and are never added
into a universal total. Activities, narratives, proof, validation rationale,
and record identifiers remain private.
