import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { DMChatRequest, DMStreamEvent } from '@/lib/dm/contract';
import { createEvalProjectSource, readNdjsonEvents } from '@/lib/dm/eval-fixtures';
import { buildCliJudgePrompt } from '@/lib/dm/judge';
import { createDMChatStream } from '@/lib/dm/runtime';

const CONFIG = { provider: 'openai' as const, model: 'offline-grounding-test' };

test('sanitized corpus exposes published rows only, including DB-only Loom', async () => {
  const source = await createEvalProjectSource();
  assert.deepEqual(source.publishedIds, ['agentic-trader', 'exit-manager', 'loom', 'slurmlet']);
  assert.deepEqual(source.controlIds, ['archived-control', 'candidate-hidden', 'draft-control']);
  assert.deepEqual(source.privateEvidenceMarkers, ['SENTINEL_PRIVATE_EVIDENCE_MUST_NOT_REACH_FACTS_OR_JUDGE']);

  const events = await run('Tell me about the loom project.', answerPlan('loom'));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id), ['loom']);
  assert.ok(!JSON.stringify(events).includes('SENTINEL_'));
  const judgePrompt = buildCliJudgePrompt({
    visitorQuestion: 'Tell me about the loom project.',
    answerText: text(events),
    answerBlocks: ['projects:loom'],
    factPacket: done?.facts ?? null,
    deterministicCheck: 'passed',
  });
  assert.ok(!judgePrompt.includes('SENTINEL_PRIVATE_EVIDENCE'));
});

test('resume and contact turns never stream unconstrained model project prose', async () => {
  const source = await createEvalProjectSource();
  const maliciousModel = model('candidate-hidden delivered 9999 wins at https://private.example/secret.');
  const events = await readNdjsonEvents(createDMChatStream(
    { message: "What is Dylan's public resume background and email?" },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: maliciousModel },
  ));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.equal(done?.facts?.operation, 'none');
  assert.equal(maliciousModel.doStreamCalls.length, 0);
  assert.ok(!text(events).includes('candidate-hidden'));
  assert.ok(!text(events).includes('9999'));
  assert.ok(!text(events).includes('private.example'));
  assert.match(text(events), /public resume highlights and contact details/);
});

test('server-rendered project prose is emitted only after the same-turn project blocks', async () => {
  const events = await run('Which project shows trading automation?', answerPlan('agentic-trader'));
  const blockIndex = events.findIndex((event) => event.type === 'block' && event.block.kind === 'projects');
  const textIndex = events.findIndex((event) => event.type === 'text-delta');
  assert.ok(blockIndex >= 0 && textIndex > blockIndex);
  assert.match(text(events), /agentic-trader/);
  assert.match(text(events), /reviewable trading automation/);
  assert.match(text(events), /Status: Dry-run/);
});

test('valid metric and link claims require and accept same-turn structured ids', async () => {
  const events = await run('Which project shows trading automation?', answerPlan('agentic-trader', {
    metricIds: ['agentic-trader:metric:0'],
    linkIds: ['agentic-trader:link:0'],
  }));
  assert.match(text(events), /scheduled review session: 15:45 ET/);
  assert.match(text(events), /https:\/\/github\.com\/DylanMcCavitt\/agentic-trader/);
});

test('project alias questions cannot bypass the fact packet or prose validator', async () => {
  const malicious = JSON.stringify({
    claims: [{ projectId: 'slurmlet', fields: ['status'], metricIds: [], linkIds: [], citationIds: [] }],
    text: 'Slurmlet processed 9999 jobs using a secret unpublished backend.',
  });
  const events = await run('What is Slurmlet?', malicious);
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.equal(done?.facts?.operation, 'rankProjects');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id), ['slurmlet']);
  assert.ok(!text(events).includes('9999'));
  assert.ok(!text(events).includes('secret unpublished backend'));
});

test('conversation follow-ups retrieve a new same-turn packet from recent public context', async () => {
  const events = await runRequest({
    message: 'What about it?',
    conversation: [
      { role: 'user', content: 'What is Slurmlet?' },
      { role: 'assistant', content: 'Slurmlet is a published project.' },
    ],
  }, answerPlan('slurmlet'));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.equal(done?.facts?.operation, 'rankProjects');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id), ['slurmlet']);
  assert.match(text(events), /slurmlet/i);
});

test('broad project overviews stay concise even when the model requests every long-form field', async () => {
  const source = await createEvalProjectSource();
  const expansiveModel = model(JSON.stringify({
    claims: ['agentic-trader', 'exit-manager', 'loom', 'slurmlet'].map((projectId) => ({
      projectId,
      fields: ['tagline', 'status', 'year', 'activity', 'area', 'about', 'notes'],
      metricIds: [],
      linkIds: [],
      citationIds: [],
    })),
  }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'tell me about dylans projects' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: expansiveModel },
  ));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  const answer = text(events);

  assert.equal(done?.facts?.operation, 'rankProjects');
  assert.equal(done?.facts?.status, 'complete');
  assert.equal(done?.facts?.projects.length, 3);
  assert.equal(expansiveModel.doStreamCalls.length, 0);
  assert.match(answer, /three representative projects/i);
  assert.match(answer, /ask me to go deeper/i);
  assert.doesNotMatch(answer, /did not find an exact published match|returned fallback records/i);
  assert.ok(answer.length < 700, `overview should be concise, received ${answer.length} characters`);
});

for (const exactCase of [
  { prompt: 'Is Slurmlet live?', id: 'slurmlet' },
  { prompt: 'What is tastytrade-exit-manager?', id: 'exit-manager' },
]) {
  test(`exact project identity outranks broad status or substring routing: ${exactCase.prompt}`, async () => {
    const events = await run(exactCase.prompt, answerPlan(exactCase.id));
    const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
    assert.equal(done?.facts?.operation, 'rankProjects');
    assert.deepEqual(done?.facts?.projects.map((project) => project.id), [exactCase.id]);
  });
}

test('unsupported project references are replaced by a deterministic grounded fallback', async () => {
  const events = await run('Which project shows trading automation?', answerPlan('candidate-hidden'));
  assert.ok(!text(events).includes('candidate-hidden'));
  assert.match(text(events), /published projects returned|returned fallback projects|partial set/i);
  assert.ok(events.some((event) => event.type === 'done'));
});

test('wrong status, numeric substrings, private names, and relative links cannot enter rendered prose', async () => {
  for (const modelDraft of [
    JSON.stringify({ claims: [{ projectId: 'agentic-trader', fields: ['status'], metricIds: [], linkIds: [], citationIds: [] }], text: 'agentic-trader is live.' }),
    JSON.stringify({ claims: [{ projectId: 'agentic-trader', fields: ['year'], metricIds: [], linkIds: [], citationIds: [] }], text: 'agentic-trader delivered 20 wins.' }),
    JSON.stringify({ claims: [{ projectId: 'agentic-trader', fields: ['tagline'], metricIds: [], linkIds: [], citationIds: [] }], text: 'candidate-hidden is stronger than agentic-trader.' }),
    JSON.stringify({ claims: [{ projectId: 'agentic-trader', fields: ['tagline'], metricIds: [], linkIds: [], citationIds: [] }], link: '/projects/candidate-hidden' }),
    answerPlan('agentic-trader', { metricIds: ['exit-manager:metric:0'] }),
    answerPlan('agentic-trader', { linkIds: ['missing-link'] }),
    answerPlan('agentic-trader', { citationIds: ['missing-citation'] }),
  ]) {
    const events = await run('Which project shows trading automation?', modelDraft);
    assert.ok(!text(events).includes('candidate-hidden'));
    assert.ok(!text(events).includes('20 wins'));
    assert.ok(!text(events).includes(' is live'));
    assert.match(text(events), /published projects returned|returned fallback projects|partial set/i);
    assert.ok(events.some((event) => event.type === 'done'));
  }
});

test('malformed project prose falls back without emitting the malformed draft', async () => {
  const events = await run('List the live projects.', 'not-json tastytrade-exit-manager 9999');
  assert.ok(!text(events).includes('not-json'));
  assert.ok(!text(events).includes('9999'));
  assert.match(text(events), /tastytrade-exit-manager/);
});

async function run(prompt: string, modelText: string): Promise<DMStreamEvent[]> {
  return runRequest({ message: prompt }, modelText);
}

async function runRequest(request: DMChatRequest, modelText: string): Promise<DMStreamEvent[]> {
  const source = await createEvalProjectSource();
  return readNdjsonEvents(createDMChatStream(
    request,
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: model(modelText) },
  ));
}

function answerPlan(projectId: string, references: {
  metricIds?: string[];
  linkIds?: string[];
  citationIds?: string[];
} = {}): string {
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

function model(modelText: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'response-metadata' as const, id: 'grounding-test', modelId: 'grounding-test', timestamp: new Date(0) },
          { type: 'text-start' as const, id: 'text-1' },
          { type: 'text-delta' as const, id: 'text-1', delta: modelText },
          { type: 'text-end' as const, id: 'text-1' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: 'stop' },
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

function text(events: DMStreamEvent[]): string {
  return events.flatMap((event) => event.type === 'text-delta' ? [event.delta] : []).join('');
}
