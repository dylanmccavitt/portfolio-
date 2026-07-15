import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateReadableStream, type LanguageModel, type UIMessageChunk } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { validateFinalizationResult } from '@/lib/dm/client';
import { DM_LIVE_EVAL_CORPUS, requestForEvalCase } from '@/lib/dm/eval-corpus';
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
        artifacts: [],
        limitations: [],
      },
    },
    {
      toolName: 'finalizeAnswer',
      input: {
        segments: [{ kind: 'factual', text: 'A hidden project exists.', evidenceIds: ['private:hidden'] }],
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
          artifacts: [],
          limitations: ['public_data_unavailable'],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'no_matching_published_projects' }],
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
          artifacts: [],
          limitations: [],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'limitation', code: 'no_matching_published_projects' }],
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
          artifacts: [],
          limitations: ['public_data_unavailable'],
        } },
        { toolName: 'finalizeAnswer', input: {
          segments: [{ kind: 'conversational', act: 'capabilities' }],
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
      segments: [{
        kind: 'factual',
        text: 'Loom separates planning, bounded implementation, independent review, and verification into explicit delivery phases.',
        evidenceIds: ['citation:loom-architecture'],
      }],
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

  await t.test('search hit followed by direct-project miss keeps the retained project answer', async () => {
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

    assert.equal(observation.result?.status, 'accepted');
    assert.equal(observation.result?.repairAttempted, false);
    assert.deepEqual(observation.projectIds, ['loom']);
    assert.doesNotMatch(observation.answerText, /no matching published project/i);
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
    kind: 'factual',
    text: 'Loom separates planning, bounded implementation, independent review, and verification into explicit delivery phases.',
    evidenceIds: ['citation:loom-architecture'],
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
        { toolName: 'finalizeAnswer', input: { segments: [factualSegment], artifacts, limitations: [] } },
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
          segments: [factualSegment, { kind: 'limitation', code: 'public_source_unavailable' }],
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

test('public tool failure becomes an explicit sanitized limitation', async () => {
  const source = await createEvalProjectSource();
  const request = requestForEvalCase(evalCase('derived-project-tool-unavailable'));
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
  assert.match(observation.answerText, /published project source is unavailable/i);
  assert.deepEqual(observation.result?.answer.limitations, []);
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
  const request = requestForEvalCase(evalCase('derived-public-source-tool-unavailable'));
  const unavailablePublicSourceSearch = createUnavailableEvalPublicSourceSearch();
  let unavailableOverrideCalled = false;
  const model = toolSequenceModel([
    { toolName: 'getProject', input: { id: 'loom' } },
    { toolName: 'searchPublicSources', input: { query: 'Loom public architecture evidence', projectIds: ['loom'] } },
    { toolName: 'finalizeAnswer', input: {
      segments: [{ kind: 'limitation', code: 'public_source_unavailable' }],
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
