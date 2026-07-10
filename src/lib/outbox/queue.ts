import { randomUUID } from 'node:crypto';
import type { PublishOutboxJobType, PublishOutboxState } from '@/lib/db/schema';

export interface OutboxQueryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<{ rows: Row[] } | Row[]>;
}

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_DEFAULT_LEASE_SECONDS = 60;
export const OUTBOX_MAX_BATCH = 10;

export interface ClaimedOutboxJob {
  id: string;
  job_type: PublishOutboxJobType;
  project_id: string;
  publication_version: string | number;
  evidence_source_id: string | null;
  evidence_version: string | number | null;
  state: 'processing';
  attempts: number;
  claim_token: string;
  worker_id: string;
  lease_expires_at: string;
  remote_operation_id: string | null;
}

export interface OutboxMutationResult {
  updated: boolean;
  state?: PublishOutboxState;
  attempts?: number;
  nextAttemptAt?: string;
}

export class OutboxJobError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'OutboxJobError';
    this.code = normalizeErrorCode(code);
  }
}

export async function claimOutboxJobs(
  db: OutboxQueryable,
  input: { workerId: string; limit?: number; leaseSeconds?: number; claimToken?: string },
): Promise<ClaimedOutboxJob[]> {
  const workerId = input.workerId.trim();
  if (!workerId || workerId.length > 128) throw new Error('workerId must be 1-128 characters.');
  const limit = boundedInteger(input.limit ?? OUTBOX_MAX_BATCH, 1, OUTBOX_MAX_BATCH, 'limit');
  const leaseSeconds = boundedInteger(input.leaseSeconds ?? OUTBOX_DEFAULT_LEASE_SECONDS, 1, 900, 'leaseSeconds');
  const claimToken = input.claimToken ?? randomUUID();

  return normalizeRows(
    await db.query<ClaimedOutboxJob>(
      `WITH exhausted AS (
         UPDATE publish_outbox
         SET state = 'dead',
             lease_expires_at = NULL,
             claim_token = NULL,
             worker_id = NULL,
             last_error = COALESCE(last_error, 'lease_expired_after_max_attempts'),
             updated_at = now()
         WHERE state = 'processing' AND lease_expires_at <= now() AND attempts >= $4
         RETURNING id
       ),
       ready AS (
         SELECT id
         FROM publish_outbox
         WHERE attempts < $4
           AND (
             (state = 'queued' AND next_attempt_at <= now())
             OR (state = 'processing' AND lease_expires_at <= now())
           )
         ORDER BY next_attempt_at, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       ),
       claimed AS (
         UPDATE publish_outbox AS job
         SET state = 'processing',
             attempts = attempts + 1,
             lease_expires_at = now() + ($2::integer * interval '1 second'),
             claim_token = $3::uuid,
             worker_id = $5,
             last_error = NULL,
             updated_at = now()
         FROM ready
         WHERE job.id = ready.id
         RETURNING job.id, job.job_type, job.project_id, job.publication_version,
                   job.evidence_source_id, job.evidence_version, job.state,
                   job.attempts, job.claim_token, job.worker_id,
                   job.lease_expires_at, job.remote_operation_id
       )
       SELECT * FROM claimed ORDER BY id`,
      [limit, leaseSeconds, claimToken, OUTBOX_MAX_ATTEMPTS, workerId],
    ),
  );
}

export async function acknowledgeOutboxJob(
  db: OutboxQueryable,
  jobId: string,
  claimToken: string,
): Promise<OutboxMutationResult> {
  const row = normalizeRows(
    await db.query<{ state: PublishOutboxState; attempts: number }>(
      `UPDATE publish_outbox
       SET state = 'succeeded',
           lease_expires_at = NULL,
           claim_token = NULL,
           worker_id = NULL,
           last_error = NULL,
           updated_at = now()
       WHERE id = $1 AND state = 'processing' AND claim_token = $2::uuid
       RETURNING state, attempts`,
      [jobId, claimToken],
    ),
  )[0];
  return row ? { updated: true, state: row.state, attempts: row.attempts } : { updated: false };
}

export async function failOutboxJob(
  db: OutboxQueryable,
  jobId: string,
  claimToken: string,
  error: unknown,
): Promise<OutboxMutationResult> {
  const lastError = sanitizeOutboxError(error);
  const row = normalizeRows(
    await db.query<{ state: PublishOutboxState; attempts: number; next_attempt_at: string }>(
      `UPDATE publish_outbox
       SET state = CASE WHEN attempts >= $3 THEN 'dead' ELSE 'queued' END,
           next_attempt_at = CASE
             WHEN attempts >= $3 THEN next_attempt_at
             ELSE now() + (LEAST(30 * power(2, attempts - 1), 900) * interval '1 second')
           END,
           lease_expires_at = NULL,
           claim_token = NULL,
           worker_id = NULL,
           last_error = $4,
           updated_at = now()
       WHERE id = $1 AND state = 'processing' AND claim_token = $2::uuid
       RETURNING state, attempts, next_attempt_at`,
      [jobId, claimToken, OUTBOX_MAX_ATTEMPTS, lastError],
    ),
  )[0];
  return row
    ? { updated: true, state: row.state, attempts: row.attempts, nextAttemptAt: row.next_attempt_at }
    : { updated: false };
}

export async function persistOutboxRemoteOperation(
  db: OutboxQueryable,
  jobId: string,
  claimToken: string,
  remoteOperationId: string,
): Promise<boolean> {
  const operationId = remoteOperationId.trim().slice(0, 256);
  if (!operationId) return false;
  return normalizeRows(
    await db.query<{ id: string }>(
      `UPDATE publish_outbox
       SET remote_operation_id = $3, updated_at = now()
       WHERE id = $1 AND state = 'processing' AND claim_token = $2::uuid
       RETURNING id`,
      [jobId, claimToken, operationId],
    ),
  ).length === 1;
}

export async function enqueueRagRevocationsForProject(
  db: OutboxQueryable,
  projectId: string,
): Promise<number> {
  const rows = normalizeRows(
    await db.query<{ id: string }>(
      `WITH project AS (
         SELECT id, publication_version FROM projects WHERE id = $1 FOR UPDATE
       ),
       revoked AS (
         UPDATE rag_sources AS rag
         SET eligibility_state = 'revoked',
             revoked_at = COALESCE(revoked_at, now()),
             failure_message = NULL,
             updated_at = now()
         FROM project
         WHERE rag.project_id = project.id
           AND rag.evidence_source_id IS NOT NULL
           AND rag.eligibility_state <> 'revoked'
         RETURNING rag.project_id, rag.evidence_source_id, rag.evidence_version
       )
       INSERT INTO publish_outbox (
         id, job_type, project_id, publication_version, evidence_source_id, evidence_version
       )
       SELECT portfolio_outbox_id('rag_revoke', revoked.project_id, project.publication_version,
                                  revoked.evidence_source_id, revoked.evidence_version),
              'rag_revoke', revoked.project_id, project.publication_version,
              revoked.evidence_source_id, revoked.evidence_version
       FROM revoked CROSS JOIN project
       ON CONFLICT (job_type, project_id, publication_version, evidence_source_id, evidence_version)
       DO NOTHING
       RETURNING id`,
      [projectId],
    ),
  );
  return rows.length;
}

export async function enqueueRagSourceRevocation(
  db: OutboxQueryable,
  ragSourceId: string,
  actor: string,
): Promise<
  | { ok: true; status: 202; code: 'rag_revocation_queued'; message: string; ragSourceId: string; outboxJobId: string }
  | { ok: false; status: 404 | 422; code: string; message: string; ragSourceId: string }
> {
  const eventId = `review_${randomUUID()}`;
  const rows = normalizeRows(
    await db.query<{ outbox_job_id: string | null; evidence_source_id: string | null }>(
      `WITH source AS (
         SELECT rag.id, rag.project_id, rag.evidence_source_id, rag.evidence_version,
                rag.eligibility_state, project.publication_version
         FROM rag_sources AS rag
         JOIN projects AS project ON project.id = rag.project_id
         WHERE rag.id = $1
         FOR UPDATE
       ),
       revoked AS (
         UPDATE rag_sources AS rag
         SET eligibility_state = 'revoked',
             revoked_at = COALESCE(revoked_at, now()),
             failure_message = NULL,
             updated_at = now()
         FROM source
         WHERE rag.id = source.id
           AND source.evidence_source_id IS NOT NULL
         RETURNING rag.id
       ),
       queued AS (
         INSERT INTO publish_outbox (
           id, job_type, project_id, publication_version, evidence_source_id, evidence_version
         )
         SELECT portfolio_outbox_id('rag_revoke', source.project_id, source.publication_version,
                                    source.evidence_source_id, source.evidence_version),
                'rag_revoke', source.project_id, source.publication_version,
                source.evidence_source_id, source.evidence_version
         FROM source
         WHERE source.evidence_source_id IS NOT NULL AND EXISTS (SELECT 1 FROM revoked)
         ON CONFLICT (job_type, project_id, publication_version, evidence_source_id, evidence_version)
         DO UPDATE SET updated_at = publish_outbox.updated_at
         RETURNING id
       ),
       event AS (
         INSERT INTO review_events (
           id, project_id, actor, action, before_state, after_state, notes, metadata
         )
         SELECT $2, source.project_id, $3, 'rag_revoked', source.eligibility_state,
                'revoked', 'RAG source revoked DB-first and queued for remote cleanup.',
                jsonb_build_object('source', 'publish_outbox', 'ragSourceId', source.id,
                                   'outboxJobId', queued.id)
         FROM source CROSS JOIN queued
         WHERE source.eligibility_state <> 'revoked'
         RETURNING id
       )
       SELECT queued.id AS outbox_job_id, source.evidence_source_id
       FROM source LEFT JOIN queued ON true`,
      [ragSourceId, eventId, actor],
    ),
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, status: 404, code: 'rag_source_not_found', message: `RAG source ${ragSourceId} was not found.`, ragSourceId };
  }
  if (!row.evidence_source_id || !row.outbox_job_id) {
    return { ok: false, status: 422, code: 'rag_source_missing_evidence', message: 'RAG source has no evidence identity for durable cleanup.', ragSourceId };
  }
  return {
    ok: true,
    status: 202,
    code: 'rag_revocation_queued',
    message: 'RAG source revoked from public search and queued for remote cleanup.',
    ragSourceId,
    outboxJobId: row.outbox_job_id,
  };
}

export function outboxIdempotencyKey(job: Pick<ClaimedOutboxJob, 'job_type' | 'project_id' | 'publication_version' | 'evidence_source_id' | 'evidence_version'>): string {
  const evidence = job.evidence_source_id === null ? '-' : `${job.evidence_source_id.length}:${job.evidence_source_id}`;
  return `${job.job_type}:${job.project_id.length}:${job.project_id}:${String(job.publication_version)}:${evidence}:${job.evidence_version === null ? '-' : String(job.evidence_version)}`;
}

export function sanitizeOutboxError(error: unknown): string {
  if (error instanceof OutboxJobError) return error.code;
  if (error instanceof Error) return `unexpected_${normalizeErrorCode(error.name || 'error')}`.slice(0, 500);
  return `unexpected_${normalizeErrorCode(typeof error)}`.slice(0, 500);
}

function normalizeErrorCode(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.slice(0, 120) || 'error';
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}
