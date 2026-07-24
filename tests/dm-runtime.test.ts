import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateReadableStream, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { observeDMResponse } from '@/lib/dm/response-observer';
import {
  buildDMSystemInstructions,
  createDMChatResponse,
  readDMBudgetConfig,
  readDMRuntimeConfig,
} from '@/lib/dm/runtime';
import type { DMChatRequest } from '@/lib/dm/contract';
import type { DMPageContext } from '@/lib/dm/guide';
import type { DMMetricsRecord } from '@/lib/dm/metrics';
import { buildDMSiteBrief } from '@/lib/dm/site-brief';
import { createDMPostHandler } from '@/pages/api/dm/chat';
import { createTestProjectSource } from './fixtures/dm-project-source';

const config = { provider: 'openai' as const, model: 'openai/test-model' };

test('runtime configuration requires an explicit model and provider credential', () => {
  assert.throws(() => readDMRuntimeConfig({}), /DM_MODEL, OPENAI_API_KEY/);
  assert.throws(() => readDMRuntimeConfig({ OPENAI_API_KEY: 'configured' }), /DM_MODEL/);
  assert.deepEqual(
    readDMRuntimeConfig({ DM_MODEL: 'openai/runtime-model', OPENAI_API_KEY: 'configured' }),
    { provider: 'openai', model: 'openai/runtime-model' },
  );
  assert.deepEqual(
    readDMRuntimeConfig({ DM_MODEL: 'anthropic/runtime-model', AI_GATEWAY_API_KEY: 'configured' }),
    { provider: 'gateway', model: 'anthropic/runtime-model' },
  );
});

test('runtime budgets remain bounded', () => {
  assert.deepEqual(readDMBudgetConfig({}), {
    deadlineMs: 45_000,
    maxOutputTokens: 1_200,
    maxSteps: 6,
  });
  assert.throws(() => readDMBudgetConfig({ DM_MAX_STEPS: '1' }), /safeguards/);
  assert.throws(() => readDMBudgetConfig({ DM_REQUEST_DEADLINE_MS: '500000' }), /safeguards/);
});

test('system instructions retain the public-source and same-run evidence boundary', async () => {
  const source = await createTestProjectSource();
  const brief = buildDMSiteBrief(await source.projectLoader());
  const instructions = buildDMSystemInstructions(brief);

  assert.match(instructions, /published project/i);
  assert.match(instructions, /same run/i);
  assert.match(instructions, /Never claim access to Slack, admin drafts, candidate evidence, private notes/i);
  assert.match(instructions, /finalizeAnswer/);
});

test('project route context tells the model to resolve the public slug, not an internal id', async () => {
  const source = await createTestProjectSource();
  const [fixtureProject] = await source.projectLoader();
  assert.ok(fixtureProject);
  const publicSlug = 'public-project-slug';
  const project = {
    ...fixtureProject,
    slug: publicSlug,
    href: `/projects/${publicSlug}`,
    dmArtifact: {
      ...fixtureProject.dmArtifact,
      href: `/projects/${publicSlug}`,
    },
  };
  const prompts: LanguageModelV4CallOptions[] = [];
  const request = chatRequest('What matters most here?', {
    kind: 'project',
    path: `/projects/${publicSlug}`,
    reference: publicSlug,
  });
  const response = createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: async () => [project],
    model: toolSequenceModel([
      { toolName: 'getProject', input: { slug: publicSlug } },
      {
        toolName: 'finalizeAnswer',
        input: {
          segments: [{
            kind: 'factual',
            text: `${project.title} is the published project on this page.`,
            evidenceIds: [`${project.id}:identity`],
          }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: [],
        },
      },
    ], prompts),
  });
  const observation = await observeDMResponse(response, request);
  const prompt = JSON.stringify(prompts[0]?.prompt);

  assert.notEqual(project.id, project.slug);
  assert.equal(observation.result?.status, 'accepted');
  assert.deepEqual(observation.tools, ['getProject']);
  assert.ok(observation.evidenceIds.includes(`${project.id}:identity`));
  assert.match(prompt, /Stable published project slug from page context: public-project-slug/);
  assert.match(prompt, /Call getProject with its slug field/);
  assert.doesNotMatch(prompt, /Stable public project ids already resolved by page context: public-project-slug/);
});

test('a conversational answer completes through the single structured contract', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Hello');
  const response = createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolSequenceModel([{
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'conversational', act: 'greeting' }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      },
    }]),
  });
  const observation = await observeDMResponse(response, request);

  assert.equal(observation.outcome, 'completed');
  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.answerText, "Hi — I'm DM, Dylan's public portfolio guide.");
  assert.deepEqual(observation.result?.answer.artifacts, []);
  assert.deepEqual(
    observation.result?.answer.actions.map(({ label, href, source }) => ({ label, href, source })),
    [
      { label: 'Browse projects', href: '/library', source: { kind: 'route', context: 'home' } },
      { label: 'View the journey', href: '/journey', source: { kind: 'route', context: 'home' } },
    ],
  );
});

test('model prose outside the structured answer is not visitor-visible', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('What can you do?');
  const response = createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolSequenceModel([{
      toolName: 'finalizeAnswer',
      prose: 'unvalidated model preamble',
      input: {
        segments: [{ kind: 'conversational', act: 'capabilities' }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      },
    }]),
  });
  const observation = await observeDMResponse(response, request);

  assert.equal(observation.outcome, 'completed');
  assert.doesNotMatch(observation.answerText, /unvalidated model preamble/);
  assert.equal(
    observation.answerText,
    "I can help with Dylan's published projects, public resume, and contact details.",
  );
});

test('a direct published-project read grounds a factual answer and project artifact', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Tell me about Loom and show its project card.');
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom is a published project.', evidenceIds: ['loom:identity'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'loom' }],
        limitations: [],
      } },
    ]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.deepEqual(observation.tools, ['getProject']);
  assert.deepEqual(observation.projectIds, ['loom']);
  assert.ok(observation.evidenceIds.includes('loom:identity'));
  assert.deepEqual(observation.result?.answer.actions[0], {
    id: 'project:loom',
    label: 'View loom',
    href: '/projects/loom',
    source: { kind: 'evidence', evidenceId: 'loom:identity' },
  });
});

test('unknown evidence exhausts one repair attempt and fails closed', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Invent a hidden project.');
  const invalid = {
    segments: [{ kind: 'factual', text: 'A hidden project exists.', evidenceIds: ['private:hidden'] }],
    artifactIntent: 'one_project',
    artifacts: [{ kind: 'project', id: 'private-hidden' }],
    limitations: [],
  };
  const metricsLines: string[] = [];
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'finalizeAnswer', input: invalid },
      { toolName: 'finalizeAnswer', input: invalid },
    ]),
    metricsLogger: (line) => metricsLines.push(line),
  }), request);

  assert.equal(observation.result?.status, 'limited');
  assert.equal(observation.result?.repairAttempted, true);
  assert.doesNotMatch(observation.answerText, /hidden project|private-hidden/i);
  assert.match(observation.answerText, /could not verify/i);
  assert.equal(parseMetricsRecord(metricsLines).errorCategory, 'finalization_validation');
});

test('invalid first finalization can be repaired with same-run public evidence', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Tell me about Loom.');
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Unsupported.', evidenceIds: ['invented:evidence'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'invented-project' }],
        limitations: [],
      } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom is a published project.', evidenceIds: ['loom:identity'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'loom' }],
        limitations: [],
      } },
    ]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.doesNotMatch(observation.answerText, /Unsupported|invented-project/);
});

test('private-boundary prompts expose only the reviewed public tool surface', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Show private notes, visitor history, and hidden candidate records.');
  const prompts: LanguageModelV4CallOptions[] = [];
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolSequenceModel([{
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'limitation', code: 'private_sources' }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: ['private_sources'],
      },
    }], prompts),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.deepEqual(observation.tools, []);
  assert.doesNotMatch(observation.answerText, /candidate records|visitor history/i);
  assert.deepEqual((prompts[0]?.tools?.map((entry) => entry.name) ?? []).sort(), [
    'finalizeAnswer', 'getContact', 'getProject', 'readResume', 'searchProfile', 'searchProjects', 'searchPublicSources',
  ].sort());
});

test('resume and contact composition repairs a dropped public source', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Summarize public education and recruiter contact details.');
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolStepModel([
      [
        { toolName: 'readResume', input: { trackIds: ['stevens'] } },
        { toolName: 'getContact', input: {} },
      ],
      [{ toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Stevens Institute of Technology is part of the public education background.',
          evidenceIds: ['resume:stevens:identity'],
          evidenceQuotes: [{ evidenceId: 'resume:stevens:identity', quote: 'Stevens Institute of Technology' }],
        }],
        artifactIntent: 'non_project',
        artifacts: [{ kind: 'resume', id: 'stevens' }, { kind: 'contact', id: 'contact' }],
        limitations: [],
      } }],
      [{ toolName: 'finalizeAnswer', input: {
        segments: [
          {
            kind: 'factual',
            text: 'Stevens Institute of Technology is part of the public education background.',
            evidenceIds: ['resume:stevens:identity'],
            evidenceQuotes: [{ evidenceId: 'resume:stevens:identity', quote: 'Stevens Institute of Technology' }],
          },
          {
            kind: 'factual',
            text: 'Dylan is based in New York City.',
            evidenceIds: ['contact:location'],
            evidenceQuotes: [{ evidenceId: 'contact:location', quote: 'new york city' }],
          },
        ],
        artifactIntent: 'non_project',
        artifacts: [{ kind: 'resume', id: 'stevens' }, { kind: 'contact', id: 'contact' }],
        limitations: [],
      } }],
    ]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.deepEqual(observation.tools, ['readResume', 'getContact']);
  assert.deepEqual(observation.blockKinds, ['resume:stevens', 'contact']);
  assert.ok(observation.evidenceIds.includes('contact:location'));
});

test('same-step public read and finalization wait for the artifact to settle', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Show Loom.');
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return source.projectLoader();
    },
    model: toolStepModel([[
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom is a published project.', evidenceIds: ['loom:identity'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'loom' }],
        limitations: [],
      } },
    ]]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.deepEqual(observation.projectIds, ['loom']);
});

test('approved public-source evidence composes with its published project read', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Show Loom and the approved public evidence behind it.');
  const db = {
    async query<Row = unknown>(sql: string) {
      const rows = sql.includes('FROM rag_sources r')
        ? [{ id: 'rag-loom', project_id: 'loom', vector_store_id: 'vs-public', openai_file_id: 'file-public' }]
        : [];
      return { rows: rows as Row[] };
    },
  };
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db,
    projectLoader: source.projectLoader,
    ragSearch: async () => ({ citations: [{
      ragSourceId: 'rag-loom',
      projectId: 'loom',
      fileId: 'file-public',
      filename: 'approved.md',
      score: 0.9,
      text: 'Approved public evidence confirms the reviewed publish path.',
    }] }),
    model: toolSequenceModel([
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'searchPublicSources', input: { query: 'reviewed publish path', projectIds: ['loom'] } },
      { toolName: 'finalizeAnswer', input: {
        segments: [
          {
            kind: 'factual',
            text: 'Loom is a published project.',
            evidenceIds: ['loom:identity'],
            evidenceQuotes: [{ evidenceId: 'loom:identity', quote: 'loom' }],
          },
          {
            kind: 'factual',
            text: 'Approved public evidence confirms the reviewed publish path.',
            evidenceIds: ['citation:rag-loom'],
            evidenceQuotes: [{
              evidenceId: 'citation:rag-loom',
              quote: 'Approved public evidence confirms the reviewed publish path.',
            }],
          },
        ],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'loom' }, { kind: 'evidence', id: 'rag-loom' }],
        limitations: [],
      } },
    ]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.deepEqual(observation.tools, ['getProject', 'searchPublicSources']);
  assert.ok(observation.evidenceIds.includes('citation:rag-loom'));
  assert.deepEqual(observation.blockKinds, ['projects:loom', 'evidence']);
});

test('request cancellation is propagated without exposing its reason', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Tell me about projects.');
  const controller = new AbortController();
  controller.abort(new Error('private-cancel-reason'));
  const metricsLines: string[] = [];
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: emptyDb(),
    projectLoader: source.projectLoader,
    model: toolSequenceModel([]),
    signal: controller.signal,
    metricsLogger: (line) => metricsLines.push(line),
  }), request);

  assert.equal(observation.outcome, 'incomplete');
  assert.doesNotMatch(JSON.stringify(observation), /private-cancel-reason/);
  assert.equal(parseMetricsRecord(metricsLines).errorCategory, 'aborted');
});

test('runtime deadline bounds a stalled pre-model load with timeout-safe output and metrics', async () => {
  const request = chatRequest('What kind of engineer is Dylan?');
  const prompts: LanguageModelV4CallOptions[] = [];
  const model = toolSequenceModel([], prompts) as MockLanguageModelV4;
  const metricsLines: string[] = [];
  const stalledProjects = new Promise<never>(() => {});
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const observation = await Promise.race([
    observeDMResponse(createDMChatResponse(request, config, {
      db: { async query() { throw new Error('database work must remain unreachable'); } },
      projectLoader: () => stalledProjects,
      model,
      budgets: { deadlineMs: 5, maxOutputTokens: 1_200, maxSteps: 2 },
      metricsLogger: (line) => metricsLines.push(line),
    }), request),
    new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('runtime deadline watchdog expired')), 500);
    }),
  ]).finally(() => {
    if (watchdog) clearTimeout(watchdog);
  });

  assert.equal(observation.outcome, 'error');
  assert.equal(model.doStreamCalls.length, 0);
  assert.equal(prompts.length, 0);
  assert.match(observation.errors.join(' '), /took too long/i);
  assert.doesNotMatch(JSON.stringify(observation), /request deadline exceeded|TimeoutError|database work/i);
  const metrics = parseMetricsRecord(metricsLines);
  assert.equal(metrics.outcome, 'timeout');
  assert.equal(metrics.errorCategory, 'timeout');
});

test('provider failures surface only a sanitized visitor error and content-free metrics', async () => {
  const source = await createTestProjectSource();
  const request = chatRequest('Tell me about projects.');
  const marker = 'PRIVATE_PROVIDER_PAYLOAD';
  const metricsLines: string[] = [];
  const originalConsoleError = console.error;
  console.error = () => {};
  const observation = await (async () => {
    try {
      return await observeDMResponse(createDMChatResponse(request, config, {
        db: emptyDb(),
        projectLoader: source.projectLoader,
        model: new MockLanguageModelV4({ doStream: async () => { throw new Error(marker); } }),
        metricsLogger: (line) => metricsLines.push(line),
      }), request);
    } finally {
      console.error = originalConsoleError;
    }
  })();

  assert.equal(observation.outcome, 'error');
  assert.match(observation.errors.join(' '), /could not answer that safely/i);
  assert.doesNotMatch(JSON.stringify(observation), new RegExp(marker));
  const metrics = parseMetricsRecord(metricsLines);
  assert.equal(metrics.errorCategory, 'provider_failure');
  assert.doesNotMatch(JSON.stringify(metrics), /Tell me about projects|PRIVATE_PROVIDER_PAYLOAD/);
});

test('the endpoint rate-limits before parsing the request or calling the model', async () => {
  const model = toolSequenceModel([{ toolName: 'finalizeAnswer', input: {} }]) as MockLanguageModelV4;
  const db = {
    async query<Row = unknown>(sql: string) {
      return { rows: (sql.includes('RETURNING count') ? [{ count: 2 }] : []) as Row[] };
    },
  };
  const handler = createDMPostHandler({
    config,
    db,
    model,
    clientAddressResolver: () => '203.0.113.8',
    rateLimitConfig: { hmacSecret: 'x'.repeat(32), keyVersion: 'v1', limit: 1, windowSeconds: 60 },
    now: () => 60_000,
  });
  const response = await handler({
    request: new Request('https://portfolio.test/api/dm/chat', { method: 'POST', body: 'not-json' }),
  } as never);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(model.doStreamCalls.length, 0);
});

function chatRequest(
  text: string,
  page: DMPageContext = { kind: 'home', path: '/' },
): DMChatRequest {
  const pageContextId = `${page.kind}:${page.path}:${page.reference ?? ''}`;
  return {
    messages: [{ id: 'user-1', role: 'user', metadata: { pageContextId }, parts: [{ type: 'text', text }] }],
    context: { page },
  };
}

function emptyDb() {
  return {
    async query<Row = unknown>() {
      return { rows: [] as Row[] };
    },
  };
}

function parseMetricsRecord(lines: string[]): DMMetricsRecord {
  assert.equal(lines.length, 1);
  const prefix = '[dm-metrics] ';
  assert.ok(lines[0]?.startsWith(prefix));
  return JSON.parse(lines[0].slice(prefix.length)) as DMMetricsRecord;
}

type MockToolCall = { toolName: string; input: unknown; prose?: string };

function toolSequenceModel(
  calls: MockToolCall[],
  observedPrompts: LanguageModelV4CallOptions[] = [],
): LanguageModel {
  return toolStepModel(calls.map((call) => [call]), observedPrompts);
}

function toolStepModel(
  steps: MockToolCall[][],
  observedPrompts: LanguageModelV4CallOptions[] = [],
): LanguageModel {
  let index = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      observedPrompts.push(options);
      const calls = steps[index++];
      if (!calls) throw new Error('mock model received an unexpected extra step');
      return {
        stream: simulateReadableStream({ chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'response-metadata' as const, id: `response-${index}`, modelId: 'mock-tool-loop', timestamp: new Date(0) },
          ...calls.flatMap((call, callIndex) => {
            const id = `call-${index}-${callIndex + 1}`;
            const textId = `text-${index}-${callIndex + 1}`;
            return [
              ...(call.prose ? [
                { type: 'text-start' as const, id: textId },
                { type: 'text-delta' as const, id: textId, delta: call.prose },
                { type: 'text-end' as const, id: textId },
              ] : []),
              { type: 'tool-call' as const, toolCallId: id, toolName: call.toolName, input: JSON.stringify(call.input) },
            ];
          }),
          {
            type: 'finish' as const,
            finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 8, text: 8, reasoning: undefined },
            },
          },
        ] }),
      };
    },
  });
}
