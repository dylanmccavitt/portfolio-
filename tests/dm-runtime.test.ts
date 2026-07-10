import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { applyMigrations, type Queryable } from '../scripts/db';
import { CATALOG } from '@/data/catalog';
import { buildCatalogShadowRecords, type CatalogShadowRecord } from '@/lib/db/catalog-shadow';
import { createPublicDMDataTools, DMToolError } from '@/lib/dm/data-tools';
import { resetPublicProjectDetailsLoadForTests } from '@/lib/public-projects';
import {
  FIT_CHECK_CONTEXT_LIMIT,
  sanitizeJobDescriptionForFitCheck,
} from '@/lib/dm/fit-check';
import { createDMChatStream, readDMRuntimeConfig } from '@/lib/dm/runtime';
import { type PublicRagSearchOutput } from '@/lib/rag/retrieval';
import {
  parseStreamLine,
  resolveEvidence,
  validateBlock,
  type ProjectArtifact,
} from '@/lib/dm/client';
import { createDMPostHandler } from '@/pages/api/dm/chat';

const TEST_CONFIG = { provider: 'openai' as const, model: 'test-model' };

test('DM route streams NDJSON text and answer blocks from the AI SDK seam', async () => withPublicProjectDbGate(async () => {
  const db = await publishedProjectDb();
  const model = streamingModel(projectDraft('agentic-trader'));
  const POST = createDMPostHandler({ config: TEST_CONFIG, db, model });

  const response = await POST({
    request: new Request('https://example.test/api/dm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Which projects show trading automation with Robinhood?' }),
    }),
  } as never);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/x-ndjson; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Public-Project-Source'), 'database');

  const events = await readNdjson(response.body);
  const answerText = events.filter((event) => event.type === 'text-delta').map((event) => event.delta).join('');
  assert.match(answerText, /agentic-trader/i);
  assert.match(answerText, /Status:/);
  assert.deepEqual(
    events.filter((event) => event.type === 'block').map((event) => event.block?.kind),
    ['projects'],
  );
  const projectBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(projectBlock?.block?.items?.[0]?.id, 'agentic-trader');
  assert.equal(projectBlock?.block?.items?.[0]?.href, '/projects/agentic-trader');
  assert.equal(typeof projectBlock?.block?.items?.[0]?.summary, 'string');
  assert.ok(events.some((event) => event.type === 'done'));
}));

test('DM data tools expose DB-gated public records and static resume/contact only', async () => withPublicProjectDbGate(async () => {
  const db = await publishedProjectDb();
  const tools = createPublicDMDataTools(db);

  // Published DB rows are the complete project source; rows that are not
  // published and catalog-only ids never surface.
  const search = await tools.searchProjects({ query: 'trading automation robinhood', limit: 5 });
  assert.equal(search.projects[0]?.id, 'agentic-trader');

  const noMatch = await tools.searchProjects({ query: 'loom-unpublished-topic', limit: 3 });
  assert.equal(noMatch.fallbackUsed, false);
  assert.equal(noMatch.resultStatus, 'empty');
  assert.deepEqual(noMatch.projects, []);
  assert.match(noMatch.message, /no published projects matched/i);
  assert.match(noMatch.message, /do not name or substitute projects/i);

  const emptyFilter = await tools.filterProjects({ area: 'not-a-published-area' });
  assert.equal(emptyFilter.resultStatus, 'empty');
  assert.deepEqual(emptyFilter.projects, []);
  assert.match(emptyFilter.message, /do not name or substitute projects/i);

  const completeRank = await tools.rankProjects({ intent: 'strongest work', limit: 1 });
  assert.equal(completeRank.resultStatus, 'complete');
  assert.equal(completeRank.projects.length, 1);
  assert.match(completeRank.message, /only name or discuss projects in this returned projects array/i);

  const ranked = await tools.rankProjects({ ids: ['agentic-trader'] });
  assert.deepEqual(ranked.projects.map((project) => project.id), ['agentic-trader']);
  assert.equal(ranked.resultStatus, 'complete');

  await assert.rejects(
    () => tools.rankProjects({ ids: ['exit-manager'] }),
    (error: unknown) => error instanceof DMToolError && error.code === 'bad_project_id',
  );

  await assert.rejects(
    () => tools.rankProjects({ ids: ['proj-draft-only-unlisted'] }),
    (error: unknown) => error instanceof DMToolError && error.code === 'bad_project_id',
  );

  const resume = await tools.readResume({ trackIds: ['now'] });
  assert.deepEqual(resume.tracks.map((track) => track.id), ['now']);
  assert.deepEqual(resume.tracks[0]?.era, ['agentic-trader']);

  const contact = tools.getContact();
  assert.equal(contact.email, 'dylanmccavitt@outlook.com');
  assert.equal(contact.resume, '/resume.pdf');
}));

test('DM data tools use the catalog only in explicit emergency mode', async () => withCatalogEmergency(async () => {
  const db = await publishedProjectDb();
  const tools = createPublicDMDataTools(db);

  const ids = await tools.publishedProjectIds();
  assert.equal(ids.size, CATALOG.length);
  assert.equal(ids.has('exit-manager'), true);

  const ranked = await tools.rankProjects({ ids: ['exit-manager'] });
  assert.deepEqual(ranked.projects.map((project) => project.id), ['exit-manager']);

  await assert.rejects(
    () => tools.rankProjects({ ids: ['candidate-hidden'] }),
    (error: unknown) => error instanceof DMToolError && error.code === 'bad_project_id',
  );
}));

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

for (const prompt of [
  'Has Dylan built Slack integrations?',
  'Has he worked on private repos before?',
  'Any hidden gems in his portfolio?',
]) {
  test(`DM stream lets ordinary recruiter phrasing reach the model: ${prompt}`, async () => {
    const db = await publishedProjectDb();
    const events = await readNdjson(
      createDMChatStream({ message: prompt }, TEST_CONFIG, {
        db,
        model: streamingModel('I can answer that from public portfolio context.'),
      }),
    );

    assert.ok(events.some((event) => event.type === 'ready'));
    assert.ok(events.some((event) => event.type === 'text-delta'));
    assert.ok(!events.some((event) => String(event.block?.text).includes('I can only discuss')));
  });
}

test('DM stream retrieves DB-backed project facts before synthesis and hides project retrieval tools', async () => withPublicProjectDbGate(async () => {
  const db = await publishedProjectDb();
  const model = streamingModel(projectDraft('agentic-trader'));
  const events = await readNdjson(
    createDMChatStream({ message: 'Search trading automation projects.' }, TEST_CONFIG, {
      db,
      model,
    }),
  );

  assert.ok(!events.some((event) => event.type === 'tool' && event.name === 'searchProjects'));
  const tools = model.doStreamCalls[0]?.tools as Array<{ name?: string }> | undefined;
  assert.ok(!tools?.some((tool) => tool.name === 'searchProjects'));
  const projectBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(projectBlock?.block?.items?.[0]?.id, 'agentic-trader');
  assert.equal(projectBlock?.block?.items?.[0]?.title, 'agentic-trader');
  assert.equal(projectBlock?.block?.items?.[0]?.href, '/projects/agentic-trader');
}));

test('DM stream resolves requested RAG evidence before project synthesis', async () => {
  const db = await publishedProjectDb();
  await insertIndexedPublicRagSource(db);
  const model = streamingModel(projectDraft('agentic-trader', { citationIds: ['rag-public'] }));

  const events = await readNdjson(
    createDMChatStream({ message: 'Use source evidence about the agentic-trader trading automation project.' }, TEST_CONFIG, {
      db,
      model,
      ragSearch: createMockRagSearch(),
    }),
  );

  assert.ok(!events.some((event) => event.type === 'tool' && event.name === 'searchSources'));
  assert.ok(!events.some((event) => event.type === 'tool' && event.name === 'searchProjects'));
  const tools = model.doStreamCalls[0]?.tools as Array<{ name?: string }> | undefined;
  assert.ok(!tools?.some((tool) => tool.name === 'searchSources'));
  assert.ok(!tools?.some((tool) => tool.name === 'searchProjects'));
  const projectBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(projectBlock?.block?.items?.[0]?.id, 'agentic-trader');
  const ragEvidence = events.find((event) => event.type === 'block' && event.block?.ragSources?.length);
  assert.equal(ragEvidence?.block?.ragSources?.[0]?.ragSourceId, 'rag-public');
  assert.equal(ragEvidence?.block?.projectIds, undefined);
  assert.equal(ragEvidence?.block?.projects, undefined);
  assert.equal(events.filter((event) => event.type === 'block' && event.block?.kind === 'projects').length, 1);
  assert.equal(events.filter((event) => event.type === 'block' && event.block?.kind === 'evidence').length, 1);
  const answerText = events.filter((event) => event.type === 'text-delta').map((event) => event.delta).join('');
  assert.match(answerText, /agentic-trader/i);
  assert.match(answerText, /Approved public RAG source text/);
  assert.ok(!events.some((event) => event.type === 'block' && /not strong enough to cite/.test(String(event.block?.text))));
  assert.ok(events.some((event) => event.type === 'done'));
});

test('DM stream accepts project context ids from the explicit emergency catalog source', async () => withCatalogEmergency(async () => {
  const db = await publishedProjectDb();
  const events = await readNdjson(
    createDMChatStream(
      { message: 'Tell me about this project.', context: { projectIds: ['exit-manager'] } },
      TEST_CONFIG,
      { db, model: streamingModel(projectDraft('exit-manager')) },
    ),
  );

  assert.ok(events.some((event) => event.type === 'ready'));
  const answerText = events.filter((event) => event.type === 'text-delta').map((event) => event.delta).join('');
  assert.match(answerText, /tastytrade-exit-manager/i);
  const projectBlock = events.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(projectBlock?.block?.items?.[0]?.id, 'exit-manager');
  assert.ok(!events.some((event) => /isn't in my published records yet/i.test(String(event.block?.text))));
  assert.ok(events.some((event) => event.type === 'done'));
  assert.ok(!events.some((event) => event.type === 'error'));
}));

test('DM stream ends after DB-gated unpublished project notice without model text', async () => withPublicProjectDbGate(async () => {
  const db = await publishedProjectDb();
  const model = throwingModel();
  const events = await readNdjson(
    createDMChatStream(
      { message: 'Tell me about this project.', context: { projectIds: ['proj-draft-only-unlisted'] } },
      TEST_CONFIG,
      { db, model },
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
  assert.equal(model.doStreamCalls.length, 0);
}));

test('DM stream ends after unknown project notice even when the message asks for contact details', async () => withoutPublicProjectDbGate(async () => {
  const db = await publishedProjectDb();
  const model = throwingModel();
  const events = await readNdjson(
    createDMChatStream(
      { message: "What's Dylan's email?", context: { projectIds: ['not-a-public-project'] } },
      TEST_CONFIG,
      { db, model },
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
  assert.equal(model.doStreamCalls.length, 0);
}));

test('DM stream fails closed when project-context validation cannot read the DB', async () => withoutPublicProjectDbGate(async () => {
  const failingDb = {
    async query() {
      throw new Error('select * from private_drafts using secret-token');
    },
  } satisfies Queryable;
  const model = streamingModel('This model output must never be emitted.');
  const events = await readNdjson(
    createDMChatStream(
      { message: 'Tell me about this.', context: { projectIds: ['exit-manager'] } },
      TEST_CONFIG,
      { db: failingDb, model },
    ),
  );

  assert.deepEqual(events.map((event) => event.type), ['error']);
  assert.match(String(events[0]?.message), /could not read the public portfolio data/i);
  assert.equal(model.doStreamCalls.length, 0);
  assert.ok(!JSON.stringify(events).includes('private_drafts'));
  assert.ok(!JSON.stringify(events).includes('secret-token'));
}));

test('DM runtime config selects gateway when AI_GATEWAY_API_KEY is set and falls back to direct OpenAI otherwise', () => {
  assert.deepEqual(
    readDMRuntimeConfig({ DM_MODEL: 'openai/gpt-4.1-mini', OPENAI_API_KEY: 'test-key' }),
    { provider: 'openai', model: 'openai/gpt-4.1-mini' },
  );

  assert.deepEqual(
    readDMRuntimeConfig({ DM_MODEL: 'openai/gpt-4.1', AI_GATEWAY_API_KEY: 'gateway-key' }),
    { provider: 'gateway', model: 'openai/gpt-4.1' },
  );

  assert.deepEqual(
    readDMRuntimeConfig({ OPENAI_API_KEY: 'test-key' }),
    { provider: 'openai', model: 'openai/gpt-4.1' },
  );

  assert.throws(() => readDMRuntimeConfig({ DM_MODEL: 'openai/gpt-4.1' }), /OPENAI_API_KEY/);
  assert.throws(() => readDMRuntimeConfig({}), /OPENAI_API_KEY/);
});

test('DM route masks setup failures and fails closed on project DB failures', async () => withoutPublicProjectDbGate(async () => {
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
  const model = streamingModel('This model output must never be emitted.');
  const events = await readNdjson(
    createDMChatStream({ message: 'Which projects show backend work?' }, TEST_CONFIG, {
      db: failingDb,
      model,
    }),
  );

  assert.deepEqual(events.map((event) => event.type), ['error']);
  assert.match(String(events[0]?.message), /could not read the public portfolio data/i);
  assert.equal(model.doStreamCalls.length, 0);
  assert.ok(!JSON.stringify(events).includes('private_drafts'));
  assert.ok(!JSON.stringify(events).includes('secret-token'));
}));

test('DM route exposes explicit emergency catalog mode and does not query the injected DB', async () => withCatalogEmergency(async () => {
  let queryCount = 0;
  const unavailableDb = {
    async query() {
      queryCount += 1;
      throw new Error('the emergency source must not query this database');
    },
  } satisfies Queryable;
  const POST = createDMPostHandler({
    config: TEST_CONFIG,
    env: { PUBLIC_PROJECT_SOURCE: 'catalog_emergency' },
    db: unavailableDb,
    model: throwingModel(),
  });
  const response = await POST({
    request: new Request('https://example.test/api/dm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Tell me about exit manager.', context: { projectIds: ['exit-manager'] } }),
    }),
  } as never);
  const events = await readNdjson(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Public-Project-Source'), 'catalog_emergency');
  assert.equal(queryCount, 0);
  assert.equal(
    events.find((event) => event.type === 'block' && event.block?.kind === 'projects')?.block?.items?.[0]?.id,
    'exit-manager',
  );
  assert.ok(!events.some((event) => event.type === 'error'));
}));

test('DM route keeps resume/contact answers available with DB project-read failures', async () => {
  const failingDb = {
    async query() {
      throw new Error('select * from private_drafts using secret-token');
    },
  } satisfies Queryable;
  const model = streamingModel('candidate-hidden 9999 https://private.example');
  const events = await readNdjson(
    createDMChatStream({ message: "Can you share Dylan's resume background and contact details?" }, TEST_CONFIG, {
      db: failingDb,
      model,
    }),
  );

  assert.ok(events.some((event) => event.type === 'ready'));
  assert.ok(events.some((event) => event.type === 'text-delta' && /public resume highlights and contact details/.test(event.delta ?? '')));
  assert.equal(model.doStreamCalls.length, 0);
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

test('evidence resolution never hydrates project ids from the legacy catalog', () => {
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
      [],
    );
    assert.deepEqual(
      resolved.tracks.map((track) => track.id),
      ['now'],
    );
  } finally {
    console.warn = previousWarn;
  }
});

test('streamed project artifacts satisfy active public-source ids absent from the client catalog', () => {
  const artifact: ProjectArtifact = {
    id: 'db-only-project',
    title: 'DB-only Project',
    area: CATALOG[0]!.area,
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

    assert.deepEqual(resolved.projects, [artifact]);
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
    model: streamingModel(projectDraft('agentic-trader')),
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
  const answerText = events.filter((event) => event.type === 'text-delta').map((event) => event.delta).join('');
  assert.match(answerText, /agentic-trader/i);
  assert.match(answerText, /Status:/);
  assert.ok(events.some((event) => event.type === 'block' && event.block?.kind === 'resume'));
  assert.ok(!events.some((event) => event.type === 'error'));
});


const PUBLIC_PROJECT_ENV_KEYS = [
  'PUBLIC_PROJECT_PAGES_FROM_DB',
  'PORTFOLIO_PUBLIC_PROJECTS_FROM_DB',
  'PUBLIC_PROJECT_SOURCE',
  'CI',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_REGION',
  'DATABASE_URL',
  'POSTGRES_URL',
  'PORTFOLIO_DATABASE_URL',
  'PORTFOLIO_POSTGRES_URL',
] as const;

async function withPublicProjectDbGate<T>(run: () => T | Promise<T>): Promise<T> {
  return withPublicProjectEnvironment({ PUBLIC_PROJECT_PAGES_FROM_DB: 'true' }, run);
}

async function withoutPublicProjectDbGate<T>(run: () => T | Promise<T>): Promise<T> {
  return withPublicProjectEnvironment({}, run);
}

async function withCatalogEmergency<T>(run: () => T | Promise<T>): Promise<T> {
  return withPublicProjectEnvironment({ PUBLIC_PROJECT_SOURCE: 'catalog_emergency' }, run);
}

async function withPublicProjectEnvironment<T>(
  values: Partial<Record<(typeof PUBLIC_PROJECT_ENV_KEYS)[number], string>>,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map(PUBLIC_PROJECT_ENV_KEYS.map((key) => [key, process.env[key]]));
  resetPublicProjectDetailsLoadForTests();

  for (const key of PUBLIC_PROJECT_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;

  try {
    return await run();
  } finally {
    for (const key of PUBLIC_PROJECT_ENV_KEYS) {
      const previousValue = previous.get(key);
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
    }
    resetPublicProjectDetailsLoadForTests();
  }
}

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
  await insertProjectRecord(db, {
    ...draft,
    id: 'proj-draft-only-unlisted',
    slug: 'proj-draft-only-unlisted',
    lifecycle_state: 'draft_only',
    source: 'github_discovery',
  });
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

function createMockRagSearch(): (query: string) => Promise<PublicRagSearchOutput> {
  return async (query) => {
    if (query.includes('weak')) {
      return { citations: [] };
    }
    return {
      citations: [
        {
          ragSourceId: 'rag-public',
          projectId: 'agentic-trader',
          fileId: 'file_public',
          filename: 'approved-readme.md',
          score: 0.91,
          text: 'Approved public RAG source text with enough detail to support a recruiter-facing answer.',
        },
      ],
    };
  };
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

function throwingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error('model should not be called');
    },
  });
}

function projectDraft(
  projectId: string,
  references: { metricIds?: string[]; linkIds?: string[]; citationIds?: string[] } = {},
): string {
  return JSON.stringify({
    claims: [{
      projectId,
      fields: ['tagline', 'status', 'activity'],
      metricIds: references.metricIds ?? [],
      linkIds: references.linkIds ?? [],
      citationIds: references.citationIds ?? [],
    }],
  });
}

type JsonEvent = {
  type?: string;
  name?: string;
  block?: {
    kind?: string;
    text?: string;
    projectIds?: string[];
    items?: Array<{ id?: string; title?: string; href?: string; summary?: string }>;
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
