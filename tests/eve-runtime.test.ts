import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG } from '../src/data/catalog';
import { RESUME } from '../src/data/resume';
import {
  createGroundingFixtureSet,
  deriveGroundingContext,
  filterCatalog,
  getContact,
  rankProjects,
  readResume,
  searchCatalog,
} from '../src/lib/eve/data-tools';
import {
  assertAnswerBlocksValid,
  createEveAgentStream,
  createEveAnswer,
  readEveRuntimeConfig,
} from '../src/lib/eve/runtime';
import { parseStreamLine, resolveEvidence, validateBlock } from '../src/lib/eve';
import {
  FIT_CHECK_CONTEXT_LIMIT,
  FIT_CHECK_MIN_CHARS,
  sanitizeJobDescriptionForFitCheck,
} from '../src/lib/eve/fit-check';
import { POST } from '../src/pages/api/eve/chat';
import { GET as GETGroundingFixtures } from '../src/pages/api/eve/grounding-fixtures.json';

test('catalog tools search and filter canonical project ids', () => {
  const trading = searchCatalog({ query: 'trading risk broker options', limit: 5 });
  assert.ok(trading.projects.some((project) => project.id === 'exit-manager'));
  assert.ok(trading.projects.some((project) => project.id === 'agentic-trader'));

  const ios = filterCatalog({ area: 'iOS' });
  assert.deepEqual(
    ios.projects.map((project) => project.id),
    ['dog-log', 'chore-ladder'],
  );
});

test('ranking and lookup tools fail loudly for bad ids', () => {
  assert.throws(() => rankProjects({ ids: ['missing-project'] }), /Unknown project id/);
  assert.throws(() => readResume({ trackIds: ['missing-track'] }), /Unknown resume track id/);
  assert.throws(() => deriveGroundingContext('show this', { projectIds: ['missing-project'] }), /Unknown project id/);
  assert.throws(() => deriveGroundingContext('show this', { resumeTrackIds: ['missing-track'] }), /Unknown resume track id/);
});

test('contact data is derived from the current resume track', () => {
  const contact = getContact();
  assert.equal(contact.email, 'dylanmccavitt@outlook.com');
  assert.equal(contact.location, 'new york city');
  assert.equal(contact.status, 'open to opportunities');
  assert.ok(contact.links.some(([label, href]) => label === 'Resume PDF' && href === '/resume.pdf'));
});

test('grounding context derives compact canonical data and prioritizes explicit ids', () => {
  const context = deriveGroundingContext('What should I look at for agent work?', {
    projectIds: ['dog-log'],
    resumeTrackIds: ['now'],
  });

  assert.equal(context.source, 'portfolio-site-canonical-data');
  assert.equal(context.focus, 'projects');
  assert.equal(context.projects[0]?.id, 'dog-log');
  assert.ok(context.projects.some((project) => project.area === 'Agents & MCP'));
  assert.ok((context.projects[0]?.about.length ?? 0) > 0);
  assert.equal(context.remoteCall.required, false);
  assert.match(context.remoteCall.reason, /without waiting/);
  assert.deepEqual(
    context.resume.tracks.map((track) => track.id),
    ['now'],
  );
});

test('contact grounding includes canonical contact context and remote-call rationale', () => {
  const context = deriveGroundingContext('How can I contact Dylan?');

  assert.equal(context.focus, 'contact');
  assert.equal(context.contact?.email, 'dylanmccavitt@outlook.com');
  assert.equal(context.remoteCall.required, false);
  assert.match(context.remoteCall.reason, /without waiting/);
});

test('grounding fixture set covers versioned representative DM contexts', () => {
  const fixtures = createGroundingFixtureSet();

  assert.equal(fixtures.version, 1);
  assert.equal(fixtures.source, 'portfolio-site-canonical-data');
  assert.deepEqual(fixtures.generatedFrom, ['src/data/catalog.ts', 'src/data/resume.ts']);
  assert.deepEqual(
    fixtures.fixtures.map((fixture) => fixture.id),
    [
      'general',
      'recruiter-contact',
      'agent-mcp-work',
      'trading-finance-automation',
      'ios-product-work',
      'shipped-client-work',
      'project-page-agentic-trader',
    ],
  );

  const byId = Object.fromEntries(fixtures.fixtures.map((fixture) => [fixture.id, fixture]));
  assert.equal(byId.general?.packet.remoteCall.required, true);
  assert.equal(byId['recruiter-contact']?.packet.contact?.email, 'dylanmccavitt@outlook.com');
  assert.ok(byId['agent-mcp-work']?.packet.projects.some((project) => project.id === 'tradingview-mcp'));
  assert.ok(byId['trading-finance-automation']?.packet.projects.some((project) => project.id === 'exit-manager'));
  assert.deepEqual(
    byId['ios-product-work']?.packet.projects.map((project) => project.id),
    ['dog-log', 'chore-ladder'],
  );
  assert.ok(byId['shipped-client-work']?.packet.projects.some((project) => project.id === 'bellas-beads'));
  assert.equal(byId['project-page-agentic-trader']?.route, '/projects/agentic-trader');
  assert.deepEqual(
    byId['project-page-agentic-trader']?.packet.projects.map((project) => project.id),
    ['agentic-trader'],
  );
  assert.deepEqual(
    byId['project-page-agentic-trader']?.packet.resume.tracks.map((track) => track.id),
    ['now'],
  );
});

test('grounding fixtures expose canonical ids and stay bounded for cross-repo evals', () => {
  const fixtureSet = createGroundingFixtureSet();
  const projectIds = new Set(CATALOG.map((project) => project.id));
  const resumeTrackIds = new Set(RESUME.tracks.map((track) => track.id));
  const encoded = new TextEncoder().encode(JSON.stringify(fixtureSet));

  assert.ok(encoded.byteLength < 50000, `fixture payload was ${encoded.byteLength} bytes`);

  for (const fixture of fixtureSet.fixtures) {
    assert.equal(fixture.packet.version, fixtureSet.version);
    assert.equal(fixture.packet.source, fixtureSet.source);
    assert.ok(fixture.packet.remoteCall.reason.trim());
    assert.ok(fixture.packet.projects.length <= 4, `${fixture.id} selected too many projects`);

    for (const project of fixture.packet.projects) {
      assert.ok(projectIds.has(project.id), `unknown project id ${project.id}`);
      assert.ok(project.title.trim());
      assert.ok(project.area.trim());
      assert.ok(project.line.trim());
      assert.ok(Array.isArray(project.metrics));
      assert.ok(Array.isArray(project.links));
      assert.equal('shots' in project, false, `${fixture.id} leaked project shots`);
      assert.equal('hue' in project, false, `${fixture.id} leaked project hue`);
      assert.equal('seek' in project, false, `${fixture.id} leaked project seek`);
    }

    for (const track of fixture.packet.resume.tracks) {
      assert.ok(resumeTrackIds.has(track.id), `unknown resume track id ${track.id}`);
      assert.ok(track.title.trim());
      assert.ok(track.role.trim());
    }

    if (fixture.packet.contact) {
      assert.ok(fixture.packet.contact.links.length >= 2);
      assert.ok(fixture.packet.contact.resumeHref.trim());
    }
  }
});

test('grounding fixtures endpoint emits the generated packet as JSON', async () => {
  const response = await GETGroundingFixtures({} as never);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.deepEqual(body, createGroundingFixtureSet());
});

test('answer blocks preserve canonical ids and trace metadata', () => {
  const answer = createEveAnswer('Can he ship iOS apps?');
  const projectBlock = answer.blocks.find((block) => block.kind === 'projects');
  const evidenceBlock = answer.blocks.find((block) => block.kind === 'evidence');

  assert.deepEqual(projectBlock, { kind: 'projects', ids: ['dog-log', 'chore-ladder'] });
  assert.deepEqual(evidenceBlock, {
    kind: 'evidence',
    projectIds: ['dog-log', 'chore-ladder'],
  });
  assert.equal(answer.trace.count, 1);
  assert.equal(answer.trace.items[0]?.tool, 'filter_catalog');
});

test('answer artifacts prioritize explicit chat context ids', () => {
  const answer = createEveAnswer('What should I look at for agent work?', {
    projectIds: ['dog-log'],
    resumeTrackIds: ['now'],
  });
  const projectBlock = answer.blocks.find((block) => block.kind === 'projects');
  const resumeBlock = answer.blocks.find((block) => block.kind === 'resume');

  if (projectBlock?.kind !== 'projects') assert.fail('expected project block');
  if (resumeBlock?.kind !== 'resume') assert.fail('expected resume block');
  assert.equal(projectBlock.ids[0], 'dog-log');
  assert.deepEqual(resumeBlock.trackIds, ['now']);

  const evidenceBlock = answer.blocks.find((block) => block.kind === 'evidence');
  if (evidenceBlock?.kind !== 'evidence') assert.fail('expected evidence block');
  assert.equal(evidenceBlock.projectIds?.[0], 'dog-log');
  assert.deepEqual(evidenceBlock.resumeTrackIds, ['now']);
});

test('evidence block validation accepts canonical ids and rejects unsafe shapes', () => {
  assert.doesNotThrow(() =>
    assertAnswerBlocksValid([{ kind: 'evidence', projectIds: ['agentic-trader'], resumeTrackIds: ['now'] }]),
  );
  assert.throws(
    () => assertAnswerBlocksValid([{ kind: 'evidence', projectIds: ['missing-project'] }]),
    /Unknown project id/,
  );
  assert.throws(() => assertAnswerBlocksValid([{ kind: 'evidence' }]), /empty evidence block/);

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

test('fit-check grounding returns conservative evidence blocks without remote synthesis', () => {
  const jobDescription =
    'Software engineer role focused on backend services, automation, AI tooling, product judgment, reliability, testing, customer-facing shipping, and clear communication. '.repeat(4);
  const fitCheck = {
    kind: 'job-description' as const,
    ...sanitizeJobDescriptionForFitCheck(jobDescription),
  };
  const context = deriveGroundingContext('Fit-check this role', { fitCheck });
  const answer = createEveAnswer('Fit-check this role', { fitCheck });

  assert.equal(context.focus, 'fit-check');
  assert.equal(context.remoteCall.required, false);
  assert.match(context.remoteCall.reason, /without sending the paste to a remote agent/);
  assert.ok((context.fitCheck?.jobDescription.length ?? 0) >= FIT_CHECK_MIN_CHARS);
  assert.ok(answer.blocks.some((block) => block.kind === 'text' && /Fit summary:/.test(block.text)));
  assert.ok(answer.blocks.some((block) => block.kind === 'text' && /Gaps or unknowns:/.test(block.text)));
  assert.ok(answer.blocks.some((block) => block.kind === 'projects'));
  assert.ok(answer.blocks.some((block) => block.kind === 'resume'));
  assert.ok(answer.blocks.some((block) => block.kind === 'contact'));
  assert.ok(answer.blocks.some((block) => block.kind === 'text' && /not a match score/.test(block.text)));
  assert.ok(!JSON.stringify(answer.blocks).includes('100%'));
});

test('unknown and empty questions return visitor-safe fallback blocks', () => {
  const unknown = createEveAnswer('what is his favorite breakfast cereal?');
  assert.ok(unknown.blocks.some((block) => block.kind === 'text'));
  assert.ok(unknown.blocks.some((block) => block.kind === 'links'));

  const empty = createEveAnswer('');
  assert.ok(empty.blocks.some((block) => block.kind === 'links'));
});

test('runtime config points at the deployed portfolio-agent host', () => {
  assert.throws(() => readEveRuntimeConfig({}), /EVE_AGENT_HOST/);
  assert.deepEqual(readEveRuntimeConfig({ EVE_AGENT_HOST: 'http://127.0.0.1:3333/' }), {
    agentHost: 'http://127.0.0.1:3333',
    bearerToken: undefined,
    bypassSecret: undefined,
    isLoopback: true,
  });
});

test('catalog search questions stream remote prose with deterministic site artifacts', async () => {
  const sessionBodies: SessionBody[] = [];
  const fetchImpl = remoteFetch(
    [
      { type: 'message.appended', data: { messageDelta: 'These are the strongest agent projects.' } },
      { type: 'message.completed', data: { message: 'These are the strongest agent projects.' } },
    ],
    sessionBodies,
  );

  const config = readEveRuntimeConfig({ EVE_AGENT_HOST: 'http://127.0.0.1:3333' });
  const stream = createEveAgentStream(
    { message: 'What should I look at for agent work?' },
    config,
    { fetch: fetchImpl },
  );

  const events = await readNdjson(stream);

  assert.equal(sessionBodies[0]?.clientContext?.remoteCall?.required, false);
  assert.equal(events[0].type, 'ready');
  assert.equal(events[0].provider, 'portfolio-agent');
  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === 'These are the strongest agent projects.'));
  assert.ok(events.some((event) => hasBlockKind(event, 'projects')));
  assert.ok(events.some((event) => hasBlockKind(event, 'evidence')));
  assert.equal(events.at(-1)?.type, 'done');
});

test('fit-check requests stream through the chat endpoint without calling the remote agent', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response('unexpected remote call', { status: 500 });
  };
  const jobDescription =
    'Backend software engineer role needing automation, AI tooling, testing, reliability, product judgment, clear communication, and shipped customer-facing systems. '.repeat(4);
  const fitCheck = {
    kind: 'job-description' as const,
    ...sanitizeJobDescriptionForFitCheck(jobDescription),
  };

  const config = readEveRuntimeConfig({ EVE_AGENT_HOST: 'http://127.0.0.1:3333' });
  const stream = createEveAgentStream(
    {
      message: 'Fit-check this job description against Dylan’s portfolio and resume.',
      context: { fitCheck },
    },
    config,
    { fetch: fetchImpl },
  );

  const events = await readNdjson(stream);

  assert.deepEqual(calls, []);
  assert.equal(events[0].type, 'ready');
  assert.equal(events[0].provider, 'portfolio-site');
  assert.ok(events.some((event) => hasTextBlockMatching(event, /Fit summary:/)));
  assert.ok(events.some((event) => hasTextBlockMatching(event, /Strongest evidence projects:/)));
  assert.ok(events.some((event) => hasTextBlockMatching(event, /Resume\/background evidence:/)));
  assert.ok(events.some((event) => hasTextBlockMatching(event, /Gaps or unknowns:/)));
  assert.ok(events.some((event) => hasTextBlockMatching(event, /Next contact steps:/)));
  assert.ok(events.some((event) => hasBlockKind(event, 'projects')));
  assert.ok(events.some((event) => hasBlockKind(event, 'resume')));
  assert.ok(events.some((event) => hasBlockKind(event, 'contact')));
  assert.equal(events.at(-1)?.type, 'done');
});

test('open-ended questions still stream from portfolio-agent with grounding context', async () => {
  const calls: string[] = [];
  const sessionBodies: SessionBody[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);

    if (url === 'http://127.0.0.1:3333/eve/v1/session') {
      sessionBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, sessionId: 'session-1' }), {
        status: 202,
        headers: {
          'content-type': 'application/json',
          'x-eve-session-id': 'session-1',
        },
      });
    }

    if (url === 'http://127.0.0.1:3333/eve/v1/session/session-1/stream') {
      return new Response(
        [
          JSON.stringify({ type: 'session.started', data: { runtime: { agentId: 'portfolio-agent' } } }),
          JSON.stringify({ type: 'message.appended', data: { messageDelta: 'Agent', messageSoFar: 'Agent' } }),
          JSON.stringify({ type: 'message.appended', data: { messageDelta: ' work', messageSoFar: 'Agent work' } }),
          JSON.stringify({ type: 'message.completed', data: { message: 'Agent work' } }),
        ].join('\n'),
        { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } },
      );
    }

    return new Response('not found', { status: 404 });
  };

  const config = readEveRuntimeConfig({ EVE_AGENT_HOST: 'http://127.0.0.1:3333' });
  const stream = createEveAgentStream(
    { message: 'How should Dylan describe himself?' },
    config,
    { fetch: fetchImpl },
  );

  const events = await readNdjson(stream);

  assert.deepEqual(calls, [
    'http://127.0.0.1:3333/eve/v1/session',
    'http://127.0.0.1:3333/eve/v1/session/session-1/stream',
  ]);
  assert.equal(sessionBodies.length, 1);
  assert.equal(sessionBodies[0]?.message, 'How should Dylan describe himself?');
  assert.equal(sessionBodies[0]?.clientContext?.source, 'portfolio-site-canonical-data');
  assert.equal(sessionBodies[0]?.clientContext?.focus, 'general');
  assert.equal(sessionBodies[0]?.clientContext?.remoteCall?.required, true);
  assert.equal(events[0].type, 'ready');
  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === 'Agent'));
  assert.ok(events.some((event) => hasBlockKind(event, 'links')));
  assert.equal(events.at(-1)?.type, 'done');
});

test('remote answer blocks stream after site validation', async () => {
  const events = await readAgentStreamEvents([
    {
      type: 'message.completed',
      data: {
        message: 'Here are the blocks.',
        answerBlocks: [
          { kind: 'text', text: 'A complete text block.' },
          { kind: 'projects', ids: ['agentic-trader'] },
          { kind: 'resume', trackIds: ['now'] },
          { kind: 'contact', email: 'ignored@example.com' },
          { kind: 'links', items: [['Hiring tour', '/hiring']] },
        ],
      },
    },
  ]);

  assert.ok(events.some((event) => hasBlockKind(event, 'text')));
  assert.ok(events.some((event) => hasBlockKind(event, 'projects')));
  assert.ok(events.some((event) => hasBlockKind(event, 'resume')));
  assert.ok(events.some((event) => hasBlockKind(event, 'contact')));
  assert.ok(events.some((event) => hasBlockKind(event, 'links')));
  assert.deepEqual(blocksOfKind(events, 'projects')[0], { kind: 'projects', ids: ['agentic-trader'] });
  assert.deepEqual(blocksOfKind(events, 'resume')[0], { kind: 'resume', trackIds: ['now'] });
  assert.deepEqual(blocksOfKind(events, 'contact')[0], { kind: 'contact' });
});

test('remote answer blocks unwrap nested structured output results', async () => {
  const events = await readAgentStreamEvents([
    {
      type: 'result.completed',
      data: {
        result: {
          answerBlocks: [
            { kind: 'text', text: 'A structured fit summary.' },
            { kind: 'projects', ids: ['agentic-trader'] },
            { kind: 'resume', trackIds: ['now'] },
          ],
        },
      },
    },
  ]);

  assert.deepEqual(blocksOfKind(events, 'text')[0], { kind: 'text', text: 'A structured fit summary.' });
  assert.deepEqual(blocksOfKind(events, 'projects')[0], { kind: 'projects', ids: ['agentic-trader'] });
  assert.deepEqual(blocksOfKind(events, 'resume')[0], { kind: 'resume', trackIds: ['now'] });
});

test('remote answer blocks skip unknown malformed and unsafe payloads', async () => {
  const events = await readAgentStreamEvents([
    {
      type: 'answer.blocks',
      data: {
        answerBlocks: [
          { kind: 'chart', ids: ['agentic-trader'] },
          { kind: 'projects', ids: ['missing-project'] },
          { kind: 'resume', trackIds: [42] },
          { kind: 'links', items: [['Bad', 'javascript:alert(1)']] },
          { kind: 'resume', trackIds: ['now'] },
        ],
      },
    },
    { type: 'message.appended', data: { messageDelta: 'Still answering.' } },
  ]);

  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === 'Still answering.'));
  assert.deepEqual(blocksOfKind(events, 'projects'), []);
  assert.deepEqual(blocksOfKind(events, 'links'), [
    { kind: 'links', items: [['Project library', '/library'], ['Resume', '/journey'], ['Hiring tour', '/hiring']] },
  ]);
  assert.deepEqual(blocksOfKind(events, 'resume'), [{ kind: 'resume', trackIds: ['now'] }]);
  assert.equal(events.at(-1)?.type, 'done');
});

test('mixed remote and site artifacts dedupe canonical project ids', async () => {
  const events = await readAgentStreamEvents(
    [
      {
        type: 'answer.block',
        data: { kind: 'projects', ids: ['agentic-trader'] },
      },
      { type: 'message.appended', data: { messageDelta: 'Use this shortlist.' } },
    ],
    'What should I look at for agent work?',
  );

  const projectBlocks = blocksOfKind(events, 'projects');
  assert.equal(projectBlocks.length, 2);
  assert.deepEqual(projectBlocks[0], { kind: 'projects', ids: ['agentic-trader'] });
  const supplemental = projectBlocks[1] as { kind?: unknown; ids?: unknown };
  assert.equal(supplemental.kind, 'projects');
  assert.ok(Array.isArray(supplemental.ids));
  assert.ok(!supplemental.ids.includes('agentic-trader'));
  assert.ok(supplemental.ids.length > 0);
});

test('mixed remote and site artifacts preserve evidence summaries', async () => {
  const events = await readAgentStreamEvents(
    [
      {
        type: 'answer.block',
        data: { kind: 'projects', ids: ['agentic-trader'] },
      },
      { type: 'message.appended', data: { messageDelta: 'Use this shortlist.' } },
    ],
    'What should I look at for agent work?',
  );

  const evidenceBlocks = blocksOfKind(events, 'evidence');
  assert.equal(evidenceBlocks.length, 1);
  const evidence = evidenceBlocks[0] as { kind?: unknown; projectIds?: unknown; resumeTrackIds?: unknown };
  assert.equal(evidence.kind, 'evidence');
  assert.ok(Array.isArray(evidence.projectIds));
  assert.ok(evidence.projectIds.includes('agentic-trader'));
});

test('chat endpoint streams from portfolio-agent when configured', async () => {
  const previousHost = process.env.EVE_AGENT_HOST;
  const previousFetch = globalThis.fetch;

  process.env.EVE_AGENT_HOST = 'http://127.0.0.1:3333';
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url === 'http://127.0.0.1:3333/eve/v1/session') {
      return new Response(JSON.stringify({ sessionId: 'session-1' }), {
        status: 202,
        headers: { 'x-eve-session-id': 'session-1', 'content-type': 'application/json' },
      });
    }
    if (url === 'http://127.0.0.1:3333/eve/v1/session/session-1/stream') {
      return new Response(
        `${JSON.stringify({ type: 'message.appended', data: { messageDelta: 'hello', messageSoFar: 'hello' } })}\n`,
        { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } },
      );
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const response = await POST({
      request: new Request('https://example.test/api/eve/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'What is his favorite color?' }),
      }),
    } as never);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/x-ndjson; charset=utf-8');

    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.equal(events[0].type, 'ready');
    assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === 'hello'));
    assert.ok(events.some((event) => hasBlockKind(event, 'links')));
    assert.equal(events.at(-1)?.type, 'done');
  } finally {
    restoreEnv('EVE_AGENT_HOST', previousHost);
    globalThis.fetch = previousFetch;
  }
});

test('chat endpoint validates fit-check pasted context safely', async () => {
  const previousHost = process.env.EVE_AGENT_HOST;
  const previousFetch = globalThis.fetch;

  process.env.EVE_AGENT_HOST = 'http://127.0.0.1:3333';
  globalThis.fetch = (async () => new Response('unexpected remote call', { status: 500 })) as typeof fetch;

  try {
    const tooShort = await POST({
      request: new Request('https://example.test/api/eve/chat', {
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

    const valid = await POST({
      request: new Request('https://example.test/api/eve/chat', {
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
    const events = (await valid.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    assert.equal(valid.status, 200);
    assert.ok(events.some((event) => hasTextBlockMatching(event, /Fit summary:/)));
    assert.ok(events.some((event) => hasBlockKind(event, 'contact')));
  } finally {
    restoreEnv('EVE_AGENT_HOST', previousHost);
    globalThis.fetch = previousFetch;
  }
});

test('chat endpoint fails safely when runtime env is missing', async () => {
  const previousHost = process.env.EVE_AGENT_HOST;

  delete process.env.EVE_AGENT_HOST;

  try {
    const response = await POST({
      request: new Request('https://example.test/api/eve/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      }),
    } as never);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'missing_config',
        message: 'DM is not configured for chat yet.',
      },
    });
  } finally {
    restoreEnv('EVE_AGENT_HOST', previousHost);
  }
});

type JsonEvent = { type?: string; [key: string]: unknown };
type SessionBody = {
  message?: string;
  clientContext?: {
    source?: string;
    focus?: string;
    projects?: unknown[];
    remoteCall?: { required?: boolean };
  };
};

async function readAgentStreamEvents(
  remoteEvents: unknown[],
  message = 'How should Dylan describe himself?',
): Promise<JsonEvent[]> {
  const config = readEveRuntimeConfig({ EVE_AGENT_HOST: 'http://127.0.0.1:3333' });
  const stream = createEveAgentStream(
    { message },
    config,
    { fetch: remoteFetch(remoteEvents) },
  );
  return readNdjson(stream);
}

function remoteFetch(remoteEvents: unknown[], sessionBodies: SessionBody[] = []): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (url === 'http://127.0.0.1:3333/eve/v1/session') {
      sessionBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, sessionId: 'session-1' }), {
        status: 202,
        headers: {
          'content-type': 'application/json',
          'x-eve-session-id': 'session-1',
        },
      });
    }

    if (url === 'http://127.0.0.1:3333/eve/v1/session/session-1/stream') {
      return new Response(remoteEvents.map((event) => JSON.stringify(event)).join('\n'), {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      });
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function hasBlockKind(event: JsonEvent, kind: string): boolean {
  const block = event.block;
  return (
    event.type === 'block' &&
    typeof block === 'object' &&
    block !== null &&
    'kind' in block &&
    (block as { kind: unknown }).kind === kind
  );
}

function blocksOfKind(events: JsonEvent[], kind: string): JsonEvent[] {
  return events
    .filter((event) => hasBlockKind(event, kind))
    .map((event) => event.block as JsonEvent);
}

function hasTextBlockMatching(event: JsonEvent, pattern: RegExp): boolean {
  const block = event.block;
  return (
    event.type === 'block' &&
    typeof block === 'object' &&
    block !== null &&
    'kind' in block &&
    (block as { kind: unknown }).kind === 'text' &&
    'text' in block &&
    typeof (block as { text: unknown }).text === 'string' &&
    pattern.test((block as { text: string }).text)
  );
}

async function readNdjson(stream: ReadableStream<Uint8Array>): Promise<JsonEvent[]> {
  const text = await new Response(stream).text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
