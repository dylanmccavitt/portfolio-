import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { applyMigrations, type Queryable } from '../scripts/db';
import { CATALOG } from '../src/data/catalog';
import { buildCatalogShadowRecords, type CatalogShadowRecord } from '../src/lib/db/catalog-shadow';
import { createPublicDMDataTools, DMToolError } from '../src/lib/dm/data-tools';
import {
  FIT_CHECK_CONTEXT_LIMIT,
  sanitizeJobDescriptionForFitCheck,
} from '../src/lib/dm/fit-check';
import { createDMChatStream, readDMRuntimeConfig } from '../src/lib/dm/runtime';
import {
  parseStreamLine,
  resolveEvidence,
  validateBlock,
  type ProjectArtifact,
} from '../src/lib/eve';
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
  await insertIndexedPublicRagSource(db);
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
  assert.equal(model.doStreamCalls.length, 0);
  assert.ok(!events.some((event) => event.type === 'ready' || event.type === 'tool' || event.type === 'text-delta'));
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

test('DM stream registers OpenAI file_search alongside structured tools when indexed public RAG exists', async () => {
  const db = await publishedProjectDb();
  await insertIndexedPublicRagSource(db);
  const model = streamingModel('Published RAG is available for this answer.');

  const events = await readNdjson(
    createDMChatStream({ message: 'Use approved public source evidence about agentic trader.' }, TEST_CONFIG, {
      db,
      model,
    }),
  );

  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === 'Published RAG is available for this answer.'));
  const call = model.doStreamCalls[0];
  const tools = call?.tools as Array<{ name?: string; type?: string; id?: string; args?: Record<string, unknown> }> | undefined;
  assert.ok(tools?.some((tool) => tool.name === 'searchProjects'));
  const fileSearch = tools?.find((tool) => tool.name === 'file_search');
  assert.equal(fileSearch?.type, 'provider');
  assert.equal(fileSearch?.id, 'openai.file_search');
  assert.deepEqual(fileSearch?.args, {
    vectorStoreIds: ['vs_public'],
    filters: {
      type: 'and',
      filters: [
        { type: 'eq', key: 'visibility', value: 'public' },
        { type: 'in', key: 'project_id', value: ['agentic-trader'] },
        { type: 'in', key: 'rag_source_id', value: ['rag-public'] },
      ],
    },
    maxNumResults: 4,
    ranking: { ranker: 'auto', scoreThreshold: 0.2 },
  });
  assert.deepEqual(call?.providerOptions?.openai, { include: ['file_search_call.results'] });
});

test('DM stream suppresses model text after uncited weak file_search context and emits safe fallback', async () => {
  const db = await publishedProjectDb();
  await insertIndexedPublicRagSource(db);
  const events = await readNdjson(
    createDMChatStream({ message: 'Use retrieved source context only.' }, TEST_CONFIG, {
      db,
      model: rejectedFileSearchThenTextModel('Unsupported claim from uncited retrieval.'),
    }),
  );

  assert.ok(events.some((event) => event.type === 'tool' && event.name === 'file_search'));
  assert.ok(!events.some((event) => event.type === 'text-delta'));
  assert.ok(!JSON.stringify(events).includes('Unsupported claim from uncited retrieval.'));
  assert.ok(!events.some((event) => event.type === 'block' && event.block?.kind === 'evidence'));
  const fallback = events.find((event) => event.type === 'block' && event.block?.kind === 'text');
  assert.match(String(fallback?.block?.text), /not strong enough to cite/);
  assert.ok(events.some((event) => event.type === 'done'));
});

test('DM stream emits structured-tool text after weak file_search is superseded by a trusted tool result', async () => {
  const db = await publishedProjectDb();
  await insertIndexedPublicRagSource(db);
  const structuredToolText = 'Agentic Trader matches because the published project index lists trading automation work.';

  const events = await readNdjson(
    createDMChatStream({ message: 'Use retrieved source context and the public project index.' }, TEST_CONFIG, {
      db,
      model: weakFileSearchThenStructuredToolTextModel(structuredToolText),
    }),
  );

  assert.ok(events.some((event) => event.type === 'tool' && event.name === 'file_search'));
  assert.ok(events.some((event) => event.type === 'tool' && event.name === 'searchProjects'));
  const projectBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(projectBlock?.block?.items?.[0]?.id, 'agentic-trader');
  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === structuredToolText));
  assert.ok(!events.some((event) => event.type === 'block' && /not strong enough to cite/.test(String(event.block?.text))));
  assert.ok(events.some((event) => event.type === 'done'));
});

test('DM stream keeps accepted file_search citation but suppresses text after a later weak search', async () => {
  const db = await publishedProjectDb();
  await insertIndexedPublicRagSource(db);
  const unsupportedText = 'Unsupported claim after the weak search should never reach the stream.';

  const events = await readNdjson(
    createDMChatStream({ message: 'Use approved public source context only.' }, TEST_CONFIG, {
      db,
      model: acceptedThenWeakFileSearchThenTextModel(unsupportedText),
    }),
  );

  assert.equal(events.filter((event) => event.type === 'tool' && event.name === 'file_search').length, 2);
  const ragEvidence = events.find((event) => event.type === 'block' && event.block?.ragSources?.length);
  assert.equal(ragEvidence?.block?.ragSources?.[0]?.ragSourceId, 'rag-public');
  assert.equal(ragEvidence?.block?.ragSources?.[0]?.projectId, 'agentic-trader');
  assert.equal(ragEvidence?.block?.ragSources?.[0]?.score, 0.91);
  assert.ok(!events.some((event) => event.type === 'text-delta'));
  assert.ok(!JSON.stringify(events).includes(unsupportedText));
  assert.ok(events.some((event) => event.type === 'done'));
});

test('DM stream ends after unpublished project notice without model text', async () => {
  const db = await publishedProjectDb();
  const modelText = 'I can still share what is already public.';
  const events = await readNdjson(
    createDMChatStream(
      { message: 'Tell me about this project.', context: { projectIds: ['exit-manager'] } },
      TEST_CONFIG,
      { db, model: streamingModel(modelText) },
    ),
  );

  assert.ok(events.some((event) => event.type === 'ready'));
  const contextNotice = events.find(
    (event) =>
      event.type === 'block' &&
      event.block?.kind === 'text' &&
      /isn't in my published records yet/i.test(String(event.block?.text)),
  );
  assert.ok(contextNotice);
  assert.ok(!events.some((event) => event.type === 'text-delta'));
  assert.ok(events.some((event) => event.type === 'done'));
  assert.ok(!events.some((event) => event.type === 'error'));
});

test('DM stream ends after unpublished project notice even when the message asks for contact details', async () => {
  const db = await publishedProjectDb();
  const modelText = 'You can reach Dylan at his published email.';
  const events = await readNdjson(
    createDMChatStream(
      { message: "What's Dylan's email?", context: { projectIds: ['exit-manager'] } },
      TEST_CONFIG,
      { db, model: streamingModel(modelText) },
    ),
  );

  assert.ok(events.some((event) => event.type === 'ready'));
  assert.ok(
    events.some(
      (event) =>
        event.type === 'block' &&
        event.block?.kind === 'text' &&
        /isn't in my published records yet/i.test(String(event.block?.text)),
    ),
  );
  assert.ok(!events.some((event) => event.type === 'text-delta'));
  assert.ok(events.some((event) => event.type === 'done'));
  assert.ok(!events.some((event) => event.type === 'error'));
});

test('DM stream ends after unpublished project notice for mixed project and resume intent', async () => {
  const db = await publishedProjectDb();
  const modelText = 'Dylan has shipped several backend-heavy projects.';
  const events = await readNdjson(
    createDMChatStream(
      {
        message: "Tell me about tastytrade-exit-manager and Dylan's resume",
        context: { projectIds: ['exit-manager'] },
      },
      TEST_CONFIG,
      { db, model: streamingModel(modelText) },
    ),
  );

  assert.ok(events.some((event) => event.type === 'ready'));
  assert.ok(
    events.some(
      (event) =>
        event.type === 'block' &&
        event.block?.kind === 'text' &&
        /isn't in my published records yet/i.test(String(event.block?.text)),
    ),
  );
  assert.ok(!events.some((event) => event.type === 'text-delta'));
  assert.ok(events.some((event) => event.type === 'done'));
  assert.ok(!events.some((event) => event.type === 'error'));
});

test('DM stream ends after unpublished project notice even with alternate context grounding', async () => {
  const db = await publishedProjectDb();
  const modelText = 'Dylan worked across several resume tracks.';
  const events = await readNdjson(
    createDMChatStream(
      {
        message: 'Tell me about this project and the resume track.',
        context: { projectIds: ['exit-manager'], resumeTrackIds: ['kroll'] },
      },
      TEST_CONFIG,
      { db, model: streamingModel(modelText) },
    ),
  );

  assert.ok(events.some((event) => event.type === 'ready'));
  assert.ok(
    events.some(
      (event) =>
        event.type === 'block' &&
        event.block?.kind === 'text' &&
        /isn't in my published records yet/i.test(String(event.block?.text)),
    ),
  );
  assert.ok(!events.some((event) => event.type === 'text-delta'));
  assert.ok(events.some((event) => event.type === 'done'));
  assert.ok(!events.some((event) => event.type === 'error'));
});

test('DM stream fails safely when project-context validation cannot read the DB', async () => {
  const failingDb = {
    async query() {
      throw new Error('select * from private_drafts using secret-token');
    },
  } satisfies Queryable;
  const events = await readNdjson(
    createDMChatStream(
      { message: 'Tell me about this.', context: { projectIds: ['exit-manager'] } },
      TEST_CONFIG,
      { db: failingDb, model: streamingModel('This should not leak database failures.') },
    ),
  );

  assert.deepEqual(events, [
    {
      type: 'error',
      message: 'DM could not read the public portfolio data needed for that answer.',
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

test('DM route keeps resume/contact answers available with DB project-read failures', async () => {
  const failingDb = {
    async query() {
      throw new Error('select * from private_drafts using secret-token');
    },
  } satisfies Queryable;
  const modelText = 'I can share public resume and contact details.';
  const events = await readNdjson(
    createDMChatStream({ message: "Can you share Dylan's resume background and contact details?" }, TEST_CONFIG, {
      db: failingDb,
      model: streamingModel(modelText),
    }),
  );

  assert.ok(events.some((event) => event.type === 'ready'));
  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === modelText));
  assert.ok(events.some((event) => event.type === 'block' && event.block?.kind === 'resume'));
  assert.ok(events.some((event) => event.type === 'block' && event.block?.kind === 'contact'));
  assert.ok(events.some((event) => event.type === 'done'));
  assert.ok(!events.some((event) => event.type === 'error'));
});

test('fit-check sanitizes and bounds pasted job descriptions', () => {
  const pasted = [
    'Contact recruiter@example.com or visit https://jobs.example.test/private.',
    'Call +1 (212) 555-0199 for details.',
    'We need a software engineer with backend systems, automation, AI tools, product judgment, reliability, testing, and clear communication.',
    'Extra context '.repeat(900),
  ].join('\n\n');

  const sanitized = sanitizeJobDescriptionForFitCheck(pasted);

  assert.ok(sanitized.jobDescription.length <= FIT_CHECK_CONTEXT_LIMIT);
  assert.equal(sanitized.truncated, true);
  assert.equal(sanitized.originalLength, pasted.length);
  assert.ok(!sanitized.jobDescription.includes('recruiter@example.com'));
  assert.ok(!sanitized.jobDescription.includes('https://jobs.example.test/private'));
  assert.ok(!sanitized.jobDescription.includes('(212) 555-0199'));
});

test('evidence block validation accepts canonical ids and rejects unsafe shapes', () => {
  assert.deepEqual(validateBlock({ kind: 'evidence', projectIds: ['agentic-trader'], resumeTrackIds: ['now'] }), {
    kind: 'evidence',
    projectIds: ['agentic-trader'],
    resumeTrackIds: ['now'],
  });
  assert.equal(validateBlock({ kind: 'evidence' }), null);
  assert.equal(validateBlock({ kind: 'evidence', projectIds: ['agentic-trader', 42] }), null);
  assert.deepEqual(
    validateBlock({
      kind: 'evidence',
      projectIds: ['a', 'b', 'c', 'd', 'e'],
      resumeTrackIds: ['one', 'two', 'three', 'four'],
    }),
    {
      kind: 'evidence',
      projectIds: ['a', 'b', 'c', 'd'],
      resumeTrackIds: ['one', 'two', 'three'],
    },
  );

  const ragSource = {
    ragSourceId: 'rag-public',
    projectId: 'agentic-trader',
    fileId: 'file_public',
    filename: 'approved-readme.md',
    score: 0.91,
    text: 'Approved public source text cited by DM.',
  };
  assert.deepEqual(validateBlock({ kind: 'evidence', ragSources: [ragSource] }), {
    kind: 'evidence',
    ragSources: [ragSource],
  });
  assert.equal(validateBlock({ kind: 'evidence', ragSources: [{ ragSourceId: 'rag-public', projectId: 'agentic-trader' }] }), null);
  assert.equal(validateBlock({ kind: 'evidence', ragSources: 'rag-public' }), null);

  assert.deepEqual(
    parseStreamLine(
      JSON.stringify({
        type: 'block',
        block: { kind: 'evidence', ragSources: [ragSource] },
      }),
    ),
    {
      type: 'block',
      block: { kind: 'evidence', ragSources: [ragSource] },
    },
  );

  const event = parseStreamLine(
    JSON.stringify({
      type: 'block',
      block: { kind: 'evidence', projectIds: ['agentic-trader'], resumeTrackIds: ['now'] },
    }),
  );
  assert.deepEqual(event, {
    type: 'block',
    block: { kind: 'evidence', projectIds: ['agentic-trader'], resumeTrackIds: ['now'] },
  });
  assert.equal(
    parseStreamLine(JSON.stringify({ type: 'block', block: { kind: 'evidence', projectIds: [42] } })),
    null,
  );
});

test('rag evidence rejects citations without non-empty text', () => {
  const citationWithoutText = {
    ragSourceId: 'rag-public',
    projectId: 'agentic-trader',
    fileId: 'file_public',
    filename: 'approved-readme.md',
    score: 0.91,
  };
  const invalidCases = [
    { name: 'missing text', citation: citationWithoutText },
    { name: 'empty text', citation: { ...citationWithoutText, text: '' } },
    { name: 'blank text', citation: { ...citationWithoutText, text: ' \n\t ' } },
  ];

  for (const { name, citation } of invalidCases) {
    const block = { kind: 'evidence', ragSources: [citation] };
    assert.equal(validateBlock(block), null, name);
    assert.equal(parseStreamLine(JSON.stringify({ type: 'block', block })), null, name);
  }
});

test('evidence resolution drops stale ids without throwing', () => {
  const previousWarn = console.warn;
  console.warn = () => undefined;

  try {
    const resolved = resolveEvidence({
      kind: 'evidence',
      projectIds: ['agentic-trader', 'missing-project'],
      resumeTrackIds: ['now', 'missing-track'],
    });

    assert.deepEqual(
      resolved.projects.map((project) => project.id),
      ['agentic-trader'],
    );
    assert.deepEqual(
      resolved.tracks.map((track) => track.id),
      ['now'],
    );
  } finally {
    console.warn = previousWarn;
  }
});

test('streamed project artifacts satisfy DB-only project ids without catalog fallback', () => {
  const artifact: ProjectArtifact = {
    id: 'db-only-project',
    title: 'DB-only Project',
    area: 'Agents & MCP',
    status: ['done', 'Published'],
    year: 2026,
    activity: 'Published from DB',
    line: 'A project that exists only in the DB read model.',
    href: '/projects/db-only-project',
  };
  const previousWarn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    assert.deepEqual(validateBlock({ kind: 'projects', ids: [artifact.id], items: [artifact] }), {
      kind: 'projects',
      ids: [artifact.id],
      items: [artifact],
    });

    const resolved = resolveEvidence({
      kind: 'evidence',
      projectIds: [artifact.id],
      projects: [artifact],
    });

    assert.deepEqual(resolved.projects, []);
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = previousWarn;
  }
});

test('DM route validates fit-check pasted context safely', async () => {
  const db = await publishedProjectDb();
  const post = createDMPostHandler({
    config: TEST_CONFIG,
    db,
    model: streamingModel('Fit-check overlap looks strongest on backend and automation work.'),
  });

  const tooShort = await post({
    request: new Request('https://example.test/api/dm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Fit-check this job description.',
        context: {
          fitCheck: {
            kind: 'job-description',
            jobDescription: 'short',
            originalLength: 5,
            truncated: false,
          },
        },
      }),
    }),
  } as never);
  assert.equal(tooShort.status, 400);
  assert.match(JSON.stringify(await tooShort.json()), /at least/);

  const valid = await post({
    request: new Request('https://example.test/api/dm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Fit-check this job description.',
        context: {
          fitCheck: {
            kind: 'job-description',
            jobDescription:
              'Software engineer role needing backend services, automation, AI tooling, testing, reliability, product judgment, customer-facing shipping, and communication. '.repeat(3),
            originalLength: 450,
            truncated: false,
          },
        },
      }),
    }),
  } as never);
  const events = await readNdjson(valid.body);

  assert.equal(valid.status, 200);
  assert.ok(events.some((event) => event.type === 'ready'));
  assert.ok(
    events.some(
      (event) =>
        event.type === 'text-delta' &&
        typeof event.delta === 'string' &&
        /backend and automation/.test(event.delta),
    ),
  );
  assert.ok(!events.some((event) => event.type === 'error'));
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

async function insertIndexedPublicRagSource(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (id, project_id, source_type, source_ref, privacy_state, extracted_text, claim_map)
     VALUES ('ev-public-rag', 'agentic-trader', 'readme', 'test:public-rag', 'safe_public', $1, '{}'::jsonb)`,
    ['Approved public RAG source text with enough detail to support a recruiter-facing answer.'],
  );
  await db.query(
    `INSERT INTO rag_sources (
       id, project_id, evidence_source_id, eligibility_state, openai_file_id, vector_store_id, last_synced_at
     ) VALUES (
       'rag-public', 'agentic-trader', 'ev-public-rag', 'indexed', 'file_public', 'vs_public', $1
     )`,
    [new Date().toISOString()],
  );
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

function rejectedFileSearchThenTextModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-file-search',
            toolName: 'file_search',
            input: '{}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'call-file-search',
            toolName: 'file_search',
            result: {
              queries: ['agentic trader approved source'],
              results: [
                {
                  fileId: 'file_public',
                  filename: 'approved-readme.md',
                  text: 'Approved public RAG source text with enough detail to support a recruiter-facing answer.',
                  attributes: {
                    visibility: 'public',
                    project_id: 'agentic-trader',
                    rag_source_id: 'rag-public',
                  },
                },
              ],
            },
          },
          { type: 'text-start', id: 'text-after-rejected-search' },
          { type: 'text-delta', id: 'text-after-rejected-search', delta: text },
          { type: 'text-end', id: 'text-after-rejected-search' },
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
    }),
  });
}

function weakFileSearchThenStructuredToolTextModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            {
              type: 'tool-call',
              toolCallId: 'call-file-search-weak',
              toolName: 'file_search',
              input: '{}',
              providerExecuted: true,
            },
            {
              type: 'tool-result',
              toolCallId: 'call-file-search-weak',
              toolName: 'file_search',
              result: {
                queries: ['agentic trader weak source'],
                results: [
                  {
                    fileId: 'file_public',
                    filename: 'unscored-readme.md',
                    text: 'This matching public source text is long enough but has no relevance score, so it must not justify generated text.',
                    attributes: {
                      visibility: 'public',
                      project_id: 'agentic-trader',
                      rag_source_id: 'rag-public',
                    },
                  },
                ],
              },
            },
            {
              type: 'tool-call',
              toolCallId: 'call-search-projects',
              toolName: 'searchProjects',
              input: JSON.stringify({ query: 'trading automation robinhood', limit: 3 }),
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
              usage: {
                inputTokens: { total: 18, noCache: 18, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 6, text: 6, reasoning: undefined },
              },
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-after-structured-tool' },
            { type: 'text-delta', id: 'text-after-structured-tool', delta: text },
            { type: 'text-end', id: 'text-after-structured-tool' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 8, text: 8, reasoning: undefined },
              },
            },
          ],
        }),
      },
    ],
  });
}

function acceptedThenWeakFileSearchThenTextModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-file-search-accepted',
            toolName: 'file_search',
            input: '{}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'call-file-search-accepted',
            toolName: 'file_search',
            result: {
              queries: ['agentic trader approved source'],
              results: [
                {
                  fileId: 'file_public',
                  filename: 'approved-readme.md',
                  score: 0.91,
                  text: 'Approved public RAG source text with enough detail to support a recruiter-facing answer.',
                  attributes: {
                    visibility: 'public',
                    project_id: 'agentic-trader',
                    rag_source_id: 'rag-public',
                  },
                },
              ],
            },
          },
          {
            type: 'tool-call',
            toolCallId: 'call-file-search-weak',
            toolName: 'file_search',
            input: '{}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'call-file-search-weak',
            toolName: 'file_search',
            result: {
              queries: ['agentic trader weak source'],
              results: [
                {
                  fileId: 'file_public',
                  filename: 'unscored-readme.md',
                  text: 'This matching public source text is long enough but has no relevance score, so it must not justify generated text.',
                  attributes: {
                    visibility: 'public',
                    project_id: 'agentic-trader',
                    rag_source_id: 'rag-public',
                  },
                },
              ],
            },
          },
          { type: 'text-start', id: 'text-after-weak-search' },
          { type: 'text-delta', id: 'text-after-weak-search', delta: text },
          { type: 'text-end', id: 'text-after-weak-search' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 16, noCache: 16, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 8, text: 8, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

function throwingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error('model should not be called');
    },
  });
}

type JsonEvent = {
  type?: string;
  name?: string;
  block?: {
    kind?: string;
    text?: string;
    items?: Array<{ id?: string; title?: string; href?: string }>;
    projects?: Array<{ id?: string; title?: string; href?: string }>;
    ragSources?: Array<{ ragSourceId?: string; projectId?: string; score?: number }>;
  };
  delta?: string;
  message?: string;
};

async function readNdjson(stream: ReadableStream<Uint8Array> | null): Promise<JsonEvent[]> {
  assert.ok(stream, 'expected a response body stream');
  const text = await new Response(stream).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonEvent);
}
