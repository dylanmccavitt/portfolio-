# Catalog cutover operator runbook

GitHub #190 makes published database rows the only normal public project source.
This document is an execution record and runbook; it does not authorize a
preview or production mutation by itself.

## Guardrails

- `0006_catalog_cutover.sql` only installs `catalog_cutover_publish_legacy_shadow()`.
  It does not promote data when `npm run db:migrate` runs.
- The cutover command reads the existing shadow/parity set before it mutates.
  It does not re-import catalog data, so a reviewed field mismatch cannot be
  overwritten into a false pass.
- `npm run db:catalog:cutover` is read-only. The mutation requires the exact
  `-- --apply` suffix after a separate maintainer approval.
- The function changes only `source = 'legacy_catalog' AND lifecycle_state =
  'shadow'`. Existing published DB-only rows, including Loom, are untouched.
- A successful cutover queues one durable `site_refresh` job. It is not proof
  that a refreshed deployment has completed.

## Preview sequence

Complete each approval gate separately and record its approver/time below.

1. Approve and apply 0006 to the persistent preview branch using the approved
   preview database connection. Confirm the migration ledger records 0006 and
   the function exists. Do not apply production migrations in this step.
2. Run the separately reviewed catalog shadow preparation, then record the
   one-way parity output from `npm run db:catalog:parity`. Every catalog field
   must match its legacy DB row. Extra reviewed published DB-only rows are
   allowed; unexpected shadows or a non-legacy collision with a catalog id are
   failures.
3. Run `npm run db:catalog:cutover` and save its non-mutating report. Obtain a
   second, explicit approval for the cutover mutation.
4. Run `npm run db:catalog:cutover -- --apply`. Record the promoted count,
   resulting `publication_version` values, and the single queued `site_refresh`
   job id. Re-running must report zero promotions and create no duplicate job.
5. Before the real Loom scan, obtain its separate approval and follow
   `docs/agents/github-refresh.md` to adopt the immutable repository id onto
   the exact preview project row. Record the repository id and default-branch
   revision SHA.
6. Obtain separate approval to scan and publish. Review the missing-manifest
   evidence proposal, complete the admin reviewed-field/provenance/privacy
   confirmation, then record scan/candidate/draft/project ids, publication and
   evidence versions, RAG handles, and outbox ids.
7. With the separately approved worker token, deploy hook, and cron in place,
   process the outbox. Record the `site_refresh` operation id and wait for the
   reviewed deployment SHA before treating sitemap and generated OG as current.
8. Prove the same published Loom row through `/library`, `/projects/loom`, and
   DM. Use a preview-only hidden draft containing a unique sentinel and record
   negative evidence for list, detail, DM, RAG, sitemap, OG, and emitted
   logs/metrics. No `private_allowed_for_draft` text may leave the database.
9. Perform and record the non-destructive `catalog_emergency` redeploy rollback
   check. It must emit the source-mode signal and must never activate on a DB
   error by itself.

## Production runbook

No production mutation is authorized by this issue implementation. After the
preview proof is reviewed and a maintainer grants a new production approval:

1. Create and record a production restore point and the reviewed production
   deployment/database targets. Do not copy preview credentials or data.
2. Apply 0006 to production with the approved connection, then verify its
   migration ledger/function. This installs the function only.
3. Reproduce the reviewed one-way parity report against production. Stop on any
   mismatch, unexpected shadow, or catalog-id collision.
4. Obtain explicit approval again, run the read-only cutover report, then run
   the `--apply` form. Verify the promoted count, public rows, and one refresh
   job before invoking the worker.
5. Configure production worker/deploy-hook/cron through the normal maintainer
   process; never place their values in this repository. Process the refresh,
   wait for the reviewed deployment, and repeat the public/exclusion proof.

## Preview proof record

Fill this only during the approved live proof; do not invent values from local
tests.

| Evidence | Value |
| --- | --- |
| Preview approval(s), actor, timestamp | Pending |
| Migration ledger / 0006 function proof | Pending |
| Catalog parity report reference | Pending |
| Cutover promoted count / refresh job id | Pending |
| Loom repository id / default-branch revision | Pending |
| Scan / candidate / draft / project ids | Pending |
| Publication / evidence versions / RAG handles | Pending |
| Outbox ids / refresh operation / reviewed deployment SHA | Pending |
| Library, detail, DM URLs and row identity | Pending |
| Sentinel exclusion queries and observed outputs | Pending |
| Emergency rollback deployment and source-mode evidence | Pending |
