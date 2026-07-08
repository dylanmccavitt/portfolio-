import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import { ingestRagSource, markRagSourceEligible, type RagIndexClient } from '@/lib/rag/ingestion';
import {
  createPublicRagSearchConfig,
  publicRagCitationsFromFileSearchResult,
  publicRagProjectIds,
} from '@/lib/rag/retrieval';

const ACTOR = 'rag-retrieval-test';

async function createTestDb(): Promise<Queryable> {
  const db = new PGlite() as Queryable;
  await applyMigrations(db);
  return db;
}

async function insertProject(db: Queryable, id: string): Promise<void> {
  await db.query(
    `INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state, published_at)
     VALUES ($1, $1, 'RAG retrieval project', 'Approved public source retrieval', 'Agents & MCP', 2026, 'published', $2)`,
    [id, new Date().toISOString()],
  );
}

async function insertEvidence(db: Queryable, id: string, projectId: string): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (id, project_id, source_type, source_ref, privacy_state, extracted_text, claim_map)
     VALUES ($1, $2, 'readme', 'test:readme', 'safe_public', $3, '{}'::jsonb)`,
    [id, projectId, 'Approved public evidence text with enough detail to support a public answer.'],
  );
}

function createFakeClient() {
  let fileCounter = 0;
  const client: RagIndexClient = {
    async uploadFile() {
      fileCounter += 1;
      return { fileId: `file_${fileCounter}` };
    },
    async createVectorStore() {
      return { vectorStoreId: 'vs_public' };
    },
    async attachFile() {},
    async getFileIndexingStatus() {
      return { status: 'completed' as const, errorMessage: null };
    },
    async detachFile() {},
    async deleteFile() {},
  };
  return client;
}

async function indexedPublicSource(db: Queryable) {
  await insertProject(db, 'proj-public-rag');
  await insertEvidence(db, 'ev-public-rag', 'proj-public-rag');
  const marked = await markRagSourceEligible(db, {
    projectId: 'proj-public-rag',
    evidenceSourceId: 'ev-public-rag',
    actor: ACTOR,
  });
  assert.equal(marked.ok, true);

  const ragSourceId = marked.ragSourceId as string;
  const ingested = await ingestRagSource(db, createFakeClient(), ragSourceId, ACTOR);
  assert.equal(ingested.ok, true);
  return ragSourceId;
}

test('published indexed approved source creates constrained search config and maps file_search citations', async () => {
  const db = await createTestDb();
  const ragSourceId = await indexedPublicSource(db);

  const config = await createPublicRagSearchConfig(db, { maxNumResults: 3, scoreThreshold: 0.4, minTextChars: 16 });
  assert.ok(config);
  assert.deepEqual(config.sources, [
    {
      id: ragSourceId,
      project_id: 'proj-public-rag',
      vector_store_id: 'vs_public',
      openai_file_id: 'file_1',
    },
  ]);
  assert.deepEqual(config.tool, {
    vectorStoreIds: ['vs_public'],
    filters: {
      type: 'and',
      filters: [
        { type: 'eq', key: 'visibility', value: 'public' },
        { type: 'in', key: 'project_id', value: ['proj-public-rag'] },
        { type: 'in', key: 'rag_source_id', value: [ragSourceId] },
      ],
    },
    maxNumResults: 3,
    ranking: { ranker: 'auto', scoreThreshold: 0.4 },
  });

  const citations = publicRagCitationsFromFileSearchResult(
    {
      results: [
        {
          fileId: 'file_1',
          filename: 'approved-readme.md',
          score: 0.91,
          text: 'Approved public source text that is long enough to cite in a public DM answer.',
          attributes: {
            visibility: 'public',
            project_id: 'proj-public-rag',
            rag_source_id: ragSourceId,
          },
        },
      ],
    },
    config,
  );

  assert.deepEqual(citations, [
    {
      ragSourceId,
      projectId: 'proj-public-rag',
      fileId: 'file_1',
      filename: 'approved-readme.md',
      score: 0.91,
      text: 'Approved public source text that is long enough to cite in a public DM answer.',
    },
  ]);
  assert.deepEqual(publicRagProjectIds(citations), ['proj-public-rag']);
});

test('file_search results without relevance scores are rejected even when source metadata matches', async () => {
  const db = await createTestDb();
  const ragSourceId = await indexedPublicSource(db);
  const config = await createPublicRagSearchConfig(db, { scoreThreshold: 0.5, minTextChars: 40 });
  assert.ok(config);

  const citations = publicRagCitationsFromFileSearchResult(
    {
      results: [
        {
          fileId: 'file_1',
          filename: 'approved-readme.md',
          text: 'Approved public source text is long enough and has matching metadata, but it lacks a relevance score.',
          attributes: {
            visibility: 'public',
            project_id: 'proj-public-rag',
            rag_source_id: ragSourceId,
          },
        },
      ],
    },
    config,
  );

  assert.deepEqual(citations, []);
});

test('file_search results without an approved file identity are rejected even when source metadata matches', async () => {
  const db = await createTestDb();
  const ragSourceId = await indexedPublicSource(db);
  const config = await createPublicRagSearchConfig(db, { scoreThreshold: 0.5, minTextChars: 40 });
  assert.ok(config);

  const citations = publicRagCitationsFromFileSearchResult(
    {
      results: [
        {
          fileId: 'file_stale_or_unapproved',
          filename: 'stale-approved-metadata.md',
          score: 0.95,
          text: 'This result carries approved public source metadata and enough text, but its file identity is not approved.',
          attributes: {
            visibility: 'public',
            project_id: 'proj-public-rag',
            rag_source_id: ragSourceId,
          },
        },
        {
          filename: 'missing-file-id.md',
          score: 0.95,
          text: 'This result also carries approved public source metadata and enough text, but it has no file identity.',
          attributes: {
            visibility: 'public',
            project_id: 'proj-public-rag',
            rag_source_id: ragSourceId,
          },
        },
      ],
    },
    config,
  );

  assert.deepEqual(citations, []);
});

test('weak or irrelevant file_search results produce no citations so callers can fall back safely', async () => {
  const db = await createTestDb();
  const ragSourceId = await indexedPublicSource(db);
  const config = await createPublicRagSearchConfig(db, { scoreThreshold: 0.5, minTextChars: 40 });
  assert.ok(config);

  const citations = publicRagCitationsFromFileSearchResult(
    {
      results: [
        {
          fileId: 'file_1',
          filename: 'low-score.md',
          score: 0.49,
          text: 'This public text is long enough but below the configured relevance score threshold.',
          attributes: { visibility: 'public', project_id: 'proj-public-rag', rag_source_id: ragSourceId },
        },
        {
          fileId: 'file_1',
          filename: 'short.md',
          score: 0.95,
          text: 'Too short.',
          attributes: { visibility: 'public', project_id: 'proj-public-rag', rag_source_id: ragSourceId },
        },
        {
          fileId: 'file_1',
          filename: 'empty.md',
          score: 0.95,
          text: '   ',
          attributes: { visibility: 'public', project_id: 'proj-public-rag', rag_source_id: ragSourceId },
        },
        {
          fileId: 'file_unknown',
          filename: 'unknown.md',
          score: 0.95,
          text: 'Unknown source text is long enough, but it is not from an indexed approved source.',
          attributes: { visibility: 'public', project_id: 'proj-unknown', rag_source_id: 'rag-unknown' },
        },
        {
          fileId: 'file_1',
          filename: 'private.md',
          score: 0.95,
          text: 'Private source text is long enough, but it must never become a public citation.',
          attributes: { visibility: 'private', project_id: 'proj-public-rag', rag_source_id: ragSourceId },
        },
        {
          fileId: 'file_1',
          filename: 'wrong-project.md',
          score: 0.95,
          text: 'Mismatched project metadata is long enough, but it cannot be trusted as a citation.',
          attributes: { visibility: 'public', project_id: 'proj-other', rag_source_id: ragSourceId },
        },
        {
          fileId: 'file_1',
          filename: 'wrong-source.md',
          score: 0.95,
          text: 'Mismatched source metadata is long enough, but it cannot be trusted as a citation.',
          attributes: { visibility: 'public', project_id: 'proj-public-rag', rag_source_id: 'rag-other' },
        },
      ],
    },
    config,
  );

  assert.deepEqual(citations, []);
});
