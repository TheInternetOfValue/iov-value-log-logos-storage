# Synthetic export

These CSVs are written for this public review repository. They contain two fictional activities for a reserved example owner on 28 October 2026, empty historical/review/plan tables, and an illustrative baseline of 700. No private record, personal identity, score movement or Performance credit is represented.

The importer verifies each CSV's row count and SHA-256 against `synthetic-manifest.json`. Use `npm run logos:import -- examples/synthetic-export` with a local Storage node running.

The sample activities are deliberately labelled `[SYNTHETIC]` in the app. Generic schemas retain upstream pilot field names so the existing adapter can read them. The sample is for software behavior only; its baseline is not a measured or validated wellbeing result.
