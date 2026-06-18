import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCatalog, getContact, rankProjects, readResume, searchCatalog } from '../src/lib/eve/data-tools';
import { createEveAnswer, readEveRuntimeConfig } from '../src/lib/eve/runtime';
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

test('runtime config requires provider and model env', () => {
  assert.throws(() => readEveRuntimeConfig({}), /EVE_PROVIDER, EVE_MODEL/);
  assert.deepEqual(readEveRuntimeConfig({ EVE_PROVIDER: 'openai', EVE_MODEL: 'gpt-test' }), {
    provider: 'openai',
    modelId: 'openai/gpt-test',
    hasGatewayAuth: false,
  });
});

test('chat endpoint streams answer-block events when configured', async () => {
  const previousProvider = process.env.EVE_PROVIDER;
  const previousModel = process.env.EVE_MODEL;

  process.env.EVE_PROVIDER = 'openai';
  process.env.EVE_MODEL = 'gpt-test';

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
    assert.ok(events.some((event) => event.type === 'block' && event.block.kind === 'projects'));
    assert.equal(events.at(-1)?.type, 'done');
  } finally {
    restoreEnv('EVE_PROVIDER', previousProvider);
    restoreEnv('EVE_MODEL', previousModel);
  }
});

test('chat endpoint fails safely when runtime env is missing', async () => {
  const previousProvider = process.env.EVE_PROVIDER;
  const previousModel = process.env.EVE_MODEL;

  delete process.env.EVE_PROVIDER;
  delete process.env.EVE_MODEL;

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
    restoreEnv('EVE_PROVIDER', previousProvider);
    restoreEnv('EVE_MODEL', previousModel);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
