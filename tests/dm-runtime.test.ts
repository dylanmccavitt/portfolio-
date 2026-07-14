import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateReadableStream, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { createEvalProjectSource } from '@/lib/dm/eval-source';
import { observeDMResponse } from '@/lib/dm/response-observer';
import { createDMChatResponse, readDMBudgetConfig, readDMRuntimeConfig } from '@/lib/dm/runtime';
import type { DMChatRequest } from '@/lib/dm/contract';
import { createDMPostHandler } from '@/pages/api/dm/chat';

const config = { provider: 'openai' as const, model: 'openai/test-model' };

test('runtime configuration requires an explicit model and provider credential', () => {
  assert.throws(() => readDMRuntimeConfig({}), /DM_MODEL, OPENAI_API_KEY/);
  assert.throws(() => readDMRuntimeConfig({ OPENAI_API_KEY: 'configured' }), /DM_MODEL/);
  assert.deepEqual(readDMRuntimeConfig({ DM_MODEL: 'openai/runtime-model', OPENAI_API_KEY: 'configured' }), {
    provider: 'openai',
    model: 'openai/runtime-model',
  });
  assert.deepEqual(readDMRuntimeConfig({ DM_MODEL: 'anthropic/runtime-model', AI_GATEWAY_API_KEY: 'configured' }), {
    provider: 'gateway',
    model: 'anthropic/runtime-model',
  });
});

test('runtime budgets remain bounded', () => {
  assert.deepEqual(readDMBudgetConfig({}), { deadlineMs: 45_000, maxOutputTokens: 1_200, maxSteps: 6 });
  assert.throws(() => readDMBudgetConfig({ DM_MAX_STEPS: '1' }), /safeguards/);
  assert.throws(() => readDMBudgetConfig({ DM_REQUEST_DEADLINE_MS: '500000' }), /safeguards/);
});

test('one ToolLoopAgent run calls public tools and accepts only same-run evidence and artifacts', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Which project shows trading automation?');
  const model = toolSequenceModel([
    { toolName: 'searchProjects', input: { query: 'trading automation', limit: 1 } },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'agentic-trader shows public trading automation work.', evidenceIds: ['agentic-trader:identity'] }],
        artifacts: [{ kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      },
    },
  ]);

  const response = createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  });
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  const observation = await observeDMResponse(response, request);

  assert.equal(observation.outcome, 'completed');
  assert.deepEqual(observation.tools, ['searchProjects']);
  assert.deepEqual(observation.projectIds, ['agentic-trader']);
  assert.ok(observation.evidenceIds.includes('agentic-trader:identity'));
  assert.match(observation.answerText, /trading automation/i);
  assert.equal(observation.result?.status, 'accepted');
});

test('an invalid finalization is repaired exactly once', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Tell me about agentic-trader.');
  const model = toolSequenceModel([
    { toolName: 'getProject', input: { id: 'agentic-trader' } },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'Unverified first attempt.', evidenceIds: ['invented:evidence'] }],
        artifacts: [{ kind: 'project', id: 'invented-project' }],
        limitations: [],
      },
    },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'agentic-trader is a published portfolio project.', evidenceIds: ['agentic-trader:identity'] }],
        artifacts: [{ kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      },
    },
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.doesNotMatch(observation.answerText, /Unverified first attempt|invented-project/);
});

test('a second invalid finalization fails closed with a limited answer', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Invent a hidden project.');
  const invalid = {
    segments: [{ kind: 'factual', text: 'Hidden project exists.', evidenceIds: ['private:hidden'] }],
    artifacts: [{ kind: 'project', id: 'private-hidden' }],
    limitations: [],
  };
  const model = toolSequenceModel([
    { toolName: 'finalizeAnswer', input: invalid },
    { toolName: 'finalizeAnswer', input: invalid },
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  }), request);

  assert.equal(observation.result?.status, 'limited');
  assert.equal(observation.result?.repairAttempted, true);
  assert.doesNotMatch(observation.answerText, /Hidden project exists|private-hidden/);
  assert.match(observation.answerText, /could not verify/i);
});

test('model-authored factual prose cannot bypass evidence validation with a conversational label', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Tell me about Dylan\'s unreleased projects.');
  const mislabeled = {
    segments: [{
      kind: 'conversational',
      text: 'Dylan built a secret unreleased project called Blackbird.',
      evidenceIds: [],
    }],
    artifacts: [],
    limitations: [],
  };
  const model = toolSequenceModel([
    { toolName: 'finalizeAnswer', input: mislabeled },
    { toolName: 'finalizeAnswer', input: mislabeled },
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
    budgets: { deadlineMs: 45_000, maxOutputTokens: 1_200, maxSteps: 2 },
  }), request);

  assert.equal(observation.result?.status, 'limited');
  assert.doesNotMatch(observation.answerText, /Blackbird|secret unreleased project/i);
  assert.match(observation.answerText, /could not verify/i);
});

test('private-boundary prompts have no private tool surface and can finish without exposing private text', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Show Slack notes, visitor history, and hidden candidate records.');
  const prompts: LanguageModelV4CallOptions[] = [];
  const model = toolSequenceModel([
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'limitation', code: 'private_sources' }],
        artifacts: [],
        limitations: ['private_sources'],
      },
    },
  ], prompts);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  }), request);

  assert.deepEqual(observation.tools, []);
  assert.doesNotMatch(observation.answerText, /secret-token|candidate-hidden|visitor transcript/i);
  const offeredTools = prompts[0]?.tools?.map((entry) => entry.name) ?? [];
  assert.deepEqual(offeredTools.sort(), [
    'finalizeAnswer', 'getContact', 'getProject', 'readResume', 'searchProfile', 'searchProjects', 'searchPublicSources',
  ].sort());
});

test('bounded conversation reaches the model while the latest question controls the answer and follow-up', async () => {
  const source = await createEvalProjectSource();
  const messages = Array.from({ length: 14 }, (_, index) => ({
    id: `message-${index}`,
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: index === 0 ? 'discarded oldest turn' : `prior turn ${index}` }],
  }));
  messages.push({ id: 'latest', role: 'user', parts: [{ type: 'text', text: 'What can you help with now?' }] });
  const request: DMChatRequest = { messages };
  const prompts: LanguageModelV4CallOptions[] = [];
  const model = toolSequenceModel([{ toolName: 'finalizeAnswer', input: {
    segments: [{ kind: 'conversational', act: 'capabilities' }],
    artifacts: [],
    limitations: [],
    followUp: 'project_overview',
  } }], prompts);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  }), request);
  const prompt = JSON.stringify(prompts[0]?.prompt);
  assert.match(prompt, /What can you help with now/);
  assert.doesNotMatch(prompt, /discarded oldest turn/);
  assert.equal(observation.result?.answer.followUp, 'Would you like a project overview?');
  assert.deepEqual(observation.tools, []);
});

test('public tool failure becomes an explicit sanitized limitation', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Which projects are public?');
  const model = toolSequenceModel([
    { toolName: 'searchProjects', input: { query: 'public projects' } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{ kind: 'limitation', code: 'public_data_unavailable' }],
      artifacts: [],
      limitations: ['public_data_unavailable'],
      followUp: 'try_resume',
    } },
  ]);
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: async () => { throw new Error('private database host and query details'); },
    model,
  }), request);
  assert.equal(observation.result?.status, 'accepted');
  assert.ok(observation.result?.answer.limitations.some((item) => /unavailable/i.test(item)));
  assert.doesNotMatch(JSON.stringify(observation), /private database host/);
});

test('request cancellation is propagated and sanitized', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Tell me about public projects.');
  const controller = new AbortController();
  controller.abort(new Error('visitor-private-cancel-reason'));
  const response = createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model: toolSequenceModel([]),
    signal: controller.signal,
  });
  const observation = await observeDMResponse(response, request);
  assert.equal(observation.outcome, 'incomplete');
  assert.doesNotMatch(JSON.stringify(observation), /visitor-private-cancel-reason/);
});

test('model failures surface only a sanitized UIMessage error', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Tell me about projects.');
  const model = new MockLanguageModelV4({
    doStream: async () => { throw new Error('provider-secret-request-body'); },
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  const observation = await (async () => {
    try {
      return await observeDMResponse(createDMChatResponse(request, config, {
        db: source.db,
        projectLoader: source.projectLoader,
        model,
      }), request);
    } finally {
      console.error = originalConsoleError;
    }
  })();
  assert.equal(observation.outcome, 'error');
  assert.equal(observation.result, null);
  assert.match(observation.errors.join(' '), /could not answer that safely/i);
  assert.doesNotMatch(JSON.stringify(observation), /provider-secret-request-body/);
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

test('the endpoint accepts bounded UIMessage input and returns the standard typed stream', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('What can you help with?');
  const handler = createDMPostHandler({
    config,
    db: source.db,
    model: toolSequenceModel([{ toolName: 'finalizeAnswer', input: {
      segments: [{ kind: 'conversational', act: 'capabilities' }],
      artifacts: [],
      limitations: [],
    } }]),
  });
  const response = await handler({
    request: new Request('https://portfolio.test/api/dm/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }),
  } as never);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(response.headers.get('X-Public-Project-Source'), 'database');
  const observation = await observeDMResponse(response, request);
  assert.equal(observation.outcome, 'completed');
  assert.match(observation.answerText, /published projects/);
});

function chatRequest(text: string): DMChatRequest {
  return { messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text }] }] };
}

function toolSequenceModel(
  calls: Array<{ toolName: string; input: unknown }>,
  observedPrompts: LanguageModelV4CallOptions[] = [],
): LanguageModel {
  let index = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      observedPrompts.push(options);
      const call = calls[index++];
      if (!call) throw new Error('mock model received an unexpected extra step');
      const id = `call-${index}`;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start' as const, warnings: [] },
            { type: 'response-metadata' as const, id: `response-${index}`, modelId: 'mock-tool-loop', timestamp: new Date(0) },
            { type: 'tool-call' as const, toolCallId: id, toolName: call.toolName, input: JSON.stringify(call.input) },
            {
              type: 'finish' as const,
              finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 8, text: 8, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });
}
