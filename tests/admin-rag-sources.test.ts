import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import { type AdminSessionResult } from '@/lib/admin/auth';
import { type RagIndexClient } from '@/lib/rag/ingestion';
import {
  createAdminRagSourcesGetHandler,
  createAdminRagSourcesPostHandler,
} from '@/pages/api/admin/rag-sources';

const NOW = '2026-07-02T12:00:00.000Z';
const ACTOR = 'github:dylan';

const AUTHORIZED_SESSION = (): AdminSessionResult => ({ ok: true, actor: ACTOR });
const UNAUTHENTICATED_SESSION = (): AdminSessionResult => ({
  ok: false,
  status: 401,
  code: 'admin_unauthenticated',
  message: 'Admin authentication is required.',
});

type JsonBody = Record<string, unknown>;
type QueryResult<Row> = { rows: Row[] } | Row[];

interface FakeClientOptions {
  statuses?: Array<'in_progress' | 'completed' | 'cancelled' | 'failed'>;
  failDetach?: boolean;
}

interface FakeClientCalls {
  uploadFile: Array<{ filename: string; content: string }>;
  createVectorStore: Array<{ name: string }>;
  attachFile: Array<{ vectorStoreId: string; fileId: string; attributes: Record<string, string> }>;
  getFileIndexingStatus: Array<{ vectorStoreId: string; fileId: string }>;
  detachFile: Array<{ vectorStoreId: string; fileId: string }>;
  deleteFile: Array<{ fileId: string }>;
}

function createFakeClient(options: FakeClientOptions = {}): { client: RagIndexClient; calls: FakeClientCalls } {
  const statuses = [...(options.statuses ?? ['completed'])];
  const calls: FakeClientCalls = {
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
      fileCounter += 1;
      return { fileId: `file_${fileCounter}` };
    },
    async createVectorStore(input) {
      calls.createVectorStore.push(input);
      return { vectorStoreId: 'vs_created_by_fake' };
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

function noClientCalls(calls: FakeClientCalls): void {
  assert.deepEqual(calls, {
    uploadFile: [],
    createVectorStore: [],
    attachFile: [],
    getFileIndexingStatus: [],
    detachFile: [],
    deleteFile: [],
  });
}

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

async function createMigratedDb(): Promise<Queryable> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

function jsonRequest(url: string, body: JsonBody = {}, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function rawJsonRequest(url: string, body: string): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}

function getRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

async function responseJson(response: Response): Promise<JsonBody> {
  return (await response.json()) as JsonBody;
}

function rows<Row>(result: QueryResult<Row>): Row[] {
  return Array.isArray(result) ? result : result.rows;
}

async function insertProject(
  db: Queryable,
  id: string,
  lifecycleState: 'shadow' | 'draft_only' | 'published' = 'published',
): Promise<void> {
  await db.query(
    `INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state, published_at)
     VALUES ($1, $1, $2, 'RAG route tagline', 'Agents & MCP', 2026, $3, $4)`,
    [id, `RAG route project ${id}`, lifecycleState, lifecycleState === 'published' ? NOW : null],
  );
}

async function insertEvidence(
  db: Queryable,
  id: string,
  overrides: {
    projectId?: string | null;
    draftId?: string | null;
    candidateId?: string | null;
    privacyState?: string;
    extractedText?: string | null;
    extractedTextSha256?: string | null;
    claimMap?: Record<string, unknown>;
    sourceUrl?: string | null;
    repoVisibility?: 'public' | 'private' | 'unknown';
  } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (
       id, project_id, draft_id, candidate_id, source_type, source_url, source_ref,
       repo_visibility, privacy_state, extracted_text, extracted_text_sha256, claim_map
     )
     VALUES ($1, $2, $3, $4, 'readme', $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      id,
      overrides.projectId ?? null,
      overrides.draftId ?? null,
      overrides.candidateId ?? null,
      overrides.sourceUrl ?? `https://example.test/${id}`,
      `test:${id}`,
      overrides.repoVisibility ?? 'public',
      overrides.privacyState ?? 'safe_public',
      overrides.extractedText === undefined ? 'Public readme evidence text.' : overrides.extractedText,
      overrides.extractedTextSha256 ?? `sha256:${id}`,
      JSON.stringify(overrides.claimMap ?? {}),
    ],
  );
}

async function insertPrivateLinkedEvidenceFixture(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO scan_runs (id, trigger, actor, lifecycle_state, started_at, finished_at)
     VALUES ('scan-private-sentinel', 'test', 'test', 'completed', $1, $1)`,
    [NOW],
  );
  await db.query(
    `INSERT INTO project_candidates (id, scan_run_id, source_kind, source_ref, repo_visibility, evidence_packet, lifecycle_state)
     VALUES ('candidate-private-sentinel', 'scan-private-sentinel', 'github_repo', 'https://example.test/private', 'private', $1::jsonb, 'draft_requested')`,
    [JSON.stringify({ secret: 'SECRET_EVIDENCE_PACKET' })],
  );
  await db.query(
    `INSERT INTO project_drafts (id, candidate_id, private_notes, lifecycle_state)
     VALUES ('draft-private-sentinel', 'candidate-private-sentinel', 'SECRET_PRIVATE_NOTES', 'hidden')`,
  );
  await insertEvidence(db, 'ev-private-sentinel', {
    projectId: 'proj-list',
    draftId: 'draft-private-sentinel',
    candidateId: 'candidate-private-sentinel',
    extractedText: 'SECRET_RAW_TEXT should never be serialized to the admin RAG list.',
    extractedTextSha256: 'sha256:raw-text-digest',
    claimMap: { generated: true, secret: 'SECRET_CLAIM_MAP' },
    repoVisibility: 'private',
  });
}

async function postRag(
  db: Queryable,
  body: JsonBody,
  options: { ragClient?: RagIndexClient; sleep?: () => Promise<void> } = {},
): Promise<Response> {
  const POST = createAdminRagSourcesPostHandler({
    db,
    session: AUTHORIZED_SESSION,
    ragClient: options.ragClient,
    ingestOptions: { vectorStoreId: 'vs_route', poll: { maxAttempts: 5, sleep: options.sleep ?? (async () => {}) } },
  });
  return POST({ request: jsonRequest('https://example.test/api/admin/rag-sources', body) } as never);
}

async function markEligible(db: Queryable, projectId: string, evidenceSourceId: string): Promise<JsonBody> {
  const response = await postRag(db, { action: 'mark_eligible', projectId, evidenceSourceId, actor: 'body-spoof' });
  assert.equal(response.status, 200);
  const json = await responseJson(response);
  assert.equal(json.ok, true);
  assert.equal(json.code, 'rag_source_eligible');
  assert.equal(typeof json.ragSourceId, 'string');
  return json;
}

async function fetchRagRow(db: Queryable, id: string) {
  const result = await db.query<{
    eligibility_state: string;
    openai_file_id: string | null;
    vector_store_id: string | null;
    failure_message: string | null;
    revoked_at: string | null;
  }>(
    `SELECT eligibility_state, openai_file_id, vector_store_id, failure_message, revoked_at
     FROM rag_sources WHERE id = $1`,
    [id],
  );
  return rows(result)[0];
}

async function fetchReviewEvents(db: Queryable, action: string) {
  const result = await db.query<{ actor: string; action: string; before_state: string | null; after_state: string | null }>(
    `SELECT actor, action, before_state, after_state
     FROM review_events WHERE action = $1 ORDER BY created_at`,
    [action],
  );
  return rows(result);
}

async function countRagRowsForEvidence(db: Queryable, evidenceSourceId: string): Promise<number> {
  const result = await db.query<{ count: string | number }>(
    `SELECT count(*)::text AS count FROM rag_sources WHERE evidence_source_id = $1`,
    [evidenceSourceId],
  );
  return Number(rows(result)[0]?.count ?? 0);
}

function responseField(source: JsonBody, ...names: string[]): unknown {
  for (const name of names) {
    if (name in source) return source[name];
  }
  return undefined;
}

test('RAG admin routes enforce request gates before database or client work', async () => {
  let getCreateClientCalls = 0;
  const GET = createAdminRagSourcesGetHandler({
    session: UNAUTHENTICATED_SESSION,
    createClient: () => {
      getCreateClientCalls += 1;
      throw new Error('GET should authorize before creating a database client');
    },
  });

  const getResponse = await GET({ request: getRequest('https://example.test/api/admin/rag-sources') } as never);
  assert.equal(getResponse.status, 401);
  assert.equal((await responseJson(getResponse)).code, 'admin_unauthenticated');
  assert.equal(getCreateClientCalls, 0);

  const { client, calls } = createFakeClient();
  let csrfSessionCalls = 0;
  let csrfCreateClientCalls = 0;
  const csrfPost = createAdminRagSourcesPostHandler({
    session: () => {
      csrfSessionCalls += 1;
      return AUTHORIZED_SESSION();
    },
    ragClient: client,
    createClient: () => {
      csrfCreateClientCalls += 1;
      throw new Error('CSRF rejection should happen before DB creation');
    },
  });
  const csrfResponse = await csrfPost({
    request: new Request('https://example.test/api/admin/rag-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'mark_eligible' }),
    }),
  } as never);
  assert.equal(csrfResponse.status, 403);
  assert.equal((await responseJson(csrfResponse)).code, 'admin_csrf_content_type');
  assert.equal(csrfSessionCalls, 0);
  assert.equal(csrfCreateClientCalls, 0);
  noClientCalls(calls);

  let unauthCreateClientCalls = 0;
  const unauthPost = createAdminRagSourcesPostHandler({
    session: UNAUTHENTICATED_SESSION,
    ragClient: client,
    createClient: () => {
      unauthCreateClientCalls += 1;
      throw new Error('Unauthenticated POST should not create a database client');
    },
  });
  const unauthResponse = await unauthPost({
    request: rawJsonRequest('https://example.test/api/admin/rag-sources', '{'),
  } as never);
  assert.equal(unauthResponse.status, 401);
  assert.equal((await responseJson(unauthResponse)).code, 'admin_unauthenticated');
  assert.equal(unauthCreateClientCalls, 0);
  noClientCalls(calls);

  const invalidRequests: Array<{ name: string; request: Request; code: string }> = [
    {
      name: 'malformed JSON',
      request: rawJsonRequest('https://example.test/api/admin/rag-sources', '{'),
      code: 'invalid_json',
    },
    {
      name: 'non-object body',
      request: rawJsonRequest('https://example.test/api/admin/rag-sources', '[]'),
      code: 'invalid_body',
    },
    {
      name: 'unknown action',
      request: jsonRequest('https://example.test/api/admin/rag-sources', { action: 'delete_everything' }),
      code: 'invalid_action',
    },
    {
      name: 'missing mark_eligible evidenceSourceId',
      request: jsonRequest('https://example.test/api/admin/rag-sources', { action: 'mark_eligible', projectId: 'proj-rag' }),
      code: 'invalid_body',
    },
  ];

  for (const invalid of invalidRequests) {
    let createClientCalls = 0;
    const POST = createAdminRagSourcesPostHandler({
      session: AUTHORIZED_SESSION,
      ragClient: client,
      createClient: () => {
        createClientCalls += 1;
        throw new Error(`${invalid.name} should fail before DB creation`);
      },
    });

    const response = await POST({ request: invalid.request } as never);
    assert.equal(response.status, 400, invalid.name);
    assert.equal((await responseJson(response)).code, invalid.code, invalid.name);
    assert.equal(createClientCalls, 0, invalid.name);
    noClientCalls(calls);
  }
});

test('GET lists project-linked sources without serializing raw evidence or private review fields', async () => {
  const db = await createMigratedDb();
  await insertProject(db, 'proj-list');
  await insertPrivateLinkedEvidenceFixture(db);
  await insertEvidence(db, 'ev-candidate-only', {
    projectId: null,
    candidateId: 'candidate-private-sentinel',
    extractedText: 'SECRET_CANDIDATE_ONLY_TEXT',
  });

  const GET = createAdminRagSourcesGetHandler({ db, session: AUTHORIZED_SESSION });
  const response = await GET({ request: getRequest('https://example.test/api/admin/rag-sources') } as never);
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(json.ok, true);
  assert.equal(json.code, 'rag_sources_listed');
  assert.ok(Array.isArray(json.sources));

  const serialized = JSON.stringify(json.sources);
  assert.equal(serialized.includes('SECRET_RAW_TEXT'), false);
  assert.equal(serialized.includes('SECRET_CLAIM_MAP'), false);
  assert.equal(serialized.includes('SECRET_PRIVATE_NOTES'), false);
  assert.equal(serialized.includes('SECRET_EVIDENCE_PACKET'), false);
  assert.equal(serialized.includes('SECRET_CANDIDATE_ONLY_TEXT'), false);

  const sources = json.sources as JsonBody[];
  assert.equal(sources.length, 1);
  const [source] = sources;
  assert.equal(responseField(source, 'evidenceSourceId', 'evidence_source_id', 'id'), 'ev-private-sentinel');
  assert.equal(responseField(source, 'project_id', 'projectId'), 'proj-list');
  assert.equal(responseField(source, 'extracted_text_sha256', 'extractedTextSha256'), 'sha256:raw-text-digest');
  assert.equal(Number(responseField(source, 'extracted_text_chars', 'extractedTextChars')), 'SECRET_RAW_TEXT should never be serialized to the admin RAG list.'.length);
  assert.equal(responseField(source, 'generated'), true);
});

test('mark_eligible succeeds for approved evidence and rejects unsafe evidence without client work', async () => {
  const db = await createMigratedDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-public', { projectId: 'proj-rag' });
  await insertEvidence(db, 'ev-blocked', { projectId: 'proj-rag', privacyState: 'blocked' });

  const { client, calls } = createFakeClient();
  const POST = createAdminRagSourcesPostHandler({ db, session: AUTHORIZED_SESSION, ragClient: client });

  const success = await POST({
    request: jsonRequest('https://example.test/api/admin/rag-sources', {
      action: 'mark_eligible',
      projectId: 'proj-rag',
      evidenceSourceId: 'ev-public',
      actor: 'body-spoof',
    }),
  } as never);
  const successJson = await responseJson(success);
  assert.equal(success.status, 200);
  assert.equal(successJson.ok, true);
  assert.equal(successJson.code, 'rag_source_eligible');
  assert.equal((await fetchRagRow(db, successJson.ragSourceId as string))?.eligibility_state, 'eligible');

  const markedEvents = await fetchReviewEvents(db, 'rag_marked_eligible');
  assert.equal(markedEvents.length, 1);
  assert.equal(markedEvents[0].actor, ACTOR);

  const unsafe = await POST({
    request: jsonRequest('https://example.test/api/admin/rag-sources', {
      action: 'mark_eligible',
      projectId: 'proj-rag',
      evidenceSourceId: 'ev-blocked',
    }),
  } as never);
  const unsafeJson = await responseJson(unsafe);
  assert.equal(unsafe.status, 422);
  assert.equal(unsafeJson.ok, false);
  assert.equal(unsafeJson.code, 'evidence_not_public');
  assert.equal(await countRagRowsForEvidence(db, 'ev-blocked'), 0);
  noClientCalls(calls);
});

test('ingest action indexes through the injected RAG client without network or sleeps', async () => {
  const db = await createMigratedDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-public', { projectId: 'proj-rag' });
  const marked = await markEligible(db, 'proj-rag', 'ev-public');
  const ragSourceId = marked.ragSourceId as string;

  const { client, calls } = createFakeClient({ statuses: ['in_progress', 'completed'] });
  let sleepCalls = 0;
  const response = await postRag(
    db,
    { action: 'ingest', ragSourceId, actor: 'body-spoof' },
    {
      ragClient: client,
      sleep: async () => {
        sleepCalls += 1;
      },
    },
  );
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.code, 'rag_source_indexed');
  assert.equal(json.ragSourceId, ragSourceId);
  assert.equal(sleepCalls, 1);
  assert.deepEqual(calls.uploadFile, [{ filename: `${ragSourceId}.md`, content: 'Public readme evidence text.' }]);
  assert.deepEqual(calls.createVectorStore, []);
  assert.deepEqual(calls.attachFile, [
    {
      vectorStoreId: 'vs_route',
      fileId: 'file_1',
      attributes: { rag_source_id: ragSourceId, project_id: 'proj-rag', visibility: 'public' },
    },
  ]);
  assert.equal(calls.getFileIndexingStatus.length, 2);

  const row = await fetchRagRow(db, ragSourceId);
  assert.equal(row?.eligibility_state, 'indexed');
  assert.equal(row?.openai_file_id, 'file_1');
  assert.equal(row?.vector_store_id, 'vs_route');

  const noteEvents = await fetchReviewEvents(db, 'note');
  assert.equal(noteEvents.at(-1)?.actor, ACTOR);
  assert.equal(noteEvents.at(-1)?.after_state, 'indexed');
});

test('revoke returns DB-first cleanup failures as a successful revocation response', async () => {
  const db = await createMigratedDb();
  await insertProject(db, 'proj-rag');
  await insertEvidence(db, 'ev-public', { projectId: 'proj-rag' });
  const marked = await markEligible(db, 'proj-rag', 'ev-public');
  const ragSourceId = marked.ragSourceId as string;

  const { client: indexingClient } = createFakeClient();
  const ingest = await postRag(db, { action: 'ingest', ragSourceId }, { ragClient: indexingClient });
  assert.equal(ingest.status, 200);
  assert.equal((await fetchRagRow(db, ragSourceId))?.eligibility_state, 'indexed');

  const { client: failingClient, calls } = createFakeClient({ failDetach: true });
  const response = await postRag(db, { action: 'revoke', ragSourceId, actor: 'body-spoof' }, { ragClient: failingClient });
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.code, 'rag_source_revoked');
  assert.equal(json.cleanup, 'failed');
  assert.match(String(json.cleanupError), /detach rejected/);

  assert.deepEqual(calls.detachFile, [{ vectorStoreId: 'vs_route', fileId: 'file_1' }]);
  assert.deepEqual(calls.deleteFile, []);

  const row = await fetchRagRow(db, ragSourceId);
  assert.equal(row?.eligibility_state, 'revoked');
  assert.ok(row?.revoked_at);
  assert.equal(row?.openai_file_id, 'file_1');
  assert.equal(row?.vector_store_id, 'vs_route');
  assert.match(row?.failure_message ?? '', /Revocation cleanup failed: detach rejected/);

  const revokedEvents = await fetchReviewEvents(db, 'rag_revoked');
  assert.equal(revokedEvents.length, 1);
  assert.equal(revokedEvents[0].actor, ACTOR);
  assert.equal(revokedEvents[0].before_state, 'indexed');
  assert.equal(revokedEvents[0].after_state, 'revoked');
});
