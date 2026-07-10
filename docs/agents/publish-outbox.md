# Durable publication outbox

GitHub issue #189 separates the fast database publication boundary from OpenAI
and site rebuild work. The publish request commits project state and immutable
job identities together, then returns. A separately authenticated worker claims
and processes jobs in bounded batches.

## Version and enqueue contract

- `projects.publication_version` increments exactly once in the atomic publish
  statement from issue #188 and once when a published project is archived or
  unpublished, giving removal work a distinct immutable version.
- `evidence_sources.evidence_version` starts at 1 and increments when the
  extracted-text hash, claim map, or privacy approval changes.
- A publication queues one `site_refresh` job and one `rag_index` job for each
  linked reviewed `safe_public` evidence version. With no eligible evidence it
  queues only `site_refresh`.
- Evidence change/removal and privacy downgrade revoke matching RAG rows in the
  database before queuing `rag_revoke` cleanup. Project unpublish/archive also
  queues `site_refresh` so build-time public artifacts can be removed.
- Jobs contain ids and versions only. Extracted text and visitor/admin content
  never enter the outbox.
- The exact identity is `(job_type, project_id, publication_version,
  evidence_source_id NULLS NOT DISTINCT, evidence_version NULLS NOT DISTINCT)`.

## Lease and retry contract

`POST /api/admin/outbox/run` claims at most 10 jobs and runs for at most 45
seconds. Claims use `FOR UPDATE SKIP LOCKED`, a UUID claim token, worker id, and
a 60-second default lease. Acknowledge/fail mutations require the current token;
an expired worker cannot update a job reclaimed by another worker.

Attempts are capped at 5. Retry delay is
`min(30 * 2^(attempt - 1), 900)` seconds. The only states are `queued`,
`processing`, `succeeded`, and `dead`. Persisted errors are bounded stable codes,
not raw OpenAI responses, deploy-hook URLs, evidence, or credentials.

## RAG recovery contract

RAG rows persist the evidence/publication versions, OpenAI file id, vector-store
id, and `pending -> uploaded -> attached -> indexed` checkpoint. Revocation is
DB-first and persists `detached -> revoked` while remote cleanup is retried.
Every remote step rechecks the project publication, exact evidence version,
project link, `safe_public` privacy, non-generated claim map, and non-empty
approved text. Public retrieval also requires the indexed RAG row's evidence
version to match the current evidence row.

Remote requests use deterministic idempotency keys. This gives reconciliation-
safe retries and prevents duplicated remote objects when the provider honors
idempotency. A database cannot make a transaction atomic with OpenAI: a process
can still die after a provider response but before the handle is persisted. The
worker retries with the same key and durable checkpoints; it does not claim
literal cross-system exactly-once delivery. Detach/delete treat a provider 404
as already complete.

## Site refresh contract

`site_refresh` posts to `SITE_REFRESH_DEPLOY_HOOK_URL` over HTTPS with a
10-second timeout and `X-Idempotency-Key` equal to the exact outbox identity.
The returned operation/deployment id is persisted before acknowledgment. The
hook URL is never returned or logged.

## Manual promotion gates

This PR does not apply migrations, configure a deploy hook, add Vercel cron, or
touch preview/production services. Before deployed code depends on the worker,
a maintainer must:

1. Apply migrations through 0005 to the persistent preview Neon branch.
2. Configure preview `OUTBOX_WORKER_TOKEN` (at least 32 bytes),
   `SITE_REFRESH_DEPLOY_HOOK_URL`, and the existing RAG variables.
3. Invoke the route manually and prove publish -> outbox -> RAG/site refresh on
   preview as part of issue #190.
4. Add scheduling only after review. Repeat migration/configuration separately
   for production at the final launch gate; never copy preview connection data.

Required local/CI proof is `npm run test:db`, `npm run test:admin`,
`npm run test:rag`, `npm run test:outbox`, `npm run test:proof`, and
`npm run verify` on Node 24.
