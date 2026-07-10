import type { RagIndexClient, RagQueryable } from '@/lib/rag/ingestion';
import { PUBLIC_RAG_VECTOR_STORE_NAME, publicRagAttributes } from '@/lib/rag/ingestion';
import {
  OUTBOX_MAX_BATCH,
  OutboxJobError,
  acknowledgeOutboxJob,
  claimOutboxJobs,
  failOutboxJob,
  outboxIdempotencyKey,
  persistOutboxRemoteOperation,
  sanitizeOutboxError,
  type ClaimedOutboxJob,
  type OutboxQueryable,
} from './queue';

const MAX_RUN_MS = 45_000;
const REMOTE_TIMEOUT_MS = 10_000;

type WorkerDb = OutboxQueryable & RagQueryable;

type RagRemoteRow = {
  id: string;
  project_id: string;
  evidence_source_id: string;
  evidence_version: string | number;
  publication_version: string | number;
  eligibility_state: string;
  openai_file_id: string | null;
  vector_store_id: string | null;
  remote_step: 'pending' | 'uploaded' | 'attached' | 'indexed' | 'detached' | 'revoked';
};

type IndexGateRow = RagRemoteRow & {
  project_lifecycle: string;
  current_publication_version: string | number;
  evidence_project_id: string | null;
  privacy_state: string;
  current_evidence_version: string | number;
  extracted_text: string | null;
  generated: boolean;
};

export interface OutboxWorkerOptions {
  workerId: string;
  limit?: number;
  deadlineMs?: number;
  leaseSeconds?: number;
  vectorStoreId?: string;
  siteRefreshDeployHookUrl?: string;
  fetchImpl?: typeof fetch;
  ragClient?: RagIndexClient;
  createRagClient?: () => RagIndexClient;
  now?: () => number;
}

export interface OutboxRunResult {
  claimed: number;
  succeeded: number;
  failed: number;
  staleClaims: number;
  deadlineReached: boolean;
}

export async function runOutboxBatch(db: WorkerDb, options: OutboxWorkerOptions): Promise<OutboxRunResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadlineMs = Math.min(Math.max(options.deadlineMs ?? MAX_RUN_MS, 1), MAX_RUN_MS);
  const deadlineAt = startedAt + deadlineMs;
  const jobs = await claimOutboxJobs(db, {
    workerId: options.workerId,
    limit: Math.min(options.limit ?? OUTBOX_MAX_BATCH, OUTBOX_MAX_BATCH),
    leaseSeconds: options.leaseSeconds,
  });
  const result: OutboxRunResult = {
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    staleClaims: 0,
    deadlineReached: false,
  };

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    if (now() >= deadlineAt) {
      result.deadlineReached = true;
      for (const remaining of jobs.slice(index)) {
        const released = await failOutboxJob(db, remaining.id, remaining.claim_token, new OutboxJobError('worker_deadline'));
        if (released.updated) result.failed += 1;
        else result.staleClaims += 1;
      }
      break;
    }

    try {
      await processClaimedJob(db, job, options, deadlineAt, now);
      const ack = await acknowledgeOutboxJob(db, job.id, job.claim_token);
      if (ack.updated) result.succeeded += 1;
      else result.staleClaims += 1;
    } catch (error) {
      if (job.job_type === 'rag_index' || job.job_type === 'rag_revoke') {
        try {
          await recordRagJobFailure(db, job, sanitizeOutboxError(error));
        } catch {
          // The outbox state remains the durable retry authority when the
          // secondary RAG diagnostic update is temporarily unavailable.
        }
      }
      const failed = await failOutboxJob(db, job.id, job.claim_token, error);
      if (failed.updated) result.failed += 1;
      else result.staleClaims += 1;
    }
  }

  return result;
}

async function processClaimedJob(
  db: WorkerDb,
  job: ClaimedOutboxJob,
  options: OutboxWorkerOptions,
  deadlineAt: number,
  now: () => number,
): Promise<void> {
  if (job.job_type === 'site_refresh') {
    await processSiteRefresh(db, job, options, deadlineAt, now);
    return;
  }
  if (job.job_type === 'rag_index') {
    if (!(await indexJobEligible(db, job))) return;
    const client = options.ragClient ?? options.createRagClient?.();
    if (!client) throw new OutboxJobError('rag_client_unconfigured');
    await processRagIndex(db, client, job, options.vectorStoreId, deadlineAt, now);
    return;
  }
  const client = options.ragClient ?? options.createRagClient?.();
  if (!client) throw new OutboxJobError('rag_client_unconfigured');
  await processRagRevoke(db, client, job, deadlineAt, now);
}

async function processSiteRefresh(
  db: WorkerDb,
  job: ClaimedOutboxJob,
  options: OutboxWorkerOptions,
  deadlineAt: number,
  now: () => number,
): Promise<void> {
  const current = normalizeRows(
    await db.query<{ lifecycle_state: string; publication_version: string | number }>(
      `SELECT lifecycle_state, publication_version FROM projects WHERE id = $1`,
      [job.project_id],
    ),
  )[0];
  if (!current || Number(current.publication_version) !== Number(job.publication_version)) {
    return;
  }
  const url = options.siteRefreshDeployHookUrl?.trim();
  if (!url) throw new OutboxJobError('site_refresh_unconfigured');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OutboxJobError('site_refresh_url_invalid');
  }
  if (parsed.protocol !== 'https:') throw new OutboxJobError('site_refresh_url_invalid');

  const signal = remoteSignal(deadlineAt, now);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(parsed, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': outboxIdempotencyKey(job) },
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw new OutboxJobError('site_refresh_timeout');
    throw new OutboxJobError('site_refresh_request_failed');
  }
  if (!response.ok) throw new OutboxJobError(`site_refresh_http_${response.status}`);

  const operationId = await readRemoteOperationId(response);
  if (operationId) {
    const persisted = await persistOutboxRemoteOperation(db, job.id, job.claim_token, operationId);
    if (!persisted) throw new OutboxJobError('site_refresh_claim_lost');
  }
}

async function processRagIndex(
  db: WorkerDb,
  client: RagIndexClient,
  job: ClaimedOutboxJob,
  configuredVectorStoreId: string | undefined,
  deadlineAt: number,
  now: () => number,
): Promise<void> {
  if (!job.evidence_source_id || job.evidence_version === null) throw new OutboxJobError('rag_index_identity_invalid');
  if (!(await indexJobEligible(db, job))) return;
  const source = await ensureRagSource(db, job);
  let gate = await loadIndexGate(db, source.id, job);
  if (!gateReady(gate, job)) return;

  if (!gate.openai_file_id) {
    const upload = await client.uploadFile({
      filename: `${source.id}.md`,
      content: gate.extracted_text!.trim(),
      idempotencyKey: `${outboxIdempotencyKey(job)}:upload`,
      signal: remoteSignal(deadlineAt, now),
    });
    const persisted = await persistRagStep(db, source.id, job, {
      openaiFileId: upload.fileId,
      remoteStep: 'uploaded',
    });
    if (!persisted) throw new OutboxJobError('rag_upload_persist_failed');
    await persistOutboxRemoteOperation(db, job.id, job.claim_token, upload.fileId);
    gate = await loadIndexGate(db, source.id, job);
    if (!gateReady(gate, job)) return;
  }

  if (!gate.vector_store_id) {
    const vectorStoreId = configuredVectorStoreId
      ?? await findExistingVectorStoreId(db)
      ?? (await client.createVectorStore({
        name: PUBLIC_RAG_VECTOR_STORE_NAME,
        idempotencyKey: `${outboxIdempotencyKey(job)}:vector-store`,
        signal: remoteSignal(deadlineAt, now),
      })).vectorStoreId;
    const persisted = await persistRagStep(db, source.id, job, { vectorStoreId });
    if (!persisted) throw new OutboxJobError('rag_vector_store_persist_failed');
    gate = await loadIndexGate(db, source.id, job);
    if (!gateReady(gate, job)) return;
  }

  if (gate.remote_step === 'pending' || gate.remote_step === 'uploaded') {
    gate = await loadIndexGate(db, source.id, job);
    if (!gateReady(gate, job)) return;
    await client.attachFile({
      vectorStoreId: gate.vector_store_id!,
      fileId: gate.openai_file_id!,
      attributes: publicRagAttributes(source.id, job.project_id),
      idempotencyKey: `${outboxIdempotencyKey(job)}:attach`,
      signal: remoteSignal(deadlineAt, now),
    });
    const persisted = await persistRagStep(db, source.id, job, { remoteStep: 'attached' });
    if (!persisted) throw new OutboxJobError('rag_attach_persist_failed');
    gate = await loadIndexGate(db, source.id, job);
    if (!gateReady(gate, job)) return;
  }

  if (gate.remote_step === 'indexed' && gate.eligibility_state === 'indexed') return;
  gate = await loadIndexGate(db, source.id, job);
  if (!gateReady(gate, job)) return;
  const status = await client.getFileIndexingStatus({
    vectorStoreId: gate.vector_store_id!,
    fileId: gate.openai_file_id!,
    signal: remoteSignal(deadlineAt, now),
  });
  if (status.status === 'in_progress') throw new OutboxJobError('rag_index_pending');
  if (status.status !== 'completed') throw new OutboxJobError(`rag_index_${status.status}`);
  const persisted = normalizeRows(
    await db.query<{ id: string }>(
      `UPDATE rag_sources
       SET eligibility_state = 'indexed', remote_step = 'indexed', failure_message = NULL,
           last_synced_at = now(), updated_at = now()
       WHERE id = $1 AND eligibility_state = 'indexing'
         AND evidence_version = $2 AND publication_version = $3
       RETURNING id`,
      [source.id, job.evidence_version, job.publication_version],
    ),
  ).length === 1;
  if (!persisted) throw new OutboxJobError('rag_index_persist_failed');
}

async function indexJobEligible(db: WorkerDb, job: ClaimedOutboxJob): Promise<boolean> {
  return normalizeRows(
    await db.query<{ id: string }>(
      `SELECT evidence.id
       FROM evidence_sources AS evidence
       JOIN projects AS project ON project.id = evidence.project_id
       WHERE evidence.id = $1
         AND evidence.project_id = $2
         AND evidence.evidence_version = $3
         AND evidence.privacy_state = 'safe_public'
         AND length(trim(COALESCE(evidence.extracted_text, ''))) > 0
         AND COALESCE(evidence.claim_map->>'generated', 'false') <> 'true'
         AND project.lifecycle_state = 'published'
         AND project.publication_version = $4`,
      [job.evidence_source_id, job.project_id, job.evidence_version, job.publication_version],
    ),
  ).length === 1;
}

async function processRagRevoke(
  db: WorkerDb,
  client: RagIndexClient,
  job: ClaimedOutboxJob,
  deadlineAt: number,
  now: () => number,
): Promise<void> {
  if (!job.evidence_source_id || job.evidence_version === null) throw new OutboxJobError('rag_revoke_identity_invalid');
  const sources = normalizeRows(
    await db.query<RagRemoteRow>(
      `UPDATE rag_sources
       SET eligibility_state = 'revoked', revoked_at = COALESCE(revoked_at, now()), updated_at = now()
       WHERE project_id = $1 AND evidence_source_id = $2 AND evidence_version = $3
       RETURNING id, project_id, evidence_source_id, evidence_version, publication_version,
                 eligibility_state, openai_file_id, vector_store_id, remote_step`,
      [job.project_id, job.evidence_source_id, job.evidence_version],
    ),
  );

  for (let source of sources) {
    if (source.remote_step !== 'detached' && source.remote_step !== 'revoked'
        && source.vector_store_id && source.openai_file_id) {
      try {
        await client.detachFile({
          vectorStoreId: source.vector_store_id,
          fileId: source.openai_file_id,
          signal: remoteSignal(deadlineAt, now),
        });
      } catch (error) {
        if (!isRemoteMissingError(error)) throw new OutboxJobError('rag_revoke_detach_failed');
      }
      await db.query(
        `UPDATE rag_sources SET remote_step = 'detached', updated_at = now()
         WHERE id = $1 AND eligibility_state = 'revoked'`,
        [source.id],
      );
      source = { ...source, remote_step: 'detached' };
    }

    if (source.openai_file_id) {
      try {
        await client.deleteFile({ fileId: source.openai_file_id, signal: remoteSignal(deadlineAt, now) });
      } catch (error) {
        if (!isRemoteMissingError(error)) throw new OutboxJobError('rag_revoke_delete_failed');
      }
    }
    await db.query(
      `UPDATE rag_sources
       SET openai_file_id = NULL, vector_store_id = NULL, remote_step = 'revoked',
           failure_message = NULL, updated_at = now()
       WHERE id = $1 AND eligibility_state = 'revoked'`,
      [source.id],
    );
  }
}

async function recordRagJobFailure(
  db: WorkerDb,
  job: ClaimedOutboxJob,
  failureCode: string,
): Promise<void> {
  await db.query(
    `UPDATE rag_sources AS rag
     SET failure_message = $6, updated_at = now()
     WHERE rag.project_id = $1
       AND rag.evidence_source_id = $2
       AND rag.evidence_version = $3
       AND EXISTS (
         SELECT 1 FROM publish_outbox AS job
         WHERE job.id = $4 AND job.state = 'processing' AND job.claim_token = $5::uuid
       )`,
    [job.project_id, job.evidence_source_id, job.evidence_version, job.id, job.claim_token, failureCode],
  );
}

async function ensureRagSource(db: WorkerDb, job: ClaimedOutboxJob): Promise<RagRemoteRow> {
  const existing = normalizeRows(
    await db.query<RagRemoteRow>(
      `SELECT id, project_id, evidence_source_id, evidence_version, publication_version,
              eligibility_state, openai_file_id, vector_store_id, remote_step
       FROM rag_sources
       WHERE project_id = $1 AND evidence_source_id = $2 AND evidence_version = $3
         AND eligibility_state IN ('eligible', 'indexing', 'indexed', 'failed')
       ORDER BY created_at DESC LIMIT 1`,
      [job.project_id, job.evidence_source_id, job.evidence_version],
    ),
  )[0];
  if (existing) {
    if (existing.eligibility_state === 'eligible' || existing.eligibility_state === 'indexing' || existing.eligibility_state === 'failed') {
      await db.query(
        `UPDATE rag_sources SET eligibility_state = 'indexing', publication_version = $2, updated_at = now()
         WHERE id = $1 AND eligibility_state IN ('eligible', 'indexing', 'failed')`,
        [existing.id, job.publication_version],
      );
      return { ...existing, eligibility_state: 'indexing', publication_version: job.publication_version };
    }
    return existing;
  }

  const id = `rag_${job.id}`;
  return normalizeRows(
    await db.query<RagRemoteRow>(
      `INSERT INTO rag_sources (
         id, project_id, evidence_source_id, evidence_version, publication_version,
         eligibility_state, remote_step
       ) VALUES ($1, $2, $3, $4, $5, 'indexing', 'pending')
       RETURNING id, project_id, evidence_source_id, evidence_version, publication_version,
                 eligibility_state, openai_file_id, vector_store_id, remote_step`,
      [id, job.project_id, job.evidence_source_id, job.evidence_version, job.publication_version],
    ),
  )[0]!;
}

async function loadIndexGate(db: WorkerDb, ragSourceId: string, job: ClaimedOutboxJob): Promise<IndexGateRow | null> {
  return normalizeRows(
    await db.query<IndexGateRow>(
      `SELECT rag.id, rag.project_id, rag.evidence_source_id, rag.evidence_version,
              rag.publication_version, rag.eligibility_state, rag.openai_file_id,
              rag.vector_store_id, rag.remote_step,
              project.lifecycle_state AS project_lifecycle,
              project.publication_version AS current_publication_version,
              evidence.project_id AS evidence_project_id,
              evidence.privacy_state,
              evidence.evidence_version AS current_evidence_version,
              evidence.extracted_text,
              COALESCE(evidence.claim_map->>'generated', 'false') = 'true' AS generated
       FROM rag_sources AS rag
       JOIN projects AS project ON project.id = rag.project_id
       JOIN evidence_sources AS evidence ON evidence.id = rag.evidence_source_id
       WHERE rag.id = $1 AND rag.project_id = $2 AND rag.evidence_source_id = $3
         AND rag.evidence_version = $4`,
      [ragSourceId, job.project_id, job.evidence_source_id, job.evidence_version],
    ),
  )[0] ?? null;
}

function gateReady(gate: IndexGateRow | null, job: ClaimedOutboxJob): gate is IndexGateRow {
  return Boolean(
    gate
    && gate.eligibility_state !== 'revoked'
    && gate.project_lifecycle === 'published'
    && Number(gate.current_publication_version) === Number(job.publication_version)
    && gate.evidence_project_id === job.project_id
    && gate.privacy_state === 'safe_public'
    && Number(gate.current_evidence_version) === Number(job.evidence_version)
    && !gate.generated
    && gate.extracted_text?.trim(),
  );
}

async function persistRagStep(
  db: WorkerDb,
  ragSourceId: string,
  job: ClaimedOutboxJob,
  values: { openaiFileId?: string; vectorStoreId?: string; remoteStep?: RagRemoteRow['remote_step'] },
): Promise<boolean> {
  return normalizeRows(
    await db.query<{ id: string }>(
      `UPDATE rag_sources
       SET openai_file_id = COALESCE($4, openai_file_id),
           vector_store_id = COALESCE($5, vector_store_id),
           remote_step = COALESCE($6, remote_step),
           updated_at = now()
       WHERE id = $1 AND evidence_version = $2 AND publication_version = $3
         AND eligibility_state = 'indexing'
       RETURNING id`,
      [ragSourceId, job.evidence_version, job.publication_version,
        values.openaiFileId ?? null, values.vectorStoreId ?? null, values.remoteStep ?? null],
    ),
  ).length === 1;
}

async function findExistingVectorStoreId(db: WorkerDb): Promise<string | undefined> {
  return normalizeRows(
    await db.query<{ vector_store_id: string }>(
      `SELECT vector_store_id FROM rag_sources
       WHERE vector_store_id IS NOT NULL AND remote_step IN ('attached', 'indexed')
       ORDER BY updated_at DESC LIMIT 1`,
    ),
  )[0]?.vector_store_id;
}

function remoteSignal(deadlineAt: number, now: () => number): AbortSignal {
  const remaining = Math.max(1, Math.min(REMOTE_TIMEOUT_MS, deadlineAt - now()));
  return AbortSignal.timeout(remaining);
}

async function readRemoteOperationId(response: Response): Promise<string | null> {
  const fromHeader = response.headers.get('x-vercel-deployment-id') ?? response.headers.get('x-operation-id');
  if (fromHeader?.trim()) return fromHeader.trim().slice(0, 256);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  const raw = (await response.text()).slice(0, 8_192);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ['id', 'jobId', 'deploymentId', 'operationId']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 256);
    }
  } catch {
    return null;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function isRemoteMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = 'status' in error ? Reflect.get(error, 'status') : undefined;
  return status === 404;
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}
