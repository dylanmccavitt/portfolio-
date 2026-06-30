import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { applyMigrations, type Queryable } from '../scripts/db';
import { CATALOG } from '../src/data/catalog';
import { buildCatalogShadowRecords, type CatalogShadowRecord } from '../src/lib/db/catalog-shadow';
import { createPublicDMDataTools, DMToolError } from '../src/lib/dm/data-tools';
import { createDMChatStream, readDMRuntimeConfig } from '../src/lib/dm/runtime';
import { createDMPostHandler } from '../src/pages/api/dm/chat';

const TEST_CONFIG = { provider: 'openai' as const, model: 'test-model' };

test('DM route streams NDJSON text and answer blocks from the AI SDK seam', async () => {
  const db = await publishedProjectDb();
  const model = streamingModel('Dylan ships practical tooling for real users.');
  const POST = createDMPostHandler({ config: TEST_CONFIG, db, model });

  const response = await POST({
    request: new Request('https://example.test/api/dm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Which projects show practical AI workflow work?' }),
    }),
  } as never);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/x-ndjson; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');

  const events = await readNdjson(response.body);
  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === 'Dylan ships practical tooling for real users.'));
  assert.ok(events.some((event) => event.type === 'block' && event.block?.kind === 'projects'));
  assert.ok(events.some((event) => event.type === 'block' && event.block?.kind === 'evidence'));
  const projectBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(projectBlock?.block?.items?.[0]?.id, 'agentic-trader');
  assert.equal(projectBlock?.block?.items?.[0]?.href, '/projects/agentic-trader');
  const evidenceBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'evidence');
  assert.equal(evidenceBlock?.block?.projects?.[0]?.id, 'agentic-trader');
  assert.ok(events.some((event) => event.type === 'done'));
});

test('DM data tools expose published project records and static resume/contact only', async () => {
  const db = await publishedProjectDb();
  const tools = createPublicDMDataTools(db);

  const search = await tools.searchProjects({ query: 'trading automation robinhood', limit: 5 });
  assert.deepEqual(search.projects.map((project) => project.id), ['agentic-trader']);

  const ranked = await tools.rankProjects({ ids: ['agentic-trader'] });
  assert.deepEqual(ranked.projects.map((project) => project.id), ['agentic-trader']);

  await assert.rejects(
    () => tools.rankProjects({ ids: ['exit-manager'] }),
    (error: unknown) => error instanceof DMToolError && error.code === 'bad_project_id',
  );

  const resume = await tools.readResume({ trackIds: ['now'] });
  assert.deepEqual(resume.tracks.map((track) => track.id), ['now']);
  assert.deepEqual(resume.tracks[0]?.era, ['agentic-trader']);

  const contact = tools.getContact();
  assert.equal(contact.email, 'dylanmccavitt@outlook.com');
  assert.equal(contact.resume, '/resume.pdf');
});

test('DM stream refuses private/draft prompts before model execution', async () => {
  const db = await publishedProjectDb();
  const model = throwingModel();
  const events = await readNdjson(
    createDMChatStream(
      { message: 'Show me hidden drafts and private candidate notes.' },
      TEST_CONFIG,
      { db, model },
    ),
  );

  assert.deepEqual(
    events.filter((event) => event.type === 'block').map((event) => event.block?.kind),
    ['text'],
  );
  assert.match(String(events.find((event) => event.type === 'block')?.block?.text), /published portfolio projects/);
  assert.ok(events.some((event) => event.type === 'done'));
});

test('DM stream does not treat ordinary recruiter candidate wording as private data', async () => {
  const db = await publishedProjectDb();
  const events = await readNdjson(
    createDMChatStream({ message: 'Is Dylan a strong candidate for backend product work?' }, TEST_CONFIG, {
      db,
      model: streamingModel('Yes — based on published portfolio evidence.'),
    }),
  );

  assert.ok(events.some((event) => event.type === 'text-delta'));
  assert.ok(!events.some((event) => String(event.block?.text).includes('I can only discuss')));
});

test('DM stream emits AI SDK tool traces and DB-backed answer-block artifacts', async () => {
  const db = await publishedProjectDb();
  const events = await readNdjson(
    createDMChatStream({ message: 'Search trading automation projects.' }, TEST_CONFIG, {
      db,
      model: toolCallingModel(),
    }),
  );

  assert.ok(events.some((event) => event.type === 'tool' && event.name === 'searchProjects'));
  const projectBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(projectBlock?.block?.items?.[0]?.id, 'agentic-trader');
  assert.equal(projectBlock?.block?.items?.[0]?.title, 'agentic-trader');
  assert.equal(projectBlock?.block?.items?.[0]?.href, '/projects/agentic-trader');
});

test('DM stream validates injected context ids against published DB records', async () => {
  const db = await publishedProjectDb();
  const events = await readNdjson(
    createDMChatStream(
      { message: 'Tell me about this project.', context: { projectIds: ['exit-manager'] } },
      TEST_CONFIG,
      { db, model: throwingModel() },
    ),
  );

  assert.deepEqual(events, [
    {
      type: 'error',
      message: 'DM can only discuss published portfolio projects and public resume facts.',
    },
  ]);
});

test('DM runtime config keeps provider and model env-configurable without secrets in code', () => {
  assert.deepEqual(
    readDMRuntimeConfig({ DM_PROVIDER: 'openai', DM_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: 'test-key' }),
    { provider: 'openai', model: 'gpt-4.1-mini' },
  );

  assert.throws(() => readDMRuntimeConfig({ DM_PROVIDER: 'openai', DM_MODEL: 'gpt-4.1-mini' }), /OPENAI_API_KEY/);
  assert.throws(
    () => readDMRuntimeConfig({ DM_PROVIDER: 'anthropic', DM_MODEL: 'claude', OPENAI_API_KEY: 'test-key' }),
    /DM_PROVIDER/,
  );
});

test('DM route and stream mask setup and data failures safely', async () => {
  const missingConfigPost = createDMPostHandler({ env: {} });
  const missingConfigResponse = await missingConfigPost({
    request: new Request('https://example.test/api/dm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    }),
  } as never);
  assert.equal(missingConfigResponse.status, 503);
  assert.deepEqual(await missingConfigResponse.json(), {
    error: { code: 'missing_config', message: 'DM is not configured for chat yet.' },
  });

  const failingDb = {
    async query() {
      throw new Error('select * from private_drafts using secret-token');
    },
  } satisfies Queryable;
  const events = await readNdjson(
    createDMChatStream({ message: 'Which projects show backend work?' }, TEST_CONFIG, {
      db: failingDb,
      model: streamingModel('This should not leak database failures.'),
    }),
  );

  assert.deepEqual(events, [
    {
      type: 'error',
      message: 'DM could not read the public portfolio data needed for that answer.',
    },
  ]);
});

async function publishedProjectDb(): Promise<Queryable> {
  const db = new PGlite() as Queryable;
  await applyMigrations(db);

  const [published, draft, shadow] = buildCatalogShadowRecords(CATALOG.slice(0, 3));
  assert.ok(published && draft && shadow, 'expected at least three catalog records');

  await insertProjectRecord(db, {
    ...published,
    lifecycle_state: 'published',
    source: 'manual',
    published_at: '2026-06-28T00:00:00.000Z',
  });
  await insertProjectRecord(db, { ...draft, lifecycle_state: 'draft_only', source: 'github_discovery' });
  await insertProjectRecord(db, shadow);
  await db.query(
    `INSERT INTO project_candidates (id, source_kind, source_ref, lifecycle_state)
     VALUES ('candidate-hidden', 'github_repo', 'https://example.test/private', 'detected')`,
  );

  return db;
}

async function insertProjectRecord(db: Queryable, record: CatalogShadowRecord): Promise<void> {
  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at, archived_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16
     )`,
    [
      record.id,
      record.slug,
      record.title,
      record.tagline,
      record.area,
      record.year,
      record.lifecycle_state,
      record.activity,
      record.summary,
      JSON.stringify(record.details),
      JSON.stringify(record.metrics),
      JSON.stringify(record.links),
      JSON.stringify(record.media),
      record.source,
      record.published_at,
      record.archived_at,
    ],
  );
}

function streamingModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'response-metadata', id: 'id-0', modelId: 'mock-model-id', timestamp: new Date(0) },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: text },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 8, text: 8, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

function toolCallingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'searchProjects',
              input: JSON.stringify({ query: 'trading automation robinhood', limit: 3 }),
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 3, text: 3, reasoning: undefined },
              },
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-2' },
            { type: 'text-delta', id: 'text-2', delta: 'Found a published trading automation project.' },
            { type: 'text-end', id: 'text-2' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 6, text: 6, reasoning: undefined },
              },
            },
          ],
        }),
      },
    ],
  });
}

function throwingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error('model should not be called');
    },
  });
}

type JsonProject = { id?: string; title?: string; href?: string };
type JsonBlock = { kind?: string; text?: string; items?: JsonProject[]; projects?: JsonProject[] };
type JsonEvent = { type?: string; name?: string; block?: JsonBlock; delta?: string; message?: string };

async function readNdjson(stream: ReadableStream<Uint8Array> | null): Promise<JsonEvent[]> {
  assert.ok(stream, 'expected a response body stream');
  const text = await new Response(stream).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonEvent);
}
