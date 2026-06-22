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
  createEveAgentStream,
  createEveAnswer,
  readEveRuntimeConfig,
} from '../src/lib/eve/runtime';
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

  assert.deepEqual(projectBlock, { kind: 'projects', ids: ['dog-log', 'chore-ladder'] });
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

test('catalog search questions stream immediately without the remote agent', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response('unexpected remote call', { status: 500 });
  };

  const config = readEveRuntimeConfig({ EVE_AGENT_HOST: 'http://127.0.0.1:3333' });
  const stream = createEveAgentStream(
    { message: 'What should I look at for agent work?' },
    config,
    { fetch: fetchImpl },
  );

  const events = await readNdjson(stream);

  assert.deepEqual(calls, []);
  assert.equal(events[0].type, 'ready');
  assert.equal(events[0].provider, 'portfolio-site');
  assert.ok(events.some((event) => hasBlockKind(event, 'projects')));
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
