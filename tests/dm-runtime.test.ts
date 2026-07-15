import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateReadableStream, type LanguageModel, type UIMessageChunk } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { validateFinalizationResult } from '@/lib/dm/client';
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
      { prompt: "List Dylan's best projects.", intent: 'project_set' },
      { prompt: "What are Dylan's most impressive projects?", intent: 'project_set' },
      { prompt: "Which of Dylan's projects are most impressive?", intent: 'project_set' },
      { prompt: "List Dylan's projects from most impressive to least impressive.", intent: 'project_set' },
      { prompt: "Show one card for one of Dylan's projects.", intent: 'one_project' },
      { prompt: 'Without screenshots, show me a project card.', intent: 'one_project' },
      { prompt: 'Show me a project card without links.', intent: 'one_project' },
    ] as const;

    for (const testCase of cases) {
      const request = chatRequest(testCase.prompt);
      const wrongIntent = testCase.intent === 'one_project'
        ? 'project_set'
        : testCase.intent === 'project_set'
          ? 'none'
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
          : [{ kind: 'project', id: 'agentic-trader' }, { kind: 'project', id: 'loom' }];
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
      assert.equal(observation.projectIds.length, correctedArtifacts.length, testCase.prompt);
    }
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
      assert.deepEqual(observation.blockKinds, ['links'], prompt);
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

test('public tool failure becomes an explicit sanitized limitation', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Which projects are public?');
  const model = toolSequenceModel([
    { toolName: 'searchProjects', input: { query: 'public projects' } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{ kind: 'limitation', code: 'public_data_unavailable' }],
      artifactIntent: 'none',
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

test('the live eval source can produce a same-run approved evidence artifact', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest("Use public source evidence to explain Loom's architecture.");
  const model = toolSequenceModel([
    { toolName: 'getProject', input: { id: 'loom' } },
    { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{
        kind: 'factual',
        text: 'Loom separates planning, bounded implementation, independent review, and verification into explicit delivery phases.',
        evidenceIds: ['citation:loom-architecture'],
      }],
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
  assert.deepEqual(observation.tools, ['getProject', 'searchPublicSources']);
  assert.deepEqual(observation.blockKinds, ['projects:loom', 'evidence']);
  assert.deepEqual(observation.projectIds, ['loom']);
  assert.ok(observation.evidenceIds.includes('citation:loom-architecture'));
  assert.equal(
    observation.result?.answer.artifacts.find((artifact) => artifact.kind === 'evidence')?.id,
    'loom-architecture',
  );
  assert.doesNotMatch(JSON.stringify(observation), new RegExp(source.privateEvidenceMarkers.join('|')));
});

test('the live eval unavailable-source override exercises a sanitized no-evidence path', async () => {
  const source = await createEvalProjectSource();
  const request = chatRequest('Use public source evidence to explain the architecture of Loom.');
  const unavailablePublicSourceSearch = createUnavailableEvalPublicSourceSearch();
  let unavailableOverrideCalled = false;
  const model = toolSequenceModel([
    { toolName: 'getProject', input: { id: 'loom' } },
    { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{ kind: 'limitation', code: 'public_source_unavailable' }],
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
  assert.deepEqual(observation.evidenceIds, []);
  assert.match(observation.answerText, /public-source search is unavailable/i);
  assert.doesNotMatch(JSON.stringify(observation), /simulated eval public source unavailable/);
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
