import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateReadableStream, type LanguageModel, type UIMessageChunk } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { validateFinalizationResult } from '@/lib/dm/client';
import { RESUME } from '@/data/resume';
import {
  DM_LIVE_EVAL_CORPUS,
  evaluateDMEvalObservation,
  requestForEvalCase,
} from '@/lib/dm/eval-corpus';
import { createEvalProjectSource, createUnavailableEvalPublicSourceSearch } from '@/lib/dm/eval-source';
import { observeDMResponse } from '@/lib/dm/response-observer';
import { createDMChatResponse, readDMBudgetConfig, readDMRuntimeConfig } from '@/lib/dm/runtime';
import type { DMChatRequest, DMFinalizationResult, DMUIData } from '@/lib/dm/contract';
import type { DMMetricsRecord } from '@/lib/dm/metrics';
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
        artifactIntent: 'one_project',
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

test('runtime metrics mark the first visible public-tool state before completion', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Which project shows trading automation?');
  const metricsLines: string[] = [];
  const model = toolSequenceModel([
    { toolName: 'searchProjects', input: { query: 'trading automation', limit: 1 } },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'agentic-trader shows public trading automation work.', evidenceIds: ['agentic-trader:identity'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      },
    },
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      return source.projectLoader();
    },
    model,
    metricsLogger: (line) => metricsLines.push(line),
  }), request);
  const metrics = parseMetricsRecord(metricsLines);

  assert.equal(observation.outcome, 'completed');
  assert.equal(metrics.outcome, 'completed');
  assert.equal(metrics.toolCount, 1);
  assert.equal(typeof metrics.firstTokenMs, 'number');
  assert.equal(typeof metrics.completionMs, 'number');
  assert.ok(
    (metrics.completionMs as number) - (metrics.firstTokenMs as number) >= 25,
    `expected visible tool state before completion, got ${metrics.firstTokenMs}ms and ${metrics.completionMs}ms`,
  );
});

test('same-step finalization waits for public evidence and artifacts to settle', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Which project shows trading automation?');
  const model = toolStepModel([[
    { toolName: 'searchProjects', input: { query: 'trading automation', limit: 1 } },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'agentic-trader shows public trading automation work.', evidenceIds: ['agentic-trader:identity'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      },
    },
  ]]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return source.projectLoader();
    },
    model,
  }), request);

  assert.equal(observation.outcome, 'completed');
  assert.equal(observation.result?.status, 'accepted');
  assert.deepEqual(observation.projectIds, ['agentic-trader']);
  assert.ok(observation.evidenceIds.includes('agentic-trader:identity'));
  assert.match(observation.answerText, /trading automation/i);
});

test('the first accepted same-step finalization is immutable', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('What can you help with?');
  const model = toolStepModel([[
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'conversational', act: 'capabilities' }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      },
    },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'A hidden project exists.', evidenceIds: ['private:hidden'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'private-hidden' }],
        limitations: [],
      },
    },
  ]]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  }), request);

  assert.equal(observation.outcome, 'completed');
  assert.equal(observation.result?.status, 'accepted');
  assert.match(observation.answerText, /published projects/i);
  assert.doesNotMatch(observation.answerText, /hidden project|could not verify/i);
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
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'invented-project' }],
        limitations: [],
      },
    },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'agentic-trader is a published portfolio project.', evidenceIds: ['agentic-trader:identity'] }],
        artifactIntent: 'one_project',
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
    artifactIntent: 'one_project',
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

test('schema-invalid finalization input consumes the single repair budget', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('What can you help with?');
  const invalid = {
    segments: [{ kind: 'conversational', act: 'capabilities' }],
    artifacts: [],
    limitations: [],
  };
  const prompts: LanguageModelV4CallOptions[] = [];
  const model = toolSequenceModel([
    { toolName: 'finalizeAnswer', input: invalid },
    { toolName: 'finalizeAnswer', input: invalid },
    { toolName: 'finalizeAnswer', input: invalid },
  ], prompts);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
    budgets: { deadlineMs: 45_000, maxOutputTokens: 1_200, maxSteps: 4 },
  }), request);

  assert.equal(observation.result?.status, 'limited');
  assert.equal(observation.result?.repairAttempted, true);
  assert.equal(prompts.length, 2);
});

test('finalization enforces zero, one, and bounded project artifact cardinality', async (t) => {
  const source = await createEvalProjectSource();

  await t.test('the current request binds intent before model-selected finalization', async () => {
    const cases = [
      { prompt: "Tell me about Dylan's projects, but show only one project card.", intent: 'one_project' },
      { prompt: "Tell me about Dylan's projects without showing any project cards.", intent: 'none' },
      { prompt: 'Tell me about projects and return zero project cards.', intent: 'none' },
      { prompt: 'Tell me about projects and return 0 project cards.', intent: 'none' },
      { prompt: 'What live projects are available?', intent: 'project_set' },
      { prompt: 'List the live projects Dylan can discuss.', intent: 'project_set' },
      { prompt: 'tell me about dylans projects', intent: 'project_set' },
      { prompt: "Tell me about Dylan's most impressive project.", intent: 'one_project' },
      { prompt: 'Which project best shows client software work?', intent: 'one_project' },
      { prompt: "Which of Dylan's projects is most impressive?", intent: 'one_project' },
      { prompt: "Which of Dylan's projects best shows client software work?", intent: 'one_project' },
      { prompt: "Which is best among Dylan's projects?", intent: 'one_project' },
      { prompt: "Show me one of Dylan's projects.", intent: 'one_project' },
      { prompt: "Which one of Dylan's projects uses TypeScript?", intent: 'one_project' },
      { prompt: 'Show me one project that uses TypeScript.', intent: 'one_project' },
      { prompt: "Tell me about a single project from Dylan's portfolio.", intent: 'one_project' },
      { prompt: 'Just one card.', intent: 'one_project' },
      { prompt: "List Dylan's best projects.", intent: 'project_set' },
      { prompt: "What are Dylan's most impressive projects?", intent: 'project_set' },
      { prompt: "Which of Dylan's projects are most impressive?", intent: 'project_set' },
      { prompt: "List Dylan's projects from most impressive to least impressive.", intent: 'project_set' },
      { prompt: 'Show me two project cards.', intent: 'project_set' },
      { prompt: 'Show a few project cards.', intent: 'project_set' },
      { prompt: "Don't show a single project card.", intent: 'none' },
      { prompt: 'Without showing a single project card, tell me about the work.', intent: 'none' },
      { prompt: 'Project cards are not needed.', intent: 'none' },
      { prompt: 'A project card is unnecessary.', intent: 'none' },
      { prompt: "Project cards aren't needed.", intent: 'none' },
      { prompt: "A project card isn't necessary.", intent: 'none' },
      { prompt: 'I want project links only.', intent: 'non_project' },
      { prompt: 'Give me links instead of project cards.', intent: 'non_project' },
      { prompt: 'Give me only the project links.', intent: 'non_project' },
      { prompt: 'Only return the links.', intent: 'non_project' },
      { prompt: "Show one card for one of Dylan's projects.", intent: 'one_project' },
      { prompt: 'Without screenshots, show me a project card.', intent: 'one_project' },
      { prompt: 'Show me a project card without links.', intent: 'one_project' },
      { prompt: 'Only show a project card with links.', intent: 'one_project' },
      { prompt: 'Only show project links on the card.', intent: 'one_project' },
      { prompt: 'Show a project card with GitHub links only.', intent: 'one_project' },
      { prompt: "Give me a one-paragraph overview of Dylan's projects.", intent: 'project_set' },
      { prompt: 'Show project cards one at a time.', intent: 'project_set' },
    ] as const;

    for (const testCase of cases) {
      const request = chatRequest(testCase.prompt);
      const wrongIntent = testCase.intent === 'one_project'
        ? 'project_set'
        : testCase.intent === 'project_set'
          ? 'none'
          : testCase.intent === 'non_project'
            ? 'project_set'
            : 'one_project';
      const wrongArtifacts = wrongIntent === 'none'
        ? []
        : wrongIntent === 'one_project'
          ? [{ kind: 'project', id: 'agentic-trader' }]
          : [{ kind: 'project', id: 'agentic-trader' }, { kind: 'project', id: 'loom' }];
      const correctedArtifacts = testCase.intent === 'none'
        ? []
        : testCase.intent === 'one_project'
          ? [{ kind: 'project', id: 'agentic-trader' }]
          : testCase.intent === 'project_set'
            ? [{ kind: 'project', id: 'agentic-trader' }, { kind: 'project', id: 'loom' }]
            : [{ kind: 'links', id: 'loom' }];
      const model = toolSequenceModel([
        { toolName: 'getProject', input: { id: 'agentic-trader' } },
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{
            kind: 'factual',
            text: 'Published project evidence supports the answer.',
            evidenceIds: ['agentic-trader:identity', 'loom:identity'],
          }],
          artifactIntent: wrongIntent,
          artifacts: wrongArtifacts,
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{
            kind: 'factual',
            text: 'Published project evidence supports the answer.',
            evidenceIds: ['agentic-trader:identity', 'loom:identity'],
          }],
          artifactIntent: testCase.intent,
          artifacts: correctedArtifacts,
          limitations: [],
        } },
      ]);
      const observation = await observeDMResponse(createDMChatResponse(request, config, {
        db: source.db,
        projectLoader: source.projectLoader,
        model,
      }), request);

      assert.equal(observation.result?.status, 'accepted', testCase.prompt);
      assert.equal(observation.result?.repairAttempted, true, testCase.prompt);
      const expectedProjectCards = testCase.intent === 'one_project' ? 1 : testCase.intent === 'project_set' ? 2 : 0;
      assert.equal(observation.projectIds.length, expectedProjectCards, testCase.prompt);
    }
  });

  await t.test('request-bound project intent cannot bypass lookup and required artifacts', async () => {
    for (const testCase of [
      { prompt: 'Return one project card.', intent: 'one_project' },
      { prompt: 'Return a bounded set of projects.', intent: 'project_set' },
    ] as const) {
      const request = chatRequest(testCase.prompt);
      const model = toolSequenceModel([
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'conversational', act: 'acknowledgement' }],
          artifactIntent: testCase.intent,
          artifacts: [],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'conversational', act: 'acknowledgement' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: [],
        } },
      ]);
      const observation = await observeDMResponse(createDMChatResponse(request, config, {
        db: source.db,
        projectLoader: source.projectLoader,
        model,
      }), request);

      assert.equal(observation.result?.status, 'limited', testCase.prompt);
      assert.equal(observation.result?.repairAttempted, true, testCase.prompt);
      assert.deepEqual(observation.projectIds, [], testCase.prompt);
    }
  });

  await t.test('a completed empty project lookup permits an honest zero-artifact answer', async () => {
    const request = chatRequest('Return one project card for missing-project.');
    const model = toolSequenceModel([
      { toolName: 'getProject', input: { id: 'missing-project' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'limitation', code: 'no_matching_published_projects' }],
        artifactIntent: 'one_project',
        artifacts: [],
        limitations: ['no_matching_published_projects'],
      } },
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, false);
    assert.deepEqual(observation.projectIds, []);
  });

  await t.test('zero artifacts preserves grounded prose after one repair', async () => {
    const request = chatRequest('Return grounded project prose without artifact cards.');
    const model = toolSequenceModel([
      { toolName: 'getProject', input: { id: 'agentic-trader' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'A published project is available.', evidenceIds: ['agentic-trader:identity'] }],
        artifactIntent: 'none',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'A published project is available.', evidenceIds: ['agentic-trader:identity'] }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      } },
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.blockKinds, []);
    assert.deepEqual(observation.projectIds, []);
    assert.ok(observation.evidenceIds.includes('agentic-trader:identity'));
  });

  await t.test('one project rejects two distinct cards and accepts one on repair', async () => {
    const request = chatRequest('Return one project card.');
    const model = toolSequenceModel([
      { toolName: 'getProject', input: { id: 'agentic-trader' } },
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published project evidence supports the selection.',
          evidenceIds: ['agentic-trader:identity', 'loom:identity'],
        }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }, { kind: 'project', id: 'loom' }],
        limitations: [],
      } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published project evidence supports the selection.',
          evidenceIds: ['agentic-trader:identity'],
        }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      } },
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.projectIds, ['agentic-trader']);
  });

  await t.test('project set cannot omit all returned matches', async () => {
    const request = chatRequest('Return a bounded project set.');
    const model = toolSequenceModel([
      { toolName: 'getProject', input: { id: 'agentic-trader' } },
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published project evidence supports this overview.',
          evidenceIds: ['agentic-trader:identity', 'loom:identity'],
        }],
        artifactIntent: 'project_set',
        artifacts: [],
        limitations: [],
      } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published project evidence supports this overview.',
          evidenceIds: ['agentic-trader:identity', 'loom:identity'],
        }],
        artifactIntent: 'project_set',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }, { kind: 'project', id: 'loom' }],
        limitations: [],
      } },
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.projectIds, ['agentic-trader', 'loom']);
  });

  await t.test('repair cannot relabel intent to bypass the one-project cap', async () => {
    const request = chatRequest('Return one project card.');
    const overLimitArtifacts = [{ kind: 'project', id: 'agentic-trader' }, { kind: 'project', id: 'loom' }];
    const model = toolSequenceModel([
      { toolName: 'getProject', input: { id: 'agentic-trader' } },
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published project evidence supports the selection.',
          evidenceIds: ['agentic-trader:identity', 'loom:identity'],
        }],
        artifactIntent: 'one_project',
        artifacts: overLimitArtifacts,
        limitations: [],
      } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published project evidence supports the selection.',
          evidenceIds: ['agentic-trader:identity', 'loom:identity'],
        }],
        artifactIntent: 'non_project',
        artifacts: overLimitArtifacts,
        limitations: [],
      } },
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'limited');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.projectIds, []);
  });

  await t.test('non-project intent rejects project cards and accepts a contact artifact on repair', async () => {
    const request = chatRequest('Return a public contact artifact.');
    const model = toolSequenceModel([
      { toolName: 'getProject', input: { id: 'agentic-trader' } },
      { toolName: 'getContact', input: {} },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'A published project is available.', evidenceIds: ['agentic-trader:identity'] }],
        artifactIntent: 'non_project',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Public contact evidence is available.', evidenceIds: ['contact:email'] }],
        artifactIntent: 'non_project',
        artifacts: [{ kind: 'contact', id: 'contact' }],
        limitations: [],
      } },
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.blockKinds, ['contact']);
  });

  await t.test('non-project intent accepts same-run project links without a project card', async () => {
    for (const prompt of [
      'Return published project links without a project card.',
      'Return project links, not cards.',
    ]) {
      const request = chatRequest(prompt);
      const model = toolSequenceModel([
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'A published project is available.', evidenceIds: ['loom:identity'] }],
          artifactIntent: 'project_set',
          artifacts: [{ kind: 'project', id: 'loom' }],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Published project links are available.', evidenceIds: ['loom:identity'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'links', id: 'loom' }],
          limitations: [],
        } },
      ]);
      const observation = await observeDMResponse(createDMChatResponse(request, config, {
        db: source.db,
        projectLoader: source.projectLoader,
        model,
      }), request);

      assert.equal(observation.result?.status, 'accepted', prompt);
      assert.equal(observation.result?.repairAttempted, true, prompt);
      assert.deepEqual(observation.blockKinds, ['links:loom'], prompt);
      assert.deepEqual(observation.projectIds, [], prompt);
    }
  });

  await t.test('duplicate project references normalize to one card', async () => {
    const request = chatRequest('Return one project card.');
    const model = toolSequenceModel([
      { toolName: 'getProject', input: { id: 'agentic-trader' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'A published project is available.', evidenceIds: ['agentic-trader:identity'] }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'agentic-trader' }, { kind: 'project', id: 'agentic-trader' }],
        limitations: [],
      } },
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, false);
    assert.deepEqual(observation.projectIds, ['agentic-trader']);
  });

  await t.test('project sets are capped at four cards', async () => {
    const request = chatRequest('Return a bounded project set.');
    const projectIds = ['agentic-trader', 'exit-manager', 'slurmlet', 'loom', 'evalgate'];
    const model = toolStepModel([
      projectIds.map((id) => ({ toolName: 'getProject', input: { id } })),
      [{ toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published evidence supports this bounded overview.',
          evidenceIds: projectIds.map((id) => `${id}:identity`),
        }],
        artifactIntent: 'project_set',
        artifacts: projectIds.map((id) => ({ kind: 'project', id })),
        limitations: [],
      } }],
      [{ toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'Published evidence supports this bounded overview.',
          evidenceIds: projectIds.slice(0, 4).map((id) => `${id}:identity`),
        }],
        artifactIntent: 'project_set',
        artifacts: projectIds.slice(0, 4).map((id) => ({ kind: 'project', id })),
        limitations: [],
      } }],
    ]);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model,
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.projectIds, projectIds.slice(0, 4));
  });
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
    artifactIntent: 'none',
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
        artifactIntent: 'none',
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
    artifactIntent: 'none',
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

test('empty public project results require the matching bounded limitation and a purposeful optional follow-up', async (t) => {
  const source = await createEvalProjectSource();

  await t.test('mf-unmatched-quantum repairs an unavailable claim into an honest no-match result', async () => {
    const testCase = evalCase('mf-unmatched-quantum');
    const observation = await observeDMResponse(createDMChatResponse(requestForEvalCase(testCase), config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'searchProjects', input: { query: 'quantum cryptography' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'public_data_unavailable' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: ['public_data_unavailable'],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'no_matching_published_projects' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: ['no_matching_published_projects'],
          followUp: 'project_overview',
        } },
      ]),
    }), requestForEvalCase(testCase));

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.projectIds, []);
    assert.deepEqual(observation.evidenceIds, []);
    assert.match(observation.answerText, /no matching published project evidence/i);
    assert.equal(observation.result?.answer.followUp, 'Would you like a project overview?');
  });

  await t.test('mf-empty-in-progress answers the closed filter question without a follow-up', async () => {
    const testCase = evalCase('mf-empty-in-progress');
    const request = requestForEvalCase(testCase);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'searchProjects', input: { query: 'projects', filters: { status: 'in progress' } } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'no_matching_published_project_filters' }],
          artifactIntent: 'project_set',
          artifacts: [],
          limitations: ['no_matching_published_project_filters'],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.deepEqual(observation.projectIds, []);
    assert.deepEqual(observation.evidenceIds, []);
    assert.match(observation.answerText, /no published projects matched the requested filters/i);
    assert.equal(observation.result?.answer.followUp, undefined);
  });

  await t.test('an empty direct project read requires the published-project no-match limitation', async () => {
    const request = chatRequest('Tell me about the hidden-candidate project.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'getProject', input: { id: 'candidate-hidden' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'conversational', act: 'capabilities' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'no_matching_published_projects' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: ['no_matching_published_projects'],
          followUp: 'project_overview',
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.projectIds, []);
    assert.deepEqual(observation.evidenceIds, []);
    assert.match(observation.answerText, /no matching published project evidence/i);
  });

  await t.test('a tool-specific limitation is rejected when no matching tool outcome exists', async () => {
    const request = chatRequest('What can you help with?');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'public_data_unavailable' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: ['public_data_unavailable'],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'conversational', act: 'capabilities' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: [],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.doesNotMatch(observation.answerText, /unavailable|no matching/i);
  });
});

test('concurrent repeated public-source calls retain the latest invoked outcome', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest("Use public source evidence to explain Loom's architecture.");
  const model = toolStepModel([
    [{ toolName: 'getProject', input: { id: 'loom' } }],
    [
      { toolName: 'searchPublicSources', input: { query: 'slow unmatched phrase', projectIds: ['loom'] } },
      { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
    ],
    [{ toolName: 'finalizeAnswer', input: {
      segments: [
        {
          kind: 'factual',
          text: 'The published project slug is Loom.',
          evidenceIds: ['loom:slug'],
          evidenceQuotes: [{ evidenceId: 'loom:slug', quote: 'loom' }],
        },
        {
          kind: 'factual',
          text: 'The approved public source describes delivery phases.',
          evidenceIds: ['citation:loom-architecture'],
          evidenceQuotes: [{ evidenceId: 'citation:loom-architecture', quote: 'delivery phases' }],
        },
      ],
      artifactIntent: 'one_project',
      artifacts: [{ kind: 'project', id: 'loom' }, { kind: 'evidence', id: 'loom-architecture' }],
      limitations: [],
    } }],
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    ragSearch: async (query, ragConfig, options) => {
      if (query === 'slow unmatched phrase') {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { citations: [] };
      }
      return await source.publicSourceSearch(query, ragConfig, options);
    },
    model,
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, false);
  assert.ok(observation.evidenceIds.includes('citation:loom-architecture'));
  assert.doesNotMatch(observation.answerText, /no matching|unavailable/i);
});

test('mixed project-tool outcomes omit irrelevant no-match limitations when a project artifact was retained', async (t) => {
  const source = await createEvalProjectSource();
  const acceptedProjectAnswer = {
    segments: [{
      kind: 'factual',
      text: 'Loom is a published portfolio project.',
      evidenceIds: ['loom:identity'],
    }],
    artifactIntent: 'one_project',
    artifacts: [{ kind: 'project', id: 'loom' }],
    limitations: [],
  };
  const contradictoryRepair = {
    ...acceptedProjectAnswer,
    segments: [
      ...acceptedProjectAnswer.segments,
      { kind: 'limitation', code: 'no_matching_published_projects' },
    ],
    limitations: ['no_matching_published_projects'],
  };

  await t.test('search hit followed by unrelated direct-project miss fails closed for a stable latest reference', async () => {
    const request = chatRequest('Tell me about Loom, not the hidden candidate project.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'searchProjects', input: { query: 'Loom' } },
        { toolName: 'getProject', input: { id: 'candidate-hidden' } },
        { toolName: 'finalizeAnswer', input: acceptedProjectAnswer },
        { toolName: 'finalizeAnswer', input: contradictoryRepair },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'limited');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.projectIds, []);
  });

  await t.test('direct-project hit followed by search miss keeps the retained project answer', async () => {
    const request = chatRequest('Tell me about Loom even if an unrelated search has no match.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'searchProjects', input: { query: 'quantum cryptography' } },
        { toolName: 'finalizeAnswer', input: acceptedProjectAnswer },
        { toolName: 'finalizeAnswer', input: contradictoryRepair },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, false);
    assert.deepEqual(observation.projectIds, ['loom']);
    assert.doesNotMatch(observation.answerText, /no matching published project/i);
  });
});

test('retained public-source evidence suppresses later empty no-match copy but not unavailability', async (t) => {
  const source = await createEvalProjectSource();
  const factualSegment = {
    project: {
      kind: 'factual',
      text: 'The published project slug is Loom.',
      evidenceIds: ['loom:slug'],
      evidenceQuotes: [{ evidenceId: 'loom:slug', quote: 'loom' }],
    },
    source: {
      kind: 'factual',
      text: 'The approved public source describes delivery phases.',
      evidenceIds: ['citation:loom-architecture'],
      evidenceQuotes: [{ evidenceId: 'citation:loom-architecture', quote: 'delivery phases' }],
    },
  };
  const artifacts = [{ kind: 'project', id: 'loom' }, { kind: 'evidence', id: 'loom-architecture' }];

  await t.test('a later empty source search does not contradict retained approved evidence', async () => {
    const request = chatRequest("Use Loom's approved public architecture evidence.");
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      ragSearch: source.publicSourceSearch,
      model: toolSequenceModel([
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
        { toolName: 'searchPublicSources', input: { query: 'quantum cryptography', projectIds: ['loom'] } },
        { toolName: 'finalizeAnswer', input: {
          segments: [factualSegment.project, factualSegment.source],
          artifactIntent: 'one_project',
          artifacts,
          limitations: [],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, false);
    assert.ok(observation.evidenceIds.includes('citation:loom-architecture'));
    assert.doesNotMatch(observation.answerText, /no matching approved public-source evidence/i);
  });

  await t.test('a later unavailable source search remains explicit despite retained approved evidence', async () => {
    const request = chatRequest("Use Loom's approved evidence and report a later source failure honestly.");
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      ragSearch: async (query, ragConfig, options) => {
        if (query === 'unavailable follow-up source') throw new Error('private retrieval failure detail');
        return await source.publicSourceSearch(query, ragConfig, options);
      },
      model: toolSequenceModel([
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
        { toolName: 'searchPublicSources', input: { query: 'unavailable follow-up source', projectIds: ['loom'] } },
        { toolName: 'finalizeAnswer', input: {
          segments: [
            factualSegment.project,
            factualSegment.source,
            { kind: 'limitation', code: 'public_source_unavailable' },
          ],
          artifactIntent: 'one_project',
          artifacts,
          limitations: ['public_source_unavailable'],
          followUp: 'project_overview',
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, false);
    assert.match(observation.answerText, /public-source search is unavailable/i);
    assert.doesNotMatch(JSON.stringify(observation), /private retrieval failure detail/);
  });
});

test('latest-turn project references use direct reads and scoped follow-up artifacts', async (t) => {
  const source = await createEvalProjectSource();
  const scenarios: Array<{ id: string; calls: MockToolCall[] }> = [
    {
      id: 'mf-loom-coreference',
      calls: [
        { toolName: 'getProject', input: { slug: 'loom' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{
            kind: 'factual',
            text: 'Loom uses a reviewed publish path represented by its published database record.',
            evidenceIds: ['loom:identity', 'loom:about:0', 'loom:stack:0'],
          }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: [],
        } },
      ],
    },
    {
      id: 'mf-evalgate-stack-followup',
      calls: [
        { toolName: 'getProject', input: { id: 'evalgate' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{
            kind: 'factual',
            text: 'Evalgate is built with TypeScript.',
            evidenceIds: ['evalgate:identity', 'evalgate:stack:0'],
          }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: [],
        } },
      ],
    },
    {
      id: 'derived-correction-subject',
      calls: [
        { toolName: 'getProject', input: { slug: 'slurmlet' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{
            kind: 'factual',
            text: 'Slurmlet is a developer tool for repeatable, inspectable compute workflows.',
            evidenceIds: ['slurmlet:identity', 'slurmlet:summary'],
          }],
          artifactIntent: 'one_project',
          artifacts: [{ kind: 'project', id: 'slurmlet' }],
          limitations: [],
        } },
      ],
    },
    {
      id: 'derived-latest-question-after-comparison',
      calls: [
        { toolName: 'getProject', input: { slug: 'loom' } },
        { toolName: 'getProject', input: { id: 'agentic-trader' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{
            kind: 'factual',
            text: 'Both Loom and agentic-trader have public repository links.',
            evidenceIds: ['loom:link:0', 'agentic-trader:link:0'],
          }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'links', id: 'loom' }, { kind: 'links', id: 'agentic-trader' }],
          limitations: [],
        } },
      ],
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.id, async () => {
      const testCase = DM_LIVE_EVAL_CORPUS.find((item) => item.id === scenario.id);
      assert.ok(testCase, `missing eval case ${scenario.id}`);
      const request = requestForEvalCase(testCase);
      const observation = await observeDMResponse(createDMChatResponse(request, config, {
        db: source.db,
        projectLoader: source.projectLoader,
        model: toolSequenceModel(scenario.calls),
      }), request);

      assert.equal(evaluateDMEvalObservation(testCase, observation), null);
      assert.deepEqual(observation.tools, ['getProject']);
    });
  }
});

test('the latest-turn control and tool descriptions distinguish direct reads from broad search', async () => {
  const source = await createEvalProjectSource();
  const testCase = DM_LIVE_EVAL_CORPUS.find((item) => item.id === 'mf-loom-coreference');
  assert.ok(testCase);
  const request = requestForEvalCase(testCase);
  const prompts: LanguageModelV4CallOptions[] = [];
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom uses a reviewed publish path.', evidenceIds: ['loom:identity', 'loom:about:0'] }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      } },
    ], prompts),
  }), request);

  assert.equal(observation.outcome, 'completed');
  const prompt = JSON.stringify(prompts[0]?.prompt);
  assert.match(prompt, /latest user message below is the only active request/i);
  assert.match(prompt, /Earlier messages are reference context only/i);
  assert.match(prompt, /only a public project title is known.*searchProjects once/i);
  assert.ok(prompt.lastIndexOf(testCase.prompt) > prompt.lastIndexOf('Latest-turn control'));

  const getProject = prompts[0]?.tools?.find((entry) => entry.name === 'getProject');
  const searchProjects = prompts[0]?.tools?.find((entry) => entry.name === 'searchProjects');
  const getProjectDescription = getProject && 'description' in getProject ? getProject.description ?? '' : '';
  const searchProjectsDescription = searchProjects && 'description' in searchProjects ? searchProjects.description ?? '' : '';
  assert.match(getProjectDescription, /stable public id or slug is known/i);
  assert.match(getProjectDescription, /only a public title is known.*searchProjects first/i);
  assert.match(searchProjectsDescription, /title-only project name.*stable public id or slug is unknown/i);
});

test('stable page-context project references fail closed after search-only evidence and recover with a direct read', async () => {
  const source = await createEvalProjectSource();
  const request: DMChatRequest = {
    ...chatRequest('What about its architecture?'),
    context: { projectIds: ['loom'] },
  };
  const prompts: LanguageModelV4CallOptions[] = [];
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'searchProjects', input: { query: 'Loom', limit: 1 } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom is a published project.', evidenceIds: ['loom:identity'] }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      } },
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom uses a reviewed publish path.', evidenceIds: ['loom:identity', 'loom:about:0'] }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      } },
    ], prompts),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.deepEqual(observation.tools, ['searchProjects', 'getProject']);
  assert.match(JSON.stringify(prompts[0]?.prompt), /stable public project ids already resolved.*getProject directly.*never use searchProjects/i);
  assert.doesNotMatch(observation.answerText, /could not verify/i);
});

test('stable project ids named in the latest turn fail closed after search-only evidence', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Tell me about loom architecture.');
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'searchProjects', input: { query: 'loom', limit: 1 } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom uses a reviewed publish path.', evidenceIds: ['loom:identity'] }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      } },
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom uses a reviewed publish path.', evidenceIds: ['loom:identity', 'loom:about:0'] }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: [],
      } },
    ]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.deepEqual(observation.tools, ['searchProjects', 'getProject']);
});

test('successful direct reads canonicalize disjoint ids and slugs', async (t) => {
  const source = await createEvalProjectSource();
  const template = (await source.projectLoader())[0];
  assert.ok(template);
  const project = {
    ...template,
    id: 'proj42',
    slug: 'wonderful-app',
    title: 'Wonderful App',
    dmArtifact: {
      ...template.dmArtifact,
      id: 'proj42',
      title: 'Wonderful App',
      href: '/projects/wonderful-app',
    },
  };

  for (const [label, input] of [
    ['slug input', { slug: 'wonderful-app' }],
    ['id input', { id: 'proj42' }],
  ] as const) {
    await t.test(label, async () => {
      const request = chatRequest('Tell me about wonderful-app.');
      const observation = await observeDMResponse(createDMChatResponse(request, config, {
        db: source.db,
        projectLoader: async () => [project],
        model: toolSequenceModel([
          { toolName: 'getProject', input },
          { toolName: 'finalizeAnswer', input: {
            segments: [{ kind: 'factual', text: 'Wonderful App is a published project.', evidenceIds: ['proj42:identity'] }],
            artifactIntent: 'none',
            artifacts: [],
            limitations: [],
          } },
        ]),
      }), request);

      assert.equal(observation.result?.status, 'accepted');
      assert.equal(observation.result?.repairAttempted, false);
      assert.deepEqual(observation.tools, ['getProject']);
      assert.deepEqual(observation.projectIds, []);
      assert.ok(observation.evidenceIds.includes('proj42:identity'));
    });
  }
});

test('a title-only project name can use search before later direct coreference', async () => {
  const source = await createEvalProjectSource();
  const template = (await source.projectLoader())[0];
  assert.ok(template);
  const titleOnlyProject = {
    ...template,
    id: 'nhf',
    slug: 'nhf',
    title: 'No Hard Feelings',
    line: 'A low-maintenance public band site.',
    summary: 'A public band site whose title differs from its stable project id.',
    dmArtifact: {
      ...template.dmArtifact,
      id: 'nhf',
      title: 'No Hard Feelings',
      href: '/projects/nhf',
      line: 'A low-maintenance public band site.',
    },
  };
  const request = chatRequest('Tell me about No Hard Feelings.');
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: async () => [titleOnlyProject],
    model: toolSequenceModel([
      { toolName: 'searchProjects', input: { query: 'No Hard Feelings', limit: 1 } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{
          kind: 'factual',
          text: 'No Hard Feelings is a low-maintenance public band site.',
          evidenceIds: ['nhf:identity', 'nhf:summary'],
        }],
        artifactIntent: 'one_project',
        artifacts: [{ kind: 'project', id: 'nhf' }],
        limitations: [],
      } },
    ]),
  }), request);

  assert.equal(observation.outcome, 'completed');
  assert.deepEqual(observation.tools, ['searchProjects']);
  assert.deepEqual(observation.projectIds, ['nhf']);
  assert.ok(observation.evidenceIds.includes('nhf:identity'));
});

test('public tool failure becomes an explicit sanitized limitation', async () => {
  const source = await createEvalProjectSource();
  const request = requestForEvalCase(evalCase('derived-project-tool-unavailable'));
  const model = toolSequenceModel([
    { toolName: 'searchProjects', input: { query: 'public projects' } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{ kind: 'limitation', code: 'public_data_unavailable' }],
      artifactIntent: 'one_project',
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
  assert.match(observation.answerText, /published project source is unavailable/i);
  assert.deepEqual(observation.result?.answer.limitations, []);
  assert.doesNotMatch(JSON.stringify(observation), /private database host/);
});

test('mixed resume and contact composition repairs a dropped same-run source', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Summarize the public education background and recruiter contact details.');
  const prompts: LanguageModelV4CallOptions[] = [];
  const model = toolStepModel([
    [
      { toolName: 'readResume', input: { trackIds: ['stevens'] } },
      { toolName: 'getContact', input: {} },
    ],
    [{ toolName: 'finalizeAnswer', input: {
      segments: [
        {
          kind: 'factual',
          text: 'Stevens Institute of Technology is part of the public education background.',
          evidenceIds: ['resume:stevens:identity'],
          evidenceQuotes: [{ evidenceId: 'resume:stevens:identity', quote: 'Stevens Institute of Technology' }],
        },
      ],
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
  ], prompts);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.deepEqual(observation.tools, ['readResume', 'getContact']);
  assert.deepEqual(observation.blockKinds, ['resume:stevens', 'contact']);
  assert.ok(observation.evidenceIds.includes('resume:stevens:identity'));
  assert.ok(observation.evidenceIds.includes('contact:location'));
  assert.match(observation.answerText, /New York City/);
  assert.equal(
    observation.result?.answer.artifacts.find((artifact) => artifact.kind === 'contact')?.contact.email,
    'dylanmccavitt@outlook.com',
  );
  const prompt = JSON.stringify(prompts[0]?.prompt);
  assert.match(prompt, /readResume and getContact/);
  assert.match(prompt, /getProject and searchPublicSources/);
  const finalizer = prompts[0]?.tools?.find((entry) => entry.name === 'finalizeAnswer');
  assert.match(finalizer && 'description' in finalizer ? finalizer.description ?? '' : '', /evidenceQuotes/);
});

test('explicit resume, contact, and link artifacts cannot be dropped after same-run tools return them', async (t) => {
  const source = await createEvalProjectSource();

  await t.test('resume artifact', async () => {
    const request = chatRequest('Return a public résumé artifact.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'readResume', input: { trackIds: ['stevens'] } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Stevens Institute of Technology is in the public resume.', evidenceIds: ['resume:stevens:identity'] }],
          artifactIntent: 'non_project',
          artifacts: [],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Stevens Institute of Technology is in the public resume.', evidenceIds: ['resume:stevens:identity'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'resume', id: 'stevens' }],
          limitations: [],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.blockKinds, ['resume:stevens']);
  });

  await t.test('contact artifact', async () => {
    const request = chatRequest('Return a public contact artifact.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'getContact', input: {} },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Dylan can be contacted publicly.', evidenceIds: ['contact:email'] }],
          artifactIntent: 'non_project',
          artifacts: [],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Dylan can be contacted publicly.', evidenceIds: ['contact:email'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'contact', id: 'contact' }],
          limitations: [],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.blockKinds, ['contact']);
  });

  await t.test('link artifact', async () => {
    const request = chatRequest('Return the public repository link.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Loom has a public repository link.', evidenceIds: ['loom:link:0'] }],
          artifactIntent: 'non_project',
          artifacts: [],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Loom has a public repository link.', evidenceIds: ['loom:link:0'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'links', id: 'loom' }],
          limitations: [],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.blockKinds, ['links:loom']);
  });

  await t.test('one link artifact is required for each explicitly named project', async () => {
    const request = chatRequest('Return only the public links for Loom and agentic-trader.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'getProject', input: { id: 'agentic-trader' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Loom and agentic-trader have public repository links.', evidenceIds: ['loom:link:0', 'agentic-trader:link:0'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'links', id: 'loom' }],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Loom and agentic-trader have public repository links.', evidenceIds: ['loom:link:0', 'agentic-trader:link:0'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'links', id: 'loom' }, { kind: 'links', id: 'agentic-trader' }],
          limitations: [],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.blockKinds, ['links:loom', 'links:agentic-trader']);
  });

  await t.test('title-only multi-project requests retain link cardinality after search resolution', async () => {
    const sourceProjects = await source.projectLoader();
    const titleOnlyProjects = sourceProjects.slice(0, 2).map((project, index) => {
      const id = index === 0 ? 'loom-stable' : 'trader-stable';
      const title = index === 0 ? 'Loom' : 'Agentic Trader';
      return {
        ...project,
        id,
        slug: id,
        title,
        href: `/projects/${id}`,
        seo: { ...project.seo, title: `${title} · Dylan McCavitt`, ogImage: `/og/projects/${id}.png`, sitemapPath: `/projects/${id}/` },
        dmArtifact: { ...project.dmArtifact, id, title, href: `/projects/${id}` },
      };
    });
    const request = chatRequest('Return only the public links for Loom and Agentic Trader.');
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: async () => titleOnlyProjects,
      model: toolSequenceModel([
        { toolName: 'searchProjects', input: { query: 'Loom Agentic Trader', limit: 2 } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Loom and Agentic Trader have public repository links.', evidenceIds: ['loom-stable:link:0', 'trader-stable:link:0'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'links', id: 'loom-stable' }],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'factual', text: 'Loom and Agentic Trader have public repository links.', evidenceIds: ['loom-stable:link:0', 'trader-stable:link:0'] }],
          artifactIntent: 'non_project',
          artifacts: [{ kind: 'links', id: 'loom-stable' }, { kind: 'links', id: 'trader-stable' }],
          limitations: [],
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, true);
    assert.deepEqual(observation.blockKinds, ['links:loom-stable', 'links:trader-stable']);
  });
});

test('full public resume artifacts fit the bounded finalization envelope', async () => {
  const source = await createEvalProjectSource();
  const resumeIds = RESUME.tracks.map((track) => track.id);
  const request = chatRequest('Return the full public resume artifact.');
  const finalAnswer = {
    segments: [{
      kind: 'factual' as const,
      text: 'The public resume includes the canonical career tracks.',
      evidenceIds: ['resume:syracuse:identity'],
    }],
    artifactIntent: 'non_project' as const,
    limitations: [] as [],
  };
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'readResume', input: {} },
      { toolName: 'finalizeAnswer', input: { ...finalAnswer, artifacts: [] } },
      { toolName: 'finalizeAnswer', input: {
        ...finalAnswer,
        artifacts: resumeIds.map((id) => ({ kind: 'resume' as const, id })),
      } },
    ]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.deepEqual(observation.blockKinds, resumeIds.map((id) => `resume:${id}`));
  assert.equal(observation.result?.answer.artifacts.filter((artifact) => artifact.kind === 'resume').length, resumeIds.length);
});

test('link artifact cardinality follows the latest turn only', async () => {
  const source = await createEvalProjectSource();
  const request: DMChatRequest = {
    ...chatRequest('Return only the public repository link for Loom.'),
    messages: [
      { id: 'turn-1', role: 'user', parts: [{ type: 'text', text: 'Compare Loom and agentic-trader.' }] },
      { id: 'turn-2', role: 'assistant', parts: [{ type: 'text', text: 'Both are published projects.' }] },
      { id: 'turn-3', role: 'user', parts: [{ type: 'text', text: 'Return only the public repository link for Loom.' }] },
    ],
  };
  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model: toolSequenceModel([
      { toolName: 'getProject', input: { id: 'loom' } },
      { toolName: 'getProject', input: { id: 'agentic-trader' } },
      { toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'factual', text: 'Loom has a public repository link.', evidenceIds: ['loom:link:0'] }],
        artifactIntent: 'non_project',
        artifacts: [{ kind: 'links', id: 'loom' }],
        limitations: [],
      } },
    ]),
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, false);
  assert.deepEqual(observation.blockKinds, ['links:loom']);
});

test('the live eval source can produce a same-run approved evidence artifact', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest("Use public source evidence to explain Loom's architecture.");
  const model = toolSequenceModel([
    { toolName: 'getProject', input: { id: 'loom' } },
    { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
    { toolName: 'finalizeAnswer', input: {
      segments: [
        {
          kind: 'factual',
          text: 'The direct project record uses the published slug Loom.',
          evidenceIds: ['loom:slug'],
          evidenceQuotes: [{ evidenceId: 'loom:slug', quote: 'loom' }],
        },
        {
          kind: 'factual',
          text: 'The approved public source describes delivery phases.',
          evidenceIds: ['citation:loom-architecture'],
          evidenceQuotes: [{ evidenceId: 'citation:loom-architecture', quote: 'delivery phases' }],
        },
      ],
      artifactIntent: 'one_project',
      artifacts: [{ kind: 'evidence', id: 'loom-architecture' }],
      limitations: [],
    } },
    { toolName: 'finalizeAnswer', input: {
      segments: [
        {
          kind: 'factual',
          text: 'The direct project record uses the published slug Loom.',
          evidenceIds: ['loom:slug'],
          evidenceQuotes: [{ evidenceId: 'loom:slug', quote: 'loom' }],
        },
        {
          kind: 'factual',
          text: 'Loom separates planning, bounded implementation, independent review, and verification into explicit delivery phases.',
          evidenceIds: ['citation:loom-architecture'],
          evidenceQuotes: [{ evidenceId: 'citation:loom-architecture', quote: 'delivery phases' }],
        },
      ],
      artifactIntent: 'one_project',
      artifacts: [{ kind: 'project', id: 'loom' }, { kind: 'evidence', id: 'loom-architecture' }],
      limitations: [],
    } },
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    ragSearch: source.publicSourceSearch,
    model,
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.deepEqual(observation.tools, ['getProject', 'searchPublicSources']);
  assert.deepEqual(observation.blockKinds, ['projects:loom', 'evidence']);
  assert.deepEqual(observation.projectIds, ['loom']);
  assert.ok(observation.evidenceIds.includes('citation:loom-architecture'));
  assert.equal(
    observation.result?.answer.artifacts.find((artifact) => artifact.kind === 'evidence')?.id,
    'loom-architecture',
  );
  const publicSourceArtifact = observation.result?.answer.artifacts.find((artifact) => artifact.kind === 'evidence');
  const publicSourceEvidence = observation.result?.answer.segments
    .flatMap((segment) => segment.evidence)
    .find((evidence) => evidence.id === 'citation:loom-architecture');
  assert.equal(publicSourceEvidence?.value, publicSourceArtifact?.kind === 'evidence' ? publicSourceArtifact.source.text : undefined);
  assert.doesNotMatch(JSON.stringify(observation), new RegExp(source.privateEvidenceMarkers.join('|')));
});

test('mixed project and public-source composition respects no-card and non-project intent', async (t) => {
  const source = await createEvalProjectSource();
  const scenarios: Array<{
    name: string;
    request: DMChatRequest;
    artifactIntent: 'none' | 'non_project';
    artifacts: Array<{ kind: 'links' | 'evidence'; id: string }>;
  }> = [
    {
      name: 'explicit no-card request',
      request: chatRequest('Use approved public-source evidence to explain Loom, without cards.'),
      artifactIntent: 'none',
      artifacts: [],
    },
    {
      name: 'explicit links-only request',
      request: chatRequest('Use approved public-source evidence to explain Loom. Give me links instead of project cards.'),
      artifactIntent: 'non_project',
      artifacts: [{ kind: 'links', id: 'loom' }, { kind: 'evidence', id: 'loom-architecture' }],
    },
    {
      name: 'latest-turn source aspect follow-up',
      request: {
        messages: [
          { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Tell me about Loom.' }] },
          { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Loom is one of Dylan\'s published projects.' }] },
          { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'What does the approved source say about its architecture?' }] },
        ],
      },
      artifactIntent: 'non_project',
      artifacts: [{ kind: 'evidence', id: 'loom-architecture' }],
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const model = toolSequenceModel([
        { toolName: 'getProject', input: { id: 'loom' } },
        { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
        { toolName: 'finalizeAnswer', input: {
          segments: [
            {
              kind: 'factual',
              text: 'The direct project record uses the published slug Loom.',
              evidenceIds: ['loom:slug'],
              evidenceQuotes: [{ evidenceId: 'loom:slug', quote: 'loom' }],
            },
            {
              kind: 'factual',
              text: 'The approved public source describes delivery phases.',
              evidenceIds: ['citation:loom-architecture'],
              evidenceQuotes: [{ evidenceId: 'citation:loom-architecture', quote: 'delivery phases' }],
            },
          ],
          artifactIntent: scenario.artifactIntent,
          artifacts: scenario.artifacts,
          limitations: [],
        } },
      ]);

      const observation = await observeDMResponse(createDMChatResponse(scenario.request, config, {
        db: source.db,
        projectLoader: source.projectLoader,
        ragSearch: source.publicSourceSearch,
        model,
      }), scenario.request);

      assert.equal(observation.result?.status, 'accepted');
      assert.equal(observation.result?.repairAttempted, false);
      assert.deepEqual(observation.tools, ['getProject', 'searchPublicSources']);
      assert.deepEqual(observation.projectIds, []);
      assert.ok(observation.evidenceIds.includes('loom:slug'));
      assert.ok(observation.evidenceIds.includes('citation:loom-architecture'));
      assert.equal(
        observation.result?.answer.artifacts.some((artifact) => artifact.kind === 'project'),
        false,
      );
      assert.deepEqual(
        observation.result?.answer.artifacts.map((artifact) => artifact.kind),
        scenario.artifacts.map((artifact) => artifact.kind),
      );
    });
  }
});

test('selected evidence stays exact at the source boundary and permits natural prose capitalization', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Give the exact published project identity.');
  const model = toolSequenceModel([
    { toolName: 'getProject', input: { id: 'loom' } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{
        kind: 'factual',
        text: 'The published project slug is Loom.',
        evidenceIds: ['loom:slug'],
        evidenceQuotes: [{ evidenceId: 'loom:slug', quote: 'Loom' }],
      }],
      artifactIntent: 'one_project',
      artifacts: [{ kind: 'project', id: 'loom' }],
      limitations: [],
    } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{
        kind: 'factual',
        text: 'The published project slug is Loom.',
        evidenceIds: ['loom:slug'],
        evidenceQuotes: [{ evidenceId: 'loom:slug', quote: 'loom' }],
      }],
      artifactIntent: 'one_project',
      artifacts: [{ kind: 'project', id: 'loom' }],
      limitations: [],
    } },
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    model,
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(observation.result?.repairAttempted, true);
  assert.match(observation.answerText, /Loom/);
});

test('the live eval unavailable-source override exercises a sanitized no-evidence path', async () => {
  const source = await createEvalProjectSource();
  const request = requestForEvalCase(evalCase('derived-public-source-tool-unavailable'));
  const unavailablePublicSourceSearch = createUnavailableEvalPublicSourceSearch();
  let unavailableOverrideCalled = false;
  const model = toolSequenceModel([
    { toolName: 'getProject', input: { id: 'loom' } },
    { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
    { toolName: 'finalizeAnswer', input: {
      segments: [
        { kind: 'factual', text: 'Loom is the available published project record.', evidenceIds: ['loom:identity'] },
        { kind: 'limitation', code: 'public_source_unavailable' },
      ],
      artifactIntent: 'one_project',
      artifacts: [{ kind: 'project', id: 'loom' }],
      limitations: ['public_source_unavailable'],
      followUp: 'project_overview',
    } },
  ]);

  const observation = await observeDMResponse(createDMChatResponse(request, config, {
    db: source.db,
    projectLoader: source.projectLoader,
    ragSearch: async (...args) => {
      unavailableOverrideCalled = true;
      return await unavailablePublicSourceSearch(...args);
    },
    model,
  }), request);

  assert.equal(observation.result?.status, 'accepted');
  assert.equal(unavailableOverrideCalled, true);
  assert.deepEqual(observation.tools, ['getProject', 'searchPublicSources']);
  assert.deepEqual(observation.blockKinds, ['projects:loom']);
  assert.deepEqual(observation.evidenceIds, ['loom:identity']);
  assert.equal(observation.result?.answer.artifacts.some((artifact) => artifact.kind === 'evidence'), false);
  assert.match(observation.answerText, /public-source search is unavailable/i);
  assert.doesNotMatch(JSON.stringify(observation), /simulated eval public source unavailable/);
});

test('unsupported and personal-unknown controls keep finite public limitations and useful redirects', async (t) => {
  const source = await createEvalProjectSource();

  await t.test('unsupported weather stays outside the public tool surface', async () => {
    const testCase = evalCase('mf-weather-fresh');
    const request = requestForEvalCase(testCase);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([{ toolName: 'finalizeAnswer', input: {
        segments: [{ kind: 'limitation', code: 'unsupported_request' }],
        artifactIntent: 'none',
        artifacts: [],
        limitations: ['unsupported_request'],
        followUp: 'project_overview',
      } }]),
    }), request);

    assert.deepEqual(observation.tools, []);
    assert.deepEqual(observation.projectIds, []);
    assert.equal(observation.result?.answer.followUp, 'Would you like a project overview?');
  });

  await t.test('personal unknown uses the public profile boundary and a contact redirect', async () => {
    const testCase = evalCase('derived-personal-unknown-hobby');
    const request = requestForEvalCase(testCase);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      model: toolSequenceModel([
        { toolName: 'searchProfile', input: { query: 'favorite weekend hobby' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'personal_unknown' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: ['personal_unknown'],
          followUp: 'contact_dylan',
        } },
      ]),
    }), request);

    assert.deepEqual(observation.tools, ['searchProfile']);
    assert.deepEqual(observation.projectIds, []);
    assert.deepEqual(observation.evidenceIds, []);
    assert.equal(observation.result?.answer.followUp, "Would you like Dylan's public contact details?");
  });

  await t.test('profile adapter failure stays within the personal public-source boundary', async () => {
    const testCase = evalCase('derived-personal-unknown-hobby');
    const request = requestForEvalCase(testCase);
    const observation = await observeDMResponse(createDMChatResponse(request, config, {
      db: source.db,
      projectLoader: source.projectLoader,
      profileLoader: async () => { throw new Error('private profile adapter details'); },
      model: toolSequenceModel([
        { toolName: 'searchProfile', input: { query: 'favorite weekend hobby' } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'personal_unknown' }],
          artifactIntent: 'none',
          artifacts: [],
          limitations: ['personal_unknown'],
          followUp: 'contact_dylan',
        } },
      ]),
    }), request);

    assert.equal(observation.result?.status, 'accepted');
    assert.match(observation.answerText, /published public answer to that personal question/i);
    assert.doesNotMatch(observation.answerText, /published project source is unavailable/i);
    assert.doesNotMatch(JSON.stringify(observation), /private profile adapter details|public_data_unavailable/);
  });
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
  const providerErrorMarker = 'F3_PROVIDER_PRIVATE_PAYLOAD_9bce70';
  const model = new MockLanguageModelV4({
    doStream: async () => { throw new Error(providerErrorMarker); },
  });
  const serverLogs: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => { serverLogs.push(args); };
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
  const serializedLogs = serverLogs
    .map((args) => args.map((value) => value instanceof Error ? `${value.name}: ${value.message}` : JSON.stringify(value)).join(' '))
    .join('\n');
  assert.equal(observation.outcome, 'error');
  assert.equal(observation.result, null);
  assert.match(observation.errors.join(' '), /could not answer that safely/i);
  assert.doesNotMatch(JSON.stringify(observation), new RegExp(providerErrorMarker));
  assert.match(serializedLogs, /\[dm\].*stream failure.*Error/);
  assert.doesNotMatch(serializedLogs, new RegExp(providerErrorMarker));
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
      artifactIntent: 'none',
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

test('the endpoint never puts unvalidated model text chunks on the wire', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('What can you help with?');
  const sentinel = 'UNVALIDATED_MODEL_TEXT_SENTINEL';
  const handler = createDMPostHandler({
    config,
    db: source.db,
    model: toolSequenceModel([{ toolName: 'finalizeAnswer', input: {
      segments: [{ kind: 'conversational', act: 'capabilities' }],
      artifactIntent: 'none',
      artifacts: [],
      limitations: [],
    }, prose: sentinel }]),
  });
  const response = await handler({
    request: new Request('https://portfolio.test/api/dm/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }),
  } as never);
  const observation = await observeDMResponse(response.clone(), request);
  const body = await response.text();
  const chunks = observation.timedChunks.map(({ chunk }) => chunk);

  assert.equal(response.status, 200);
  assert.doesNotMatch(body, new RegExp(sentinel));
  assert.match(body, /data-dm-answer/);
  assert.match(body, /published projects/);
  assert.equal(chunks.filter(isFinalizationInputStart).length, 1);
  assert.equal(chunks.some(isFinalizationInputAvailable), false);
  assert.equal(fallbackFinalizationResult(chunks)?.status, 'accepted');
});

test('the endpoint never puts invalid finalization prose on the wire', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('What can you help with?');
  const sentinel = 'UNVALIDATED_MODEL_PROSE_SENTINEL';
  const invalidFinalization = {
    segments: [{ kind: 'factual', text: sentinel, evidenceIds: ['invented:evidence'] }],
    artifactIntent: 'none',
    artifacts: [],
    limitations: [],
  };
  const handler = createDMPostHandler({
    config,
    db: source.db,
    model: streamedToolSequenceModel([
      { toolName: 'finalizeAnswer', input: invalidFinalization },
      { toolName: 'finalizeAnswer', input: invalidFinalization },
    ]),
  });
  const response = await handler({
    request: new Request('https://portfolio.test/api/dm/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }),
  } as never);
  const observation = await observeDMResponse(response.clone(), request);
  const body = await response.text();
  const chunks = observation.timedChunks.map(({ chunk }) => chunk);
  const finalizationToolCallIds = new Set(chunks.filter(isFinalizationInputStart).map((chunk) => chunk.toolCallId));

  assert.equal(response.status, 200);
  assert.doesNotMatch(body, new RegExp(sentinel));
  assert.match(body, /data-dm-answer/);
  assert.equal(finalizationToolCallIds.size, 2);
  assert.equal(chunks.some(isFinalizationInputAvailable), false);
  assert.equal(
    chunks.some((chunk) => chunk.type === 'tool-input-delta' && finalizationToolCallIds.has(chunk.toolCallId)),
    false,
  );
  assert.equal(fallbackFinalizationResult(chunks)?.status, 'limited');
  assert.equal(observation.result?.status, 'limited');
  assert.match(observation.answerText, /could not verify/i);
});

function isFinalizationInputStart(
  chunk: UIMessageChunk<unknown, DMUIData>,
): chunk is Extract<UIMessageChunk<unknown, DMUIData>, { type: 'tool-input-start' }> {
  return chunk.type === 'tool-input-start' && chunk.toolName === 'finalizeAnswer';
}

function isFinalizationInputAvailable(chunk: UIMessageChunk<unknown, DMUIData>): boolean {
  return chunk.type === 'tool-input-available' && chunk.toolName === 'finalizeAnswer';
}

function fallbackFinalizationResult(
  chunks: UIMessageChunk<unknown, DMUIData>[],
): Exclude<DMFinalizationResult, { status: 'rejected' }> | null {
  const toolCalls = new Map<string, string>();
  let finalizationResult: Exclude<DMFinalizationResult, { status: 'rejected' }> | null = null;
  for (const chunk of chunks) {
    if (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') {
      toolCalls.set(chunk.toolCallId, chunk.toolName);
      continue;
    }
    if (chunk.type !== 'tool-output-available' || toolCalls.get(chunk.toolCallId) !== 'finalizeAnswer') continue;
    const result = validateFinalizationResult(chunk.output);
    if (result && result.status !== 'rejected') finalizationResult = result;
  }
  return finalizationResult;
}

function chatRequest(text: string): DMChatRequest {
  return { messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text }] }] };
}

function parseMetricsRecord(lines: string[]): DMMetricsRecord {
  assert.equal(lines.length, 1);
  const prefix = '[dm-metrics] ';
  assert.ok(lines[0].startsWith(prefix));
  return JSON.parse(lines[0].slice(prefix.length)) as DMMetricsRecord;
}

type MockToolCall = { toolName: string; input: unknown; prose?: string };

function evalCase(id: string) {
  const testCase = DM_LIVE_EVAL_CORPUS.find((item) => item.id === id);
  assert.ok(testCase, `missing eval case ${id}`);
  return testCase;
}

function toolSequenceModel(
  calls: MockToolCall[],
  observedPrompts: LanguageModelV4CallOptions[] = [],
): LanguageModel {
  return toolStepModel(calls.map((call) => [call]), observedPrompts);
}

function streamedToolSequenceModel(calls: MockToolCall[]): LanguageModel {
  let index = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const call = calls[index++];
      if (!call) throw new Error('mock model received an unexpected extra step');
      const id = `streamed-call-${index}`;
      const input = JSON.stringify(call.input);
      const splitAt = Math.max(1, Math.floor(input.length / 2));
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start' as const, warnings: [] },
            { type: 'response-metadata' as const, id: `streamed-response-${index}`, modelId: 'mock-streamed-tool-loop', timestamp: new Date(0) },
            { type: 'tool-input-start' as const, id, toolName: call.toolName },
            { type: 'tool-input-delta' as const, id, delta: input.slice(0, splitAt) },
            { type: 'tool-input-delta' as const, id, delta: input.slice(splitAt) },
            { type: 'tool-input-end' as const, id },
            { type: 'tool-call' as const, toolCallId: id, toolName: call.toolName, input },
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
        stream: simulateReadableStream({
          chunks: [
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
          ],
        }),
      };
    },
  });
}
