import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCatalog, getContact, rankProjects, readResume, searchCatalog } from '../src/lib/eve/data-tools';
import {
  createEveAgentStream,
  createEveAnswer,
  readEveRuntimeConfig,
} from '../src/lib/eve/runtime';
import { POST } from '../src/pages/api/eve/chat';

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
});

test('contact data is derived from the current resume track', () => {
  const contact = getContact();
  assert.equal(contact.email, 'dylanmccavitt@outlook.com');
  assert.equal(contact.location, 'new york city');
  assert.equal(contact.status, 'open to opportunities');
  assert.ok(contact.links.some(([label, href]) => label === 'Resume PDF' && href === '/resume.pdf'));
});

test('answer blocks preserve canonical ids and trace metadata', () => {
  const answer = createEveAnswer('Can he ship iOS apps?');
  const projectBlock = answer.blocks.find((block) => block.kind === 'projects');

  assert.deepEqual(projectBlock, { kind: 'projects', ids: ['dog-log', 'chore-ladder'] });
  assert.equal(answer.trace.count, 1);
  assert.equal(answer.trace.items[0]?.tool, 'filter_catalog');
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

test('portfolio-agent stream is transformed into UI events plus artifact blocks', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url === 'http://127.0.0.1:3333/eve/v1/session') {
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
    { message: 'What should I look at for agent work?' },
    config,
    { fetch: fetchImpl },
  );

  const events = await readNdjson(stream);

  assert.deepEqual(calls, [
    'http://127.0.0.1:3333/eve/v1/session',
    'http://127.0.0.1:3333/eve/v1/session/session-1/stream',
  ]);
  assert.equal(events[0].type, 'ready');
  assert.ok(events.some((event) => event.type === 'text-delta' && event.delta === 'Agent'));
  assert.ok(events.some((event) => hasBlockKind(event, 'projects')));
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
        body: JSON.stringify({ message: 'Can he ship iOS apps?' }),
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
    assert.ok(events.some((event) => hasBlockKind(event, 'projects')));
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
        message: 'Eve is not configured for chat yet.',
      },
    });
  } finally {
    restoreEnv('EVE_AGENT_HOST', previousHost);
  }
});

type JsonEvent = { type?: string; [key: string]: unknown };

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
