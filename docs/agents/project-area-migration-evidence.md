# Project area migration evidence and runbook

GitHub issue #187 reserves `db/migrations/0003_recruiter_project_areas.sql`
for the five recruiter-facing project areas. The migration has not been applied
to preview or production by agents.

## Canonical values

- Shipped & Client Work
- Apps
- AI & Developer Tools
- Side Projects & Experiments
- Coursework

GitHub language and topics remain discovery evidence only. A hidden draft may
omit `area`; admin approval and publish require one of the values above.

## Local dry-run evidence

The read-only artifact is `db/preflight/0003_recruiter_project_areas.sql`. A
safe result is zero rows. It calculates the values migration 0003 would produce
from the same seven legacy mappings and explicit ID/slug overrides, then reports
only rows that would remain noncanonical. Known mapped values are omitted,
including Loom's explicitly overridden `TypeScript`; an unoverridden
`TypeScript` value is still reported.

Local PGlite verification exercises:

- all seven legacy value mappings;
- explicit project overrides from the reviewed taxonomy, including Slurmlet;
- DB-only legacy rows through value-based mappings;
- the explicit Loom ID/slug override;
- draft proposed-area mappings and drafts with no area;
- the actual read-only preflight before and after migration, with unmapped
  project and draft controls;
- partial-run retry/idempotence;
- preflight failure for unmapped project and draft values;
- the final persisted-project and proposed-draft constraints.

Run on Node 24:

```sh
npm run test:db
npm run test:discovery
npm run test:slack
npm run test:admin
npm run test:dm
npm run test:rag
npm run test:proof
npm run verify
```

## Preview apply gate

Preview mutation requires separate maintainer approval. After approval, an
operator should use the preview database connection and stop on any preflight
row:

```sh
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file db/preflight/0003_recruiter_project_areas.sql
npm run db:migrate
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file db/preflight/0003_recruiter_project_areas.sql
```

Record the reviewed preflight output, migration command result, preview commit
SHA, and post-apply zero-row output on the PR before promotion.

## Production runbook

Production is not mutated by this program's agents. After the full stacked
launch is approved, the maintainer must:

1. Pin the exact reviewed release SHA and take the normal Neon restore point.
2. Run the read-only preflight against the production connection.
3. Stop and add an explicit reviewed ID/slug mapping if any row is returned.
4. Run `npm run db:migrate` once with the production database environment.
5. Rerun the preflight and require zero rows.
6. Query the two named constraints and verify both are validated.
7. Run the release smoke gate before promoting traffic.

Constraint verification:

```sql
SELECT conname, convalidated
FROM pg_constraint
WHERE conname IN (
  'projects_area_recruiter_facing_check',
  'project_drafts_area_recruiter_facing_check'
)
ORDER BY conname;
```

Rollback is restore-point based because old area labels are intentionally
many-to-one. Do not attempt an automatic reverse mapping.
