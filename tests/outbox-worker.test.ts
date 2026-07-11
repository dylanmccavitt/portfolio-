import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import {
  acknowledgeOutboxJob,
  claimOutboxJobs,
  failOutboxJob,
  OutboxJobError,
  outboxIdempotencyKey,
  type OutboxQueryable,
} from '@/lib/outbox/queue';
import { runOutboxBatch } from '@/lib/outbox/worker';
import type { RagIndexClient } from '@/lib/rag/ingestion';
import { createOutboxRunPostHandler } from '@/pages/api/admin/outbox/run';

async function createDb(): Promise<Queryable> {
  const db = new PGlite() as Queryable;
  await applyMigrations(db);
  return db;
}

async function insertProject(db: Queryable, id: string, publicationVersion = 1): Promise<void> {
  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, published_at, publication_version
     ) VALUES ($1, $1, 'Outbox project', 'Outbox project', 'AI & Developer Tools',
               2026, 'published', now(), $2)`,
    [id, publicationVersion],
  );
}

async function insertEvidence(
  db: Queryable,
  input: { id: string; projectId: string; privacy?: string; text?: string; version?: number },
): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (
       id, project_id, source_type, source_ref, privacy_state, extracted_text,
       extracted_text_sha256, claim_map, evidence_version
     ) VALUES ($1, $2, 'readme', $1, $3, $4, repeat('a', 64), '{}'::jsonb, $5)`,
    [input.id, input.projectId, input.privacy ?? 'safe_public', input.text ?? 'Approved public evidence.', input.version ?? 1],
  );
}

async function insertJob(
  db: Queryable,
  input: { id: string; type: 'site_refresh' | 'rag_index' | 'rag_revoke'; projectId: string; publicationVersion: number; evidenceId?: string; evidenceVersion?: number },
): Promise<void> {
  await db.query(
    `INSERT INTO publish_outbox (
       id, job_type, project_id, publication_version, evidence_source_id, evidence_version
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.id, input.type, input.projectId, input.publicationVersion, input.evidenceId ?? null, input.evidenceVersion ?? null],
  );
}

function rows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}

interface FakeRagOptions {
  statuses?: Array<'in_progress' | 'completed' | 'failed' | 'cancelled'>;
  failDeleteOnce?: boolean;
}

function fakeRagClient(options: FakeRagOptions = {}): {
  client: RagIndexClient;
  calls: Record<string, Array<Record<string, unknown>>>;
  remoteFiles: Map<string, string>;
  remoteStores: Map<string, string>;
} {
  const calls: Record<string, Array<Record<string, unknown>>> = {
    upload: [], create: [], attach: [], status: [], detach: [], delete: [],
  };
  const remoteFiles = new Map<string, string>();
  const remoteStores = new Map<string, string>();
  const statuses = [...(options.statuses ?? ['completed'])];
  let deleteFailureRemaining = options.failDeleteOnce ? 1 : 0;
  const client: RagIndexClient = {
    async uploadFile(input) {
      calls.upload!.push(input);
      const key = input.idempotencyKey ?? `upload-${calls.upload!.length}`;
      const id = remoteFiles.get(key) ?? `file_${remoteFiles.size + 1}`;
      remoteFiles.set(key, id);
      return { fileId: id };
    },
    async createVectorStore(input) {
      calls.create!.push(input);
      const key = input.idempotencyKey ?? `create-${calls.create!.length}`;
      const id = remoteStores.get(key) ?? `vs_${remoteStores.size + 1}`;
      remoteStores.set(key, id);
      return { vectorStoreId: id };
    },
    async attachFile(input) {
      calls.attach!.push(input);
    },
    async getFileIndexingStatus(input) {
      calls.status!.push(input);
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      return { status, errorMessage: status === 'failed' ? 'remote details stay sanitized' : null };
    },
    async detachFile(input) {
      calls.detach!.push(input);
    },
    async deleteFile(input) {
      calls.delete!.push(input);
      if (deleteFailureRemaining > 0) {
        deleteFailureRemaining -= 1;
        throw new Error('secret cleanup endpoint failed');
      }
    },
  };
  return { client, calls, remoteFiles, remoteStores };
}

test('claims are exclusive and an expired worker cannot acknowledge after reclaim', async () => {
  const db = await createDb();
  await insertProject(db, 'lease-project', 2);
  await insertJob(db, { id: 'site-lease-one', type: 'site_refresh', projectId: 'lease-project', publicationVersion: 1 });
  await insertJob(db, { id: 'site-lease-two', type: 'site_refresh', projectId: 'lease-project', publicationVersion: 2 });

  const [first, second] = await Promise.all([
    claimOutboxJobs(db, { workerId: 'worker-a', limit: 1, claimToken: '11111111-1111-4111-8111-111111111111' }),
    claimOutboxJobs(db, { workerId: 'worker-b', limit: 1, claimToken: '22222222-2222-4222-8222-222222222222' }),
  ]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0]!.id, second[0]!.id);

  await db.query(`UPDATE publish_outbox SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [first[0]!.id]);
  const reclaimed = await claimOutboxJobs(db, {
    workerId: 'worker-c',
    limit: 1,
    claimToken: '33333333-3333-4333-8333-333333333333',
  });
  assert.equal(reclaimed[0]?.id, first[0]!.id);
  assert.equal((await acknowledgeOutboxJob(db, first[0]!.id, first[0]!.claim_token)).updated, false);
  assert.equal((await acknowledgeOutboxJob(db, reclaimed[0]!.id, reclaimed[0]!.claim_token)).updated, true);
  assert.equal((await acknowledgeOutboxJob(db, second[0]!.id, second[0]!.claim_token)).updated, true);
});

test('retry backoff follows the bounded 30-second exponential schedule', async () => {
  const db = await createDb();
  await insertProject(db, 'backoff-project');
  await insertJob(db, { id: 'backoff-job', type: 'site_refresh', projectId: 'backoff-project', publicationVersion: 1 });
  const first = (await claimOutboxJobs(db, {
    workerId: 'backoff-one', claimToken: '11111111-aaaa-4111-8111-111111111111', limit: 1,
  }))[0]!;
  await failOutboxJob(db, first.id, first.claim_token, new OutboxJobError('first_failure'));
  let row = rows(await db.query<{ attempts: number; delay_seconds: number }>(
    `SELECT attempts, round(extract(epoch FROM (next_attempt_at - updated_at)))::integer AS delay_seconds
     FROM publish_outbox WHERE id = 'backoff-job'`,
  ))[0];
  assert.deepEqual(row, { attempts: 1, delay_seconds: 30 });

  await db.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE id = 'backoff-job'`);
  const second = (await claimOutboxJobs(db, {
    workerId: 'backoff-two', claimToken: '22222222-bbbb-4222-8222-222222222222', limit: 1,
  }))[0]!;
  await failOutboxJob(db, second.id, second.claim_token, new OutboxJobError('second_failure'));
  row = rows(await db.query<{ attempts: number; delay_seconds: number }>(
    `SELECT attempts, round(extract(epoch FROM (next_attempt_at - updated_at)))::integer AS delay_seconds
     FROM publish_outbox WHERE id = 'backoff-job'`,
  ))[0];
  assert.deepEqual(row, { attempts: 2, delay_seconds: 60 });
});

test('RAG indexing resumes from durable upload/attach state without duplicate remote objects', async () => {
  const db = await createDb();
  await insertProject(db, 'rag-project');
  await insertEvidence(db, { id: 'rag-evidence', projectId: 'rag-project' });
  await insertJob(db, {
    id: 'rag-index-job', type: 'rag_index', projectId: 'rag-project', publicationVersion: 1,
    evidenceId: 'rag-evidence', evidenceVersion: 1,
  });
  const fake = fakeRagClient({ statuses: ['in_progress', 'completed'] });

  const first = await runOutboxBatch(db, { workerId: 'rag-worker-one', ragClient: fake.client });
  assert.deepEqual(first, { claimed: 1, succeeded: 0, failed: 1, staleClaims: 0, deadlineReached: false });
  const durable = rows(await db.query<{
    eligibility_state: string; openai_file_id: string; vector_store_id: string; remote_step: string;
  }>(`SELECT eligibility_state, openai_file_id, vector_store_id, remote_step FROM rag_sources`))[0];
  assert.deepEqual(durable, {
    eligibility_state: 'indexing', openai_file_id: 'file_1', vector_store_id: 'vs_1', remote_step: 'attached',
  });
  await db.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE id = 'rag-index-job'`);

  const second = await runOutboxBatch(db, { workerId: 'rag-worker-two', ragClient: fake.client });
  assert.equal(second.succeeded, 1);
  assert.equal(fake.calls.upload!.length, 1);
  assert.equal(fake.calls.create!.length, 1);
  assert.equal(fake.calls.attach!.length, 1);
  assert.equal(fake.calls.status!.length, 2);
  assert.equal(fake.remoteFiles.size, 1);
  assert.equal(fake.remoteStores.size, 1);
  const indexed = rows(await db.query<{ eligibility_state: string; remote_step: string }>(
    `SELECT eligibility_state, remote_step FROM rag_sources`,
  ))[0];
  assert.deepEqual(indexed, { eligibility_state: 'indexed', remote_step: 'indexed' });
});

test('a response-before-vector-persist retry reuses the deterministic remote idempotency key', async () => {
  const db = await createDb();
  await insertProject(db, 'vector-crash-project');
  await insertEvidence(db, { id: 'vector-crash-evidence', projectId: 'vector-crash-project' });
  await insertJob(db, {
    id: 'vector-crash-job', type: 'rag_index', projectId: 'vector-crash-project', publicationVersion: 1,
    evidenceId: 'vector-crash-evidence', evidenceVersion: 1,
  });
  const fake = fakeRagClient();
  let failVectorPersist = true;
  const crashDb: OutboxQueryable = {
    async query<Row>(sql: string, params?: unknown[]) {
      if (failVectorPersist && sql.includes('vector_store_id = COALESCE') && params?.[4]) {
        failVectorPersist = false;
        throw new Error('simulated crash before vector handle persistence');
      }
      return db.query<Row>(sql, params);
    },
  };
  const first = await runOutboxBatch(crashDb, { workerId: 'vector-crash-one', ragClient: fake.client });
  assert.equal(first.failed, 1);
  await db.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE id = 'vector-crash-job'`);
  const second = await runOutboxBatch(db, { workerId: 'vector-crash-two', ragClient: fake.client });
  assert.equal(second.succeeded, 1);
  assert.equal(fake.calls.create!.length, 2, 'the remote request is retried');
  assert.equal(fake.remoteStores.size, 1, 'the idempotency key resolves both responses to one remote store');
});

test('upload and attach response crashes retry with the same remote identities', async () => {
  const uploadDb = await createDb();
  await insertProject(uploadDb, 'upload-crash-project');
  await insertEvidence(uploadDb, { id: 'upload-crash-evidence', projectId: 'upload-crash-project' });
  await insertJob(uploadDb, {
    id: 'upload-crash-job', type: 'rag_index', projectId: 'upload-crash-project', publicationVersion: 1,
    evidenceId: 'upload-crash-evidence', evidenceVersion: 1,
  });
  const uploadFake = fakeRagClient();
  let crashAfterUploadResponse = true;
  const uploadClient: RagIndexClient = {
    ...uploadFake.client,
    async uploadFile(input) {
      const response = await uploadFake.client.uploadFile(input);
      if (crashAfterUploadResponse) {
        crashAfterUploadResponse = false;
        throw new Error('simulated crash after upload response');
      }
      return response;
    },
  };
  assert.equal((await runOutboxBatch(uploadDb, { workerId: 'upload-crash-one', ragClient: uploadClient })).failed, 1);
  await uploadDb.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE id = 'upload-crash-job'`);
  assert.equal((await runOutboxBatch(uploadDb, { workerId: 'upload-crash-two', ragClient: uploadClient })).succeeded, 1);
  assert.equal(uploadFake.calls.upload!.length, 2);
  assert.equal(uploadFake.remoteFiles.size, 1);
  assert.equal(uploadFake.calls.upload![0]?.idempotencyKey, uploadFake.calls.upload![1]?.idempotencyKey);

  const attachDb = await createDb();
  await insertProject(attachDb, 'attach-crash-project');
  await insertEvidence(attachDb, { id: 'attach-crash-evidence', projectId: 'attach-crash-project' });
  await insertJob(attachDb, {
    id: 'attach-crash-job', type: 'rag_index', projectId: 'attach-crash-project', publicationVersion: 1,
    evidenceId: 'attach-crash-evidence', evidenceVersion: 1,
  });
  const attachFake = fakeRagClient();
  let crashAfterAttachResponse = true;
  const attachClient: RagIndexClient = {
    ...attachFake.client,
    async attachFile(input) {
      await attachFake.client.attachFile(input);
      if (crashAfterAttachResponse) {
        crashAfterAttachResponse = false;
        throw new Error('simulated crash after attach response');
      }
    },
  };
  assert.equal((await runOutboxBatch(attachDb, { workerId: 'attach-crash-one', ragClient: attachClient })).failed, 1);
  const durable = rows(await attachDb.query<{ openai_file_id: string; vector_store_id: string; remote_step: string }>(
    `SELECT openai_file_id, vector_store_id, remote_step FROM rag_sources`,
  ))[0];
  assert.deepEqual(durable, { openai_file_id: 'file_1', vector_store_id: 'vs_1', remote_step: 'uploaded' });
  await attachDb.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE id = 'attach-crash-job'`);
  assert.equal((await runOutboxBatch(attachDb, { workerId: 'attach-crash-two', ragClient: attachClient })).succeeded, 1);
  assert.equal(attachFake.calls.attach!.length, 2);
  assert.equal(attachFake.calls.attach![0]?.idempotencyKey, attachFake.calls.attach![1]?.idempotencyKey);
});

test('a crash after remote index completion resumes from attached state', async () => {
  const db = await createDb();
  await insertProject(db, 'completion-crash-project');
  await insertEvidence(db, { id: 'completion-crash-evidence', projectId: 'completion-crash-project' });
  await insertJob(db, {
    id: 'completion-crash-job', type: 'rag_index', projectId: 'completion-crash-project', publicationVersion: 1,
    evidenceId: 'completion-crash-evidence', evidenceVersion: 1,
  });
  const fake = fakeRagClient();
  let crashAfterCompletion = true;
  const crashDb: OutboxQueryable = {
    async query<Row>(sql: string, params?: unknown[]) {
      if (crashAfterCompletion && sql.includes("SET eligibility_state = 'indexed'")) {
        crashAfterCompletion = false;
        throw new Error('simulated crash after completed status');
      }
      return db.query<Row>(sql, params);
    },
  };
  assert.equal((await runOutboxBatch(crashDb, { workerId: 'completion-crash-one', ragClient: fake.client })).failed, 1);
  assert.equal(rows(await db.query<{ remote_step: string }>(`SELECT remote_step FROM rag_sources`))[0]?.remote_step, 'attached');
  await db.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE id = 'completion-crash-job'`);
  assert.equal((await runOutboxBatch(db, { workerId: 'completion-crash-two', ragClient: fake.client })).succeeded, 1);
  assert.equal(fake.calls.upload!.length, 1);
  assert.equal(fake.calls.create!.length, 1);
  assert.equal(fake.calls.attach!.length, 1);
  assert.equal(fake.calls.status!.length, 2);
});

test('private evidence is acknowledged without upload and privacy downgrade cleanup is retryable', async () => {
  const db = await createDb();
  await insertProject(db, 'privacy-project');
  await insertEvidence(db, { id: 'private-evidence', projectId: 'privacy-project', privacy: 'private_allowed_for_draft' });
  await insertJob(db, {
    id: 'private-index-job', type: 'rag_index', projectId: 'privacy-project', publicationVersion: 1,
    evidenceId: 'private-evidence', evidenceVersion: 1,
  });
  const fake = fakeRagClient({ failDeleteOnce: true });
  const privateRun = await runOutboxBatch(db, { workerId: 'privacy-worker' });
  assert.equal(privateRun.succeeded, 1);
  assert.equal(fake.calls.upload!.length, 0);
  assert.equal(rows(await db.query(`SELECT id FROM rag_sources WHERE evidence_source_id = 'private-evidence'`)).length, 0);

  await insertEvidence(db, { id: 'public-evidence', projectId: 'privacy-project' });
  await db.query(
    `INSERT INTO rag_sources (
       id, project_id, evidence_source_id, evidence_version, publication_version,
       eligibility_state, openai_file_id, vector_store_id, remote_step
     ) VALUES ('privacy-rag', 'privacy-project', 'public-evidence', 1, 1,
               'indexed', 'file-private-cleanup', 'vs-private-cleanup', 'indexed')`,
  );
  await db.query(`UPDATE evidence_sources SET privacy_state = 'blocked' WHERE id = 'public-evidence'`);
  const revokedBeforeRemote = rows(await db.query<{ eligibility_state: string }>(
    `SELECT eligibility_state FROM rag_sources WHERE id = 'privacy-rag'`,
  ))[0];
  assert.equal(revokedBeforeRemote?.eligibility_state, 'revoked');

  const failedCleanup = await runOutboxBatch(db, { workerId: 'revoke-worker-one', ragClient: fake.client });
  assert.equal(failedCleanup.failed, 1);
  assert.equal(fake.calls.detach!.length, 1);
  assert.equal(fake.calls.delete!.length, 1);
  await db.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE job_type = 'rag_revoke'`);
  const cleanup = await runOutboxBatch(db, { workerId: 'revoke-worker-two', ragClient: fake.client });
  assert.equal(cleanup.succeeded, 1);
  assert.equal(fake.calls.detach!.length, 1, 'persisted detached state skips a duplicate detach');
  assert.equal(fake.calls.delete!.length, 2);
  const cleaned = rows(await db.query<{ openai_file_id: string | null; vector_store_id: string | null; remote_step: string }>(
    `SELECT openai_file_id, vector_store_id, remote_step FROM rag_sources WHERE id = 'privacy-rag'`,
  ))[0];
  assert.deepEqual(cleaned, { openai_file_id: null, vector_store_id: null, remote_step: 'revoked' });
  const failure = rows(await db.query<{ last_error: string | null }>(
    `SELECT last_error FROM publish_outbox WHERE job_type = 'rag_revoke'`,
  ))[0];
  assert.equal(failure?.last_error, null);
});

test('site refresh uses the exact outbox identity and persists its operation before ack', async () => {
  const db = await createDb();
  await insertProject(db, 'refresh-project');
  await insertJob(db, { id: 'refresh-job', type: 'site_refresh', projectId: 'refresh-project', publicationVersion: 1 });
  let receivedKey = '';
  const result = await runOutboxBatch(db, {
    workerId: 'refresh-worker',
    siteRefreshDeployHookUrl: 'https://deploy.example.test/hook/redacted',
    fetchImpl: async (_input, init) => {
      receivedKey = new Headers(init?.headers).get('x-idempotency-key') ?? '';
      return new Response(JSON.stringify({ deploymentId: 'deployment_123' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(result.succeeded, 1);
  const job = rows(await db.query<{
    job_type: 'site_refresh'; project_id: string; publication_version: number; evidence_source_id: null;
    evidence_version: null; remote_operation_id: string; state: string;
  }>(`SELECT * FROM publish_outbox WHERE id = 'refresh-job'`))[0]!;
  assert.equal(receivedKey, outboxIdempotencyKey(job));
  assert.equal(job.remote_operation_id, 'deployment_123');
  assert.equal(job.state, 'succeeded');
});

test('unpublish advances the publication version and queues a fresh site removal build', async () => {
  const db = await createDb();
  await insertProject(db, 'unpublish-refresh-project');
  await insertJob(db, {
    id: 'prior-publish-refresh', type: 'site_refresh', projectId: 'unpublish-refresh-project', publicationVersion: 1,
  });
  await db.query(`UPDATE publish_outbox SET state = 'succeeded' WHERE id = 'prior-publish-refresh'`);
  await db.query(
    `UPDATE projects SET lifecycle_state = 'archived', archived_at = now()
     WHERE id = 'unpublish-refresh-project'`,
  );
  assert.equal(Number(rows(await db.query<{ publication_version: string | number }>(
    `SELECT publication_version FROM projects WHERE id = 'unpublish-refresh-project'`,
  ))[0]?.publication_version), 2);
  const queued = rows(await db.query<{ id: string; publication_version: string | number; state: string }>(
    `SELECT id, publication_version, state FROM publish_outbox
     WHERE project_id = 'unpublish-refresh-project' ORDER BY publication_version`,
  ));
  assert.deepEqual(queued.map((row) => ({ ...row, publication_version: Number(row.publication_version) })), [
    { id: 'prior-publish-refresh', publication_version: 1, state: 'succeeded' },
    {
      id: 'site_refresh:25:unpublish-refresh-project:2:-:-',
      publication_version: 2,
      state: 'queued',
    },
  ]);

  let calls = 0;
  const result = await runOutboxBatch(db, {
    workerId: 'unpublish-refresh-worker',
    siteRefreshDeployHookUrl: 'https://deploy.example.test/hook/redacted',
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(result.succeeded, 1);
  assert.equal(calls, 1);
});

test('bounded retries dead-letter sanitized failures and worker route enforces a 32-byte bearer', async () => {
  const db = await createDb();
  await insertProject(db, 'dead-project');
  await insertJob(db, { id: 'dead-site-job', type: 'site_refresh', projectId: 'dead-project', publicationVersion: 1 });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await runOutboxBatch(db, { workerId: `dead-worker-${attempt}` });
    await db.query(`UPDATE publish_outbox SET next_attempt_at = now() WHERE id = 'dead-site-job' AND state = 'queued'`);
  }
  const dead = rows(await db.query<{ state: string; attempts: number; last_error: string }>(
    `SELECT state, attempts, last_error FROM publish_outbox WHERE id = 'dead-site-job'`,
  ))[0];
  assert.deepEqual(dead, { state: 'dead', attempts: 5, last_error: 'site_refresh_unconfigured' });

  await insertJob(db, { id: 'crashed-fifth-job', type: 'site_refresh', projectId: 'dead-project', publicationVersion: 2 });
  await db.query(
    `UPDATE publish_outbox
     SET state = 'processing', attempts = 5, lease_expires_at = now() - interval '1 second',
         claim_token = '55555555-5555-4555-8555-555555555555', worker_id = 'crashed-worker'
     WHERE id = 'crashed-fifth-job'`,
  );
  assert.deepEqual(await claimOutboxJobs(db, { workerId: 'reaper', limit: 1 }), []);
  const reaped = rows(await db.query<{ state: string; last_error: string }>(
    `SELECT state, last_error FROM publish_outbox WHERE id = 'crashed-fifth-job'`,
  ))[0];
  assert.deepEqual(reaped, { state: 'dead', last_error: 'lease_expired_after_max_attempts' });

  const token = 'a'.repeat(32);
  const handler = createOutboxRunPostHandler({ db, env: { OUTBOX_WORKER_TOKEN: token } });
  const unauthorized = await handler({ request: new Request('https://example.test/api/admin/outbox/run', { method: 'POST' }) } as never);
  assert.equal(unauthorized.status, 401);
  const authorized = await handler({
    request: new Request('https://example.test/api/admin/outbox/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://forged.example' },
    }),
  } as never);
  assert.equal(authorized.status, 200);
  const short = createOutboxRunPostHandler({ db, env: { OUTBOX_WORKER_TOKEN: 'too-short' } });
  const unconfigured = await short({
    request: new Request('https://example.test/api/admin/outbox/run', {
      method: 'POST', headers: { Authorization: 'Bearer too-short' },
    }),
  } as never);
  assert.equal(unconfigured.status, 503);
});
