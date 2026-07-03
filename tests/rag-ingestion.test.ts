import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import {
  buildPublicFileSearchTool,
  ingestRagSource,
  listSearchableRagSources,
  markRagSourceEligible,
  publicRagAttributes,
  revokeRagSource,
  type RagIndexClient,
} from '../src/lib/rag/ingestion';

const ACTOR = 'rag-ingestion-test';

async function createTestDb(): Promise<Queryable> {
  const db = new PGlite() as Queryable;
  await applyMigrations(db);
  return db;
}

async function insertProject(
  db: Queryable,
  id: string,
  lifecycleState: 'shadow' | 'draft_only' | 'published' = 'published',
): Promise<void> {
  await db.query(
    `INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state, published_at)
     VALUES ($1, $1, 'RAG test project', 'RAG test tagline', 'Agents & MCP', 2026, $2, $3)`,
    [id, lifecycleState, lifecycleState === 'published' ? new Date().toISOString() : null],
  );
}

async function insertEvidence(
  db: Queryable,
  id: string,
  overrides: {
    projectId?: string | null;
    draftId?: string | null;
    privacyState?: string;
    extractedText?: string | null;
    claimMap?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (id, project_id, draft_id, source_type, source_ref, privacy_state, extracted_text, claim_map)
     VALUES ($1, $2, $3, 'readme', 'test:readme', $4, $5, $6::jsonb)`,
    [
      id,
      overrides.projectId ?? null,
      overrides.draftId ?? null,
      overrides.privacyState ?? 'safe_public',
      overrides.extractedText === undefined ? 'Public readme evidence text.' : overrides.extractedText,
      JSON.stringify(overrides.claimMap ?? {}),
    ],
  );
}

interface FakeClientOptions {
  statuses?: Array<'in_progress' | 'completed' | 'cancelled' | 'failed'>;
  failUpload?: boolean;
  failDetach?: boolean;
}

function createFakeClient(options: FakeClientOptions = {}) {
  const statuses = [...(options.statuses ?? ['completed'])];
  const calls: Record<string, unknown[]> = {
    uploadFile: [],
    createVectorStore: [],
    attachFile: [],
    getFileIndexingStatus: [],
    detachFile: [],
    deleteFile: [],
  };
  let fileCounter = 0;
  const client: RagIndexClient = {
    async uploadFile(input) {
      calls.uploadFile.push(input);
      if (options.failUpload) throw new Error('upload rejected');
      fileCounter += 1;
      return { fileId: `file_${fileCounter}` };
    },
    async createVectorStore(input) {
      calls.createVectorStore.push(input);
      return { vectorStoreId: 'vs_test' };
    },
    async attachFile(input) {
      calls.attachFile.push(input);
    },
    async getFileIndexingStatus(input) {
      calls.getFileIndexingStatus.push(input);
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      return { status, errorMessage: status === 'failed' ? 'chunking exploded' : null };
    },
    async detachFile(input) {
      calls.detachFile.push(input);
      if (options.failDetach) throw new Error('detach rejected');
    },
    async deleteFile(input) {
      calls.deleteFile.push(input);
    },
  };
  return { client, calls };
}

async function fetchRagRow(db: Queryable, id: string) {
  const result = await db.query<{
    eligibility_state: string;
    openai_file_id: string | null;
    vector_store_id: string | null;
    failure_message: string | null;
    revoked_at: string | null;
    last_synced_at: string | null;
  }>(
    `SELECT eligibility_state, openai_file_id, vector_store_id, failure_message, revoked_at, last_synced_at
     FROM rag_sources WHERE id = $1`,
    [id],
  );
  return (Array.isArray(result) ? result : result.rows)[0];
}

test('approved public evidence walks the full eligible -> indexing -> indexed lifecycle', async () => {
  const db = await createTestDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-public', { projectId: 'proj-rag' });

  const marked = await markRagSourceEligible(db, {
    projectId: 'proj-rag',
    evidenceSourceId: 'ev-public',
    actor: ACTOR,
  });
  assert.equal(marked.ok, true);
  assert.equal(marked.code, 'rag_source_eligible');
  const ragSourceId = marked.ragSourceId as string;
  assert.equal((await fetchRagRow(db, ragSourceId))?.eligibility_state, 'eligible');

  const { client, calls } = createFakeClient({ statuses: ['in_progress', 'completed'] });
  const ingested = await ingestRagSource(db, client, ragSourceId, ACTOR, {
    poll: { maxAttempts: 5, sleep: async () => {} },
  });
  assert.equal(ingested.ok, true);
  assert.equal(ingested.code, 'rag_source_indexed');

  const row = await fetchRagRow(db, ragSourceId);
  assert.equal(row?.eligibility_state, 'indexed');
  assert.equal(row?.openai_file_id, 'file_1');
  assert.equal(row?.vector_store_id, 'vs_test');
  assert.ok(row?.last_synced_at);

  assert.equal(calls.getFileIndexingStatus.length, 2);
  assert.deepEqual((calls.attachFile[0] as { attributes: unknown }).attributes, {
    rag_source_id: ragSourceId,
    project_id: 'proj-rag',
    visibility: 'public',
  });
  assert.deepEqual(publicRagAttributes(ragSourceId, 'proj-rag'), {
    rag_source_id: ragSourceId,
    project_id: 'proj-rag',
    visibility: 'public',
  });

  const events = await db.query<{ action: string; after_state: string | null }>(
    `SELECT action, after_state FROM review_events WHERE project_id = 'proj-rag' ORDER BY created_at`,
  );
  const rows = Array.isArray(events) ? events : events.rows;
  assert.deepEqual(
    rows.map((event) => [event.action, event.after_state]),
    [
      ['rag_marked_eligible', 'eligible'],
      ['note', 'indexed'],
    ],
  );
});

test('non-public sources cannot be marked eligible or uploaded', async () => {
  const db = await createTestDb();
  await insertProject(db, 'proj-rag');
  await insertProject(db, 'proj-draft', 'draft_only');
  await db.query(`INSERT INTO project_drafts (id, lifecycle_state) VALUES ('draft-hidden', 'hidden')`);

  await insertEvidence(db, 'ev-unreviewed', { projectId: 'proj-rag', privacyState: 'unreviewed' });
  await insertEvidence(db, 'ev-blocked', { projectId: 'proj-rag', privacyState: 'blocked' });
  await insertEvidence(db, 'ev-draft-private', { projectId: 'proj-rag', privacyState: 'private_allowed_for_draft' });
  await insertEvidence(db, 'ev-hidden-draft', { draftId: 'draft-hidden' });
  await insertEvidence(db, 'ev-generated', { projectId: 'proj-rag', claimMap: { generated: true } });
  await insertEvidence(db, 'ev-empty', { projectId: 'proj-rag', extractedText: '   ' });
  await insertEvidence(db, 'ev-unpublished', { projectId: 'proj-draft' });

  const cases: Array<[string, string, string]> = [
    ['proj-rag', 'ev-unreviewed', 'evidence_not_public'],
    ['proj-rag', 'ev-blocked', 'evidence_not_public'],
    ['proj-rag', 'ev-draft-private', 'evidence_not_public'],
    ['proj-rag', 'ev-hidden-draft', 'evidence_not_linked_to_project'],
    ['proj-rag', 'ev-generated', 'evidence_generated'],
    ['proj-rag', 'ev-empty', 'evidence_empty'],
    ['proj-draft', 'ev-unpublished', 'project_not_published'],
    ['proj-rag', 'ev-missing', 'evidence_not_found'],
  ];
  for (const [projectId, evidenceSourceId, code] of cases) {
    const result = await markRagSourceEligible(db, { projectId, evidenceSourceId, actor: ACTOR });
    assert.equal(result.ok, false, `${evidenceSourceId} should be rejected`);
    assert.equal(result.code, code);
  }

  const countResult = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM rag_sources`);
  assert.equal((Array.isArray(countResult) ? countResult : countResult.rows)[0]?.count, '0');
});

test('eligibility is re-checked at upload time and revoked approvals never reach OpenAI', async () => {
  const db = await createTestDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-public', { projectId: 'proj-rag' });

  const marked = await markRagSourceEligible(db, {
    projectId: 'proj-rag',
    evidenceSourceId: 'ev-public',
    actor: ACTOR,
  });
  const ragSourceId = marked.ragSourceId as string;

  await db.query(`UPDATE evidence_sources SET privacy_state = 'blocked' WHERE id = 'ev-public'`);

  const { client, calls } = createFakeClient();
  const result = await ingestRagSource(db, client, ragSourceId, ACTOR);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'rag_eligibility_revalidation_failed');
  assert.equal(result.cause, 'evidence_not_public');
  assert.equal(calls.uploadFile.length, 0);
  assert.equal((await fetchRagRow(db, ragSourceId))?.eligibility_state, 'not_eligible');

  const retry = await ingestRagSource(db, client, ragSourceId, ACTOR);
  assert.equal(retry.ok, false);
  assert.equal(retry.code, 'rag_source_not_eligible');
});

test('public file_search filters are structurally mandatory and only cover indexed sources', async () => {
  const db = await createTestDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-a', { projectId: 'proj-rag' });
  await insertEvidence(db, 'ev-b', { projectId: 'proj-rag' });

  assert.equal(buildPublicFileSearchTool(await listSearchableRagSources(db)), null);

  const markedA = await markRagSourceEligible(db, { projectId: 'proj-rag', evidenceSourceId: 'ev-a', actor: ACTOR });
  const markedB = await markRagSourceEligible(db, { projectId: 'proj-rag', evidenceSourceId: 'ev-b', actor: ACTOR });
  const idA = markedA.ragSourceId as string;
  const idB = markedB.ragSourceId as string;

  const { client, calls } = createFakeClient();
  await ingestRagSource(db, client, idA, ACTOR);

  // A second ingestion reuses the vector store recorded on an indexed row
  // instead of creating one store per source.
  await ingestRagSource(db, client, idB, ACTOR);
  assert.equal(calls.createVectorStore.length, 1);
  await revokeRagSource(db, client, idB, ACTOR);

  const searchable = await listSearchableRagSources(db);
  assert.deepEqual(searchable.map((source) => source.id), [idA]);

  const tool = buildPublicFileSearchTool(searchable);
  assert.ok(tool);
  assert.equal(tool.type, 'file_search');
  assert.deepEqual(tool.vector_store_ids, ['vs_test']);
  assert.deepEqual(tool.filters, {
    type: 'and',
    filters: [
      { type: 'eq', key: 'visibility', value: 'public' },
      { type: 'in', key: 'project_id', value: ['proj-rag'] },
      { type: 'in', key: 'rag_source_id', value: [idA] },
    ],
  });
  assert.ok(!tool.filters.filters.some((filter) => filter.key === 'rag_source_id' && Array.isArray(filter.value) && filter.value.includes(idB)));
});

test('indexed sources stop being searchable when public approval drifts after indexing', async () => {
  const db = await createTestDb();
  await insertProject(db, 'proj-drift');
  await insertEvidence(db, 'ev-project-draft', { projectId: 'proj-drift' });
  await insertEvidence(db, 'ev-private', { projectId: 'proj-drift' });
  await insertEvidence(db, 'ev-generated', { projectId: 'proj-drift' });
  await insertEvidence(db, 'ev-empty', { projectId: 'proj-drift' });
  await insertEvidence(db, 'ev-still-public', { projectId: 'proj-drift' });

  const markedIds: string[] = [];
  for (const evidenceSourceId of ['ev-project-draft', 'ev-private', 'ev-generated', 'ev-empty', 'ev-still-public']) {
    const marked = await markRagSourceEligible(db, { projectId: 'proj-drift', evidenceSourceId, actor: ACTOR });
    assert.equal(marked.ok, true);
    markedIds.push(marked.ragSourceId as string);
  }

  const { client } = createFakeClient();
  for (const ragSourceId of markedIds) {
    const ingested = await ingestRagSource(db, client, ragSourceId, ACTOR);
    assert.equal(ingested.ok, true);
  }
  assert.deepEqual((await listSearchableRagSources(db)).map((source) => source.id).sort(), [...markedIds].sort());

  await db.query(`UPDATE projects SET lifecycle_state = 'draft_only', published_at = NULL WHERE id = 'proj-drift'`);
  assert.deepEqual(await listSearchableRagSources(db), []);

  await db.query(
    `UPDATE projects SET lifecycle_state = 'published', published_at = '2026-06-28T00:00:00.000Z' WHERE id = 'proj-drift'`,
  );
  await db.query(`UPDATE evidence_sources SET privacy_state = 'blocked' WHERE id = 'ev-private'`);
  await db.query(`UPDATE evidence_sources SET claim_map = '{"generated": true}'::jsonb WHERE id = 'ev-generated'`);
  await db.query(`UPDATE evidence_sources SET extracted_text = '   ' WHERE id = 'ev-empty'`);

  assert.deepEqual(
    (await listSearchableRagSources(db)).map((source) => source.id).sort(),
    [markedIds[0], markedIds[4]].sort(),
  );
});

test('indexing failure disables RAG without rolling back the published project', async () => {
  const db = await createTestDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-public', { projectId: 'proj-rag' });
  const marked = await markRagSourceEligible(db, {
    projectId: 'proj-rag',
    evidenceSourceId: 'ev-public',
    actor: ACTOR,
  });
  const ragSourceId = marked.ragSourceId as string;

  const { client, calls } = createFakeClient({ statuses: ['in_progress', 'failed'] });
  const result = await ingestRagSource(db, client, ragSourceId, ACTOR, {
    poll: { maxAttempts: 5, sleep: async () => {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'rag_indexing_failed');
  assert.match(result.message as string, /chunking exploded/);

  const row = await fetchRagRow(db, ragSourceId);
  assert.equal(row?.eligibility_state, 'failed');
  assert.match(row?.failure_message ?? '', /chunking exploded/);
  assert.equal(row?.openai_file_id, null);
  assert.equal(row?.vector_store_id, null);
  assert.equal(calls.deleteFile.length, 1);

  const project = await db.query<{ lifecycle_state: string; published_at: string | null }>(
    `SELECT lifecycle_state, published_at FROM projects WHERE id = 'proj-rag'`,
  );
  const projectRow = (Array.isArray(project) ? project : project.rows)[0];
  assert.equal(projectRow?.lifecycle_state, 'published');
  assert.ok(projectRow?.published_at);

  assert.deepEqual(await listSearchableRagSources(db), []);
});

test('revocation blocks retrieval in the DB before remote cleanup completes', async () => {
  const db = await createTestDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-public', { projectId: 'proj-rag' });
  const marked = await markRagSourceEligible(db, {
    projectId: 'proj-rag',
    evidenceSourceId: 'ev-public',
    actor: ACTOR,
  });
  const ragSourceId = marked.ragSourceId as string;
  const { client } = createFakeClient();
  await ingestRagSource(db, client, ragSourceId, ACTOR);
  assert.equal((await listSearchableRagSources(db)).length, 1);

  const { client: failingClient, calls } = createFakeClient({ failDetach: true });
  const revoked = await revokeRagSource(db, failingClient, ragSourceId, ACTOR);
  assert.equal(revoked.ok, true);
  assert.equal(revoked.code, 'rag_source_revoked');
  assert.equal(revoked.cleanup, 'failed');
  assert.equal(calls.detachFile.length, 1);

  const row = await fetchRagRow(db, ragSourceId);
  assert.equal(row?.eligibility_state, 'revoked');
  assert.ok(row?.revoked_at);
  assert.match(row?.failure_message ?? '', /Revocation cleanup failed/);
  assert.deepEqual(await listSearchableRagSources(db), []);

  const events = await db.query<{ action: string }>(
    `SELECT action FROM review_events WHERE project_id = 'proj-rag' AND action = 'rag_revoked'`,
  );
  assert.equal((Array.isArray(events) ? events : events.rows).length, 1);

  // Remote handles survive the failed cleanup, so re-marking is blocked until
  // cleanup succeeds; otherwise the OpenAI file would be orphaned forever.
  const blockedRemark = await markRagSourceEligible(db, {
    projectId: 'proj-rag',
    evidenceSourceId: 'ev-public',
    actor: ACTOR,
  });
  assert.equal(blockedRemark.ok, false);
  assert.equal(blockedRemark.code, 'rag_source_cleanup_pending');
  const pendingRow = await fetchRagRow(db, ragSourceId);
  assert.equal(pendingRow?.openai_file_id, 'file_1');
  assert.equal(pendingRow?.vector_store_id, 'vs_test');

  // Revoking again with a working client retries and completes the cleanup.
  const { client: workingClient, calls: retryCalls } = createFakeClient();
  const retried = await revokeRagSource(db, workingClient, ragSourceId, ACTOR);
  assert.equal(retried.ok, true);
  assert.equal(retried.code, 'rag_source_revoked');
  assert.equal(retried.cleanup, 'completed');
  assert.equal(retryCalls.detachFile.length, 1);
  assert.equal(retryCalls.deleteFile.length, 1);

  const cleanedRow = await fetchRagRow(db, ragSourceId);
  assert.equal(cleanedRow?.eligibility_state, 'revoked');
  assert.equal(cleanedRow?.openai_file_id, null);
  assert.equal(cleanedRow?.vector_store_id, null);
  assert.equal(cleanedRow?.failure_message, null);

  // Only one rag_revoked event: the retry does not double-log the revocation.
  const retryEvents = await db.query<{ action: string }>(
    `SELECT action FROM review_events WHERE project_id = 'proj-rag' AND action = 'rag_revoked'`,
  );
  assert.equal((Array.isArray(retryEvents) ? retryEvents : retryEvents.rows).length, 1);

  const again = await revokeRagSource(db, workingClient, ragSourceId, ACTOR);
  assert.equal(again.ok, true);
  assert.equal(again.code, 'rag_source_already_revoked');

  const remark = await markRagSourceEligible(db, {
    projectId: 'proj-rag',
    evidenceSourceId: 'ev-public',
    actor: ACTOR,
  });
  assert.equal(remark.ok, true);
  const remarkRow = await fetchRagRow(db, ragSourceId);
  assert.equal(remarkRow?.eligibility_state, 'eligible');
  assert.equal(remarkRow?.revoked_at, null);
});
