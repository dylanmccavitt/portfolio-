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
  assert.deepEqual(source.publishedIds, ['agentic-trader', 'evalgate', 'exit-manager', 'loom', 'slurmlet']);
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

test('server-rendered project prose is emitted before its answer-selected artifact blocks', async () => {
  const events = await run('Which project shows trading automation?', answerPlan('agentic-trader'));
  const blockIndex = events.findIndex((event) => event.type === 'block' && event.block.kind === 'projects');
  const textIndex = events.findIndex((event) => event.type === 'text-delta');
  assert.ok(textIndex >= 0 && blockIndex > textIndex);
  assert.match(text(events), /agentic-trader/);
  assert.match(text(events), /reviewable trading automation/);
  assert.match(text(events), /Dry-run status/);
});

test('valid metric and link claims require and accept same-turn structured ids', async () => {
  const events = await run('Give me a deep dive into the agentic-trader project.', answerPlan('agentic-trader', {
    evidenceIds: ['agentic-trader:identity', 'agentic-trader:metric:0', 'agentic-trader:link:0'],
    text: 'agentic-trader has a scheduled review session at 15:45 ET. View repo: https://github.com/DylanMcCavitt/agentic-trader.',
  }));
  assert.match(text(events), /scheduled review session at 15:45 ET/);
  assert.match(text(events), /https:\/\/github\.com\/DylanMcCavitt\/agentic-trader/);
});

test('project alias questions cannot bypass the fact packet or prose validator', async () => {
  const malicious = JSON.stringify({
    claims: [{ text: 'Slurmlet processed 9999 jobs using a secret unpublished backend.', evidenceIds: ['slurmlet:identity'] }],
    artifactProjectIds: ['slurmlet'],
  });
  const events = await run('What is Slurmlet?', malicious);
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.equal(done?.facts?.operation, 'rankProjects');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id), ['slurmlet']);
  assert.ok(!text(events).includes('9999'));
  assert.ok(!text(events).includes('secret unpublished backend'));
});

for (const lowerCaseAliasPrompt of ['what is slurmlet?', 'tell me about loom']) {
  test(`lowercase single-word project aliases reach published alias resolution: ${lowerCaseAliasPrompt}`, async () => {
    const projectId = lowerCaseAliasPrompt.includes('slurmlet') ? 'slurmlet' : 'loom';
    const events = await run(lowerCaseAliasPrompt, answerPlan(projectId));
    const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
    assert.equal(done?.facts?.operation, 'rankProjects');
    assert.deepEqual(done?.facts?.projects.map((project) => project.id), [projectId]);
    assert.match(text(events), new RegExp(projectId, 'i'));
  });
}

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

test('Evalgate follow-up keeps the subject but answers the latest stack question directly', async () => {
  const events = await runRequest({
    message: 'What language is it built with?',
    conversation: [
      { role: 'user', content: 'Tell me about Evalgate.' },
      { role: 'assistant', content: 'Evalgate tests grounded agent behavior before release.' },
    ],
  }, JSON.stringify({
    claims: [{ text: 'Evalgate is built with TypeScript.', evidenceIds: ['evalgate:identity', 'evalgate:stack:0'] }],
    artifactProjectIds: [],
  }));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id), ['evalgate']);
  assert.match(text(events), /TypeScript/);
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
});

test('correct project selection still fails when the answer addresses the wrong latest-turn aspect', async () => {
  const source = await createEvalProjectSource();
  const wrongAspect = model(JSON.stringify({
    claims: [{ text: 'Evalgate is Shipped.', evidenceIds: ['evalgate:identity', 'evalgate:status'] }],
    artifactProjectIds: [],
  }));
  const events = await readNdjsonEvents(createDMChatStream({
    message: 'What language is it built with?',
    conversation: [
      { role: 'user', content: 'Tell me about Evalgate.' },
      { role: 'assistant', content: 'Evalgate tests grounded agent behavior before release.' },
    ],
  }, CONFIG, { db: source.db, projectLoader: source.projectLoader, model: wrongAspect }));
  assert.equal(wrongAspect.doStreamCalls.length, 2, 'invalid directness should retry exactly once');
  assert.match(text(events), /could not produce a validated answer/i);
  assert.doesNotMatch(text(events), /Shipped/);
});

test('identity-only evidence cannot support invented qualitative project prose', async () => {
  const source = await createEvalProjectSource();
  const unsupported = model(JSON.stringify({
    claims: [{ text: 'Loom delivered safer releases for every visitor.', evidenceIds: ['loom:identity'] }],
    artifactProjectIds: [],
  }));
  const events = await readNdjsonEvents(createDMChatStream({
    message: 'Tell me about Loom.',
  }, CONFIG, { db: source.db, projectLoader: source.projectLoader, model: unsupported }));
  assert.equal(unsupported.doStreamCalls.length, 2, 'unsupported prose should retry exactly once');
  assert.match(text(events), /could not produce a validated answer/i);
  assert.doesNotMatch(text(events), /safer releases/);
});

test('identity-only evidence remains valid for a pure project-name response', async () => {
  const events = await run('What is Loom?', JSON.stringify({
    claims: [{ text: 'Loom.', evidenceIds: ['loom:identity'] }],
    artifactProjectIds: [],
  }));
  assert.match(text(events), /Loom\./);
  assert.doesNotMatch(text(events), /could not produce a validated answer/i);
});

test('compound latest-turn questions require evidence for every requested aspect', async () => {
  const source = await createEvalProjectSource();
  const partial = model(JSON.stringify({
    claims: [{ text: 'Evalgate is built with TypeScript.', evidenceIds: ['evalgate:identity', 'evalgate:stack:0'] }],
    artifactProjectIds: [],
  }));
  const events = await readNdjsonEvents(createDMChatStream({
    message: 'What language and repo is it?',
    conversation: [
      { role: 'user', content: 'Tell me about Evalgate.' },
      { role: 'assistant', content: 'Evalgate tests grounded agent behavior before release.' },
    ],
  }, CONFIG, { db: source.db, projectLoader: source.projectLoader, model: partial }));
  assert.equal(partial.doStreamCalls.length, 2, 'a partial compound answer should retry exactly once');
  assert.match(text(events), /could not produce a validated answer/i);
  assert.doesNotMatch(text(events), /built with TypeScript/);

  const complete = model(JSON.stringify({
    claims: [
      { text: 'Evalgate is built with TypeScript.', evidenceIds: ['evalgate:identity', 'evalgate:stack:0'] },
      { text: "Evalgate's project page is available.", evidenceIds: ['evalgate:identity', 'evalgate:href'] },
    ],
    artifactProjectIds: [],
  }));
  const completeEvents = await readNdjsonEvents(createDMChatStream({
    message: 'What language and repo is it?',
    conversation: [
      { role: 'user', content: 'Tell me about Evalgate.' },
      { role: 'assistant', content: 'Evalgate tests grounded agent behavior before release.' },
    ],
  }, CONFIG, { db: source.db, projectLoader: source.projectLoader, model: complete }));
  assert.equal(complete.doStreamCalls.length, 1);
  assert.match(text(completeEvents), /TypeScript/);
  assert.match(text(completeEvents), /project page is available/);
});

test('comparison claims must name every project whose evidence they cite', async () => {
  const source = await createEvalProjectSource();
  const misleading = model(JSON.stringify({
    claims: [{
      text: 'Compared to earlier work, agentic-trader has 3 exit mechanisms.',
      evidenceIds: ['agentic-trader:identity', 'exit-manager:metric:0'],
    }],
    artifactProjectIds: [],
  }));
  const events = await readNdjsonEvents(createDMChatStream({
    message: 'Compare agentic-trader and tastytrade-exit-manager.',
    context: { projectIds: ['agentic-trader', 'exit-manager'] },
  }, CONFIG, { db: source.db, projectLoader: source.projectLoader, model: misleading }));
  assert.equal(misleading.doStreamCalls.length, 2);
  assert.match(text(events), /could not produce a validated answer/i);
  assert.doesNotMatch(text(events), /3 exit mechanisms/);
});

test('validation runs after claim budgeting so truncated claims cannot support artifacts or directness', async () => {
  const source = await createEvalProjectSource();
  const fourthOnly = model(JSON.stringify({
    claims: [
      { text: 'agentic-trader is public.', evidenceIds: ['agentic-trader:identity'] },
      { text: 'tastytrade-exit-manager is public.', evidenceIds: ['exit-manager:identity'] },
      { text: 'slurmlet is public.', evidenceIds: ['slurmlet:identity'] },
      { text: 'Evalgate uses TypeScript.', evidenceIds: ['evalgate:identity', 'evalgate:stack:0'] },
    ],
    artifactProjectIds: ['evalgate'],
  }));
  const events = await readNdjsonEvents(createDMChatStream({
    message: 'Which language does Evalgate use?',
    context: { projectIds: ['agentic-trader', 'exit-manager', 'slurmlet', 'evalgate'] },
  }, CONFIG, { db: source.db, projectLoader: source.projectLoader, model: fourthOnly }));
  assert.equal(fourthOnly.doStreamCalls.length, 2);
  assert.match(text(events), /could not produce a validated answer/i);
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
});

test('plural project follow-ups resolve every referenced project from recent public context', async () => {
  const events = await runRequest({
    message: 'What are their architectures?',
    conversation: [
      { role: 'user', content: 'Tell me about Dylan’s projects.' },
      { role: 'assistant', content: 'Loom and Slurmlet are published projects.' },
    ],
  }, answerPlan('loom'));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.equal(done?.facts?.operation, 'rankProjects');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id).sort(), ['loom', 'slurmlet']);
  assert.match(text(events), /loom/i);
});

test('fresh non-project and project-history reset turns do not retrieve or emit project artifacts', async () => {
  for (const request of [
    { message: 'What is the weather today?' },
    { message: 'What is weather?' },
    {
      message: 'What is your favorite color?',
      conversation: [
        { role: 'user' as const, content: 'Tell me about Dylan’s projects.' },
        { role: 'assistant' as const, content: 'Loom is a published project.' },
      ],
    },
  ]) {
    const source = await createEvalProjectSource();
    const unusedModel = model(answerPlan('loom'));
    const events = await readNdjsonEvents(createDMChatStream(
      request,
      CONFIG,
      { db: source.db, projectLoader: source.projectLoader, model: unusedModel },
    ));
    const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
    assert.equal(done?.facts?.operation, 'none');
    assert.equal(unusedModel.doStreamCalls.length, 0);
    assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
  }
});

test('post-model enforcement limits selected-subset and answers over-selection with grounded prose but zero artifacts', async () => {
  const source = await createEvalProjectSource();
  const overSelectedPlan = JSON.stringify({
    claims: [
      { text: 'agentic-trader is a scheduled, inspectable trading workflow.', evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'] },
      { text: 'tastytrade-exit-manager automates exits without opening positions.', evidenceIds: ['exit-manager:identity', 'exit-manager:summary'] },
      { text: 'slurmlet makes compute jobs easier to inspect.', evidenceIds: ['slurmlet:identity', 'slurmlet:summary'] },
    ],
    artifactProjectIds: ['agentic-trader', 'exit-manager', 'slurmlet'],
  });
  const selected = await readNdjsonEvents(createDMChatStream(
    { message: 'Tell me about Dylan’s projects, but show only one project card.' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: model(overSelectedPlan) },
  ));
  const selectedDone = selected.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  const selectedBlock = selected.find((event) => event.type === 'block' && event.block.kind === 'projects');
  assert.equal(selectedDone?.facts?.projects.length, 3);
  assert.deepEqual(selectedBlock?.type === 'block' && selectedBlock.block.kind === 'projects' ? selectedBlock.block.ids : [], ['agentic-trader']);

  const excluded = await readNdjsonEvents(createDMChatStream(
    { message: 'Tell me about Dylan’s projects without showing any project cards.' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: model(overSelectedPlan) },
  ));
  const excludedDone = excluded.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.deepEqual(
    excludedDone?.facts?.projects.map((project) => project.id).sort(),
    ['agentic-trader', 'exit-manager', 'slurmlet'],
  );
  assert.equal(excluded.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
  assert.deepEqual(
    excluded.filter((event) => event.type === 'block').map((event) => event.block.kind),
    [],
  );
  assert.match(text(excluded), /agentic-trader/i);
  assert.match(text(excluded), /exit-manager/i);
  assert.match(text(excluded), /slurmlet/i);
  assert.doesNotMatch(text(excluded), /could not select a published project/i);

  const misleadingKeyword = await readNdjsonEvents(createDMChatStream(
    {
      message: 'Which of these projects best helps teams hire without showing any project cards?',
      context: { projectIds: ['agentic-trader', 'exit-manager', 'slurmlet'] },
    },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: model(overSelectedPlan) },
  ));
  assert.deepEqual(
    misleadingKeyword.filter((event) => event.type === 'block').map((event) => event.block.kind),
    [],
  );
  assert.match(text(misleadingKeyword), /agentic-trader/i);
  assert.doesNotMatch(text(misleadingKeyword), /could not select a published project/i);

  for (const mixedRequest of [
    {
      message: 'Tell me about Dylan’s projects without showing any project cards, and tell me whether he is available for work.',
      expectedKind: 'contact',
    },
    {
      message: 'Tell me about Dylan’s projects without showing any project cards, and summarize his career.',
      expectedKind: 'resume',
    },
  ] as const) {
    const mixedEvents = await readNdjsonEvents(createDMChatStream(
      {
        message: mixedRequest.message,
        context: { projectIds: ['agentic-trader', 'exit-manager', 'slurmlet'] },
      },
      CONFIG,
      { db: source.db, projectLoader: source.projectLoader, model: model(overSelectedPlan) },
    ));
    assert.equal(mixedEvents.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
    assert.deepEqual(
      mixedEvents.filter((event) => event.type === 'block').map((event) => event.block.kind),
      [mixedRequest.expectedKind],
    );
    assert.match(text(mixedEvents), /agentic-trader/i);
  }
});

test('terse project coreference answers directly without repeating an artifact card', async () => {
  const events = await runRequest({
    message: 'What about its architecture?',
    conversation: [
      { role: 'user', content: 'Tell me about Loom.' },
      { role: 'assistant', content: 'Loom is a published project.' },
    ],
  }, answerPlan('loom', { artifactProjectIds: [] }));
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
  assert.match(text(events), /loom/i);
});

test('artifact count directives do not suppress an independent project coreference', async () => {
  const events = await runRequest({
    message: 'What about its architecture? Show only one project card.',
    conversation: [
      { role: 'user', content: 'Tell me about Loom.' },
      { role: 'assistant', content: 'Loom is a published project.' },
    ],
  }, answerPlan('loom'));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  const block = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id), ['loom']);
  assert.deepEqual(block?.type === 'block' && block.block.kind === 'projects' ? block.block.ids : [], ['loom']);
});

test('a terse coreference that explicitly asks for its card keeps the selected artifact', async () => {
  const events = await runRequest({
    message: 'Show its card.',
    conversation: [
      { role: 'user', content: 'Tell me about Evalgate.' },
      { role: 'assistant', content: 'Evalgate tests grounded agent behavior.' },
    ],
  }, JSON.stringify({
    claims: [{ text: 'Evalgate tests grounded agent behavior.', evidenceIds: ['evalgate:identity', 'evalgate:summary'] }],
    artifactProjectIds: ['evalgate'],
  }));
  const block = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
  assert.deepEqual(block?.type === 'block' && block.block.kind === 'projects' ? block.block.ids : [], ['evalgate']);
});

test('singular coreference resolves the last-mentioned project rather than catalog order', async () => {
  const events = await runRequest({
    message: 'What about it?',
    conversation: [
      { role: 'user', content: 'Compare Loom and Slurmlet.' },
      { role: 'assistant', content: 'Loom is published, while Slurmlet is shipped.' },
    ],
  }, answerPlan('slurmlet', { artifactProjectIds: [] }));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.deepEqual(done?.facts?.projects.map((project) => project.id), ['slurmlet']);
});

test('fit-check retrieval preserves the latest question ahead of a long job description', async () => {
  const events = await runRequest({
    message: 'Which project shows trading automation?',
    context: { fitCheck: { kind: 'job-description', jobDescription: 'quantum cryptography research '.repeat(80) } },
  }, answerPlan('agentic-trader'));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  assert.ok(done?.facts?.projects.some((project) => project.id === 'agentic-trader'));
  assert.match(text(events), /agentic-trader/i);
});

test('representative overviews reject a one-of-three draft after budgeting', async () => {
  const source = await createEvalProjectSource();
  const incompleteModel = model(JSON.stringify({
    claims: [{ text: 'agentic-trader is a scheduled, inspectable trading workflow.', evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'] }],
    artifactProjectIds: ['agentic-trader'],
  }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'tell me about dylans projects' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: incompleteModel },
  ));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  const selectedBlock = events.find(
    (event): event is Extract<DMStreamEvent, { type: 'block' }> => event.type === 'block' && event.block.kind === 'projects',
  );
  const answer = text(events);

  assert.equal(done?.facts?.operation, 'rankProjects');
  assert.equal(done?.facts?.status, 'partial');
  assert.equal(done?.facts?.responseMode, 'representative-overview');
  assert.equal(done?.facts?.projects.length, 3);
  assert.equal(done?.facts?.fallbackUsed, false);
  assert.equal(incompleteModel.doStreamCalls.length, 2, 'incomplete representative coverage should retry exactly once');
  assert.match(answer, /could not produce a validated answer/i);
  assert.equal(selectedBlock, undefined);
  assert.doesNotMatch(answer, /agentic-trader is a scheduled/i);
});

test('ordinary project answers materialize missing blocks from validated claims across retrieval routes', async () => {
  const cases = [
    {
      prompt: 'List the live projects Dylan can discuss.',
      projectId: 'exit-manager',
      claim: {
        text: 'tastytrade-exit-manager is exit-only automation for options positions in Live status.',
        evidenceIds: ['exit-manager:identity', 'exit-manager:tagline', 'exit-manager:status'],
      },
    },
    {
      prompt: "Tell me about Dylan's most impressive project.",
      projectId: 'exit-manager',
      claim: {
        text: 'tastytrade-exit-manager automates scale-out, trailing, and OCO exits without opening positions.',
        evidenceIds: ['exit-manager:identity', 'exit-manager:summary'],
      },
    },
    {
      prompt: 'Show practical AI-assisted workflow evidence.',
      projectId: 'agentic-trader',
      claim: {
        text: 'agentic-trader is a scheduled, inspectable trading workflow.',
        evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'],
      },
    },
    {
      prompt: "Tell me about Dylan's loom project.",
      projectId: 'loom',
      claim: {
        text: 'Loom proves that a reviewed project can become visible without entering the static catalog.',
        evidenceIds: ['loom:identity', 'loom:summary'],
      },
    },
  ];

  for (const testCase of cases) {
    const events = await run(testCase.prompt, JSON.stringify({ claims: [testCase.claim], artifactProjectIds: [] }));
    const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
    assert.deepEqual(
      projectBlock?.type === 'block' && projectBlock.block.kind === 'projects' ? projectBlock.block.ids : [],
      [testCase.projectId],
      testCase.prompt,
    );
    assert.doesNotMatch(text(events), /could not produce a validated answer/i, testCase.prompt);
  }
});

test('representative overview materializes concise prose and blocks for its validated selected facts', async () => {
  const events = await run('tell me about dylans projects', JSON.stringify({
    claims: [
      { text: 'tastytrade-exit-manager automates exits without opening positions.', evidenceIds: ['exit-manager:identity', 'exit-manager:summary'] },
      { text: 'slurmlet makes compute jobs easier to inspect.', evidenceIds: ['slurmlet:identity', 'slurmlet:summary'] },
      { text: 'agentic-trader is a scheduled, inspectable trading workflow.', evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'] },
    ],
    artifactProjectIds: [],
  }));
  const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
  const answer = text(events);

  assert.deepEqual(
    projectBlock?.type === 'block' && projectBlock.block.kind === 'projects' ? projectBlock.block.ids : [],
    ['exit-manager', 'slurmlet', 'agentic-trader'],
  );
  assert.ok(answer.length < 700, `overview should be concise, received ${answer.length} characters`);
  assert.doesNotMatch(answer, /could not produce a validated answer/i);
});

test('representative overview rejects schema-valid prose above its aggregate budget', async () => {
  const source = await createEvalProjectSource();
  const oversized = model(JSON.stringify({
    claims: [
      {
        text: 'tastytrade-exit-manager automates scale-out, trailing, and OCO exits without opening positions. '.repeat(5).trim(),
        evidenceIds: ['exit-manager:identity', 'exit-manager:summary'],
      },
      {
        text: 'slurmlet is a small developer tool that makes compute jobs easier to inspect. '.repeat(5).trim(),
        evidenceIds: ['slurmlet:identity', 'slurmlet:summary'],
      },
      {
        text: 'agentic-trader is a scheduled, inspectable trading workflow. '.repeat(5).trim(),
        evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'],
      },
    ],
    artifactProjectIds: [],
  }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'tell me about dylans projects' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: oversized },
  ));

  assert.equal(oversized.doStreamCalls.length, 2, 'oversized representative prose should retry exactly once');
  assert.match(text(events), /could not produce a validated answer/i);
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
});

test('ordinary project answers replace a mismatched artifact plan with the projects proven by validated claims', async () => {
  const events = await run('Which project shows trading automation?', JSON.stringify({
    claims: [{
      text: 'agentic-trader is a scheduled, inspectable trading workflow.',
      evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'],
    }],
    artifactProjectIds: ['exit-manager'],
  }));
  const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');

  assert.deepEqual(
    projectBlock?.type === 'block' && projectBlock.block.kind === 'projects' ? projectBlock.block.ids : [],
    ['agentic-trader'],
  );
  assert.doesNotMatch(text(events), /could not produce a validated answer/i);
});

test('ordinary named-project answers use the response plan instead of a fixed summary', async () => {
  const source = await createEvalProjectSource();
  const expansiveModel = model(JSON.stringify({
    claims: [{
      text: 'agentic-trader is a scheduled, inspectable trading workflow in Dry-run status, with a scheduled review session at 15:45 ET.',
      evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary', 'agentic-trader:status', 'agentic-trader:metric:0'],
    }],
    artifactProjectIds: ['agentic-trader'],
  }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'Tell me more about agentic-trader.' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: expansiveModel },
  ));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  const answer = text(events);

  assert.equal(done?.facts?.responseMode, 'single-project');
  assert.equal(done?.facts?.projects[0]?.summary, 'A scheduled, inspectable trading workflow.');
  assert.equal(expansiveModel.doStreamCalls.length, 1);
  assert.match(answer, /scheduled, inspectable trading workflow/i);
  assert.match(answer, /Dry-run status/);
  assert.match(answer, /scheduled review session.*15:45 ET/i);
  assert.doesNotMatch(answer, /Each run records its proposal/);
  assert.ok(answer.length < 420, `specific-project answer should be concise, received ${answer.length} characters`);
});

test('explicit project deep dives keep bounded long-form detail', async () => {
  const source = await createEvalProjectSource();
  const deepDiveModel = model(JSON.stringify({
    claims: [{
      text: 'agentic-trader is a scheduled, inspectable trading workflow. Each run records its proposal and gate decision.',
      evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary', 'agentic-trader:about:0'],
    }],
    artifactProjectIds: ['agentic-trader'],
  }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'Give me a deep dive into agentic-trader.' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: deepDiveModel },
  ));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
  const answer = text(events);

  assert.equal(done?.facts?.responseMode, 'deep-dive');
  assert.equal(deepDiveModel.doStreamCalls.length, 1);
  assert.match(answer, /Each run records its proposal/);
  assert.ok(answer.length < 900, `deep-dive answer exceeded its bounded detail budget at ${answer.length} characters`);
});

test('zero-match project searches return no unrelated project cards', async () => {
  const source = await createEvalProjectSource();
  const unusedModel = model(answerPlan('agentic-trader'));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'Which project covers quantum cryptography research?' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: unusedModel },
  ));
  const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');

  assert.equal(done?.facts?.status, 'empty');
  assert.deepEqual(done?.facts?.projects, []);
  assert.equal(unusedModel.doStreamCalls.length, 0);
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
  assert.match(text(events), /did not find a matching published project/i);
});

for (const qualifiedPrompt of [
  'Show me Dylan’s projects that use TypeScript',
  'What are Dylan’s projects built with?',
  'Tell me about Dylan’s projects and how to contact him',
  'Give me an overview of Dylan’s projects and resume',
]) {
  test(`qualified or mixed project intent bypasses the deterministic overview: ${qualifiedPrompt}`, async () => {
    const source = await createEvalProjectSource();
    const responseModel = model(answerPlan('agentic-trader'));
    const events = await readNdjsonEvents(createDMChatStream(
      { message: qualifiedPrompt },
      CONFIG,
      { db: source.db, projectLoader: source.projectLoader, model: responseModel },
    ));
    const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');

    assert.notEqual(done?.facts?.responseMode, 'representative-overview');
    assert.ok(responseModel.doStreamCalls.length <= 1);
    if (/contact/i.test(qualifiedPrompt)) {
      assert.ok(events.some((event) => event.type === 'block' && event.block.kind === 'contact'));
    }
    if (/resume/i.test(qualifiedPrompt)) {
      assert.ok(events.some((event) => event.type === 'block' && event.block.kind === 'resume'));
    }
  });
}

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
  assert.match(text(events), /could not produce a validated answer/i);
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
  assert.ok(events.some((event) => event.type === 'done'));
});

test('wrong status, numeric substrings, private names, and relative links cannot enter rendered prose', async () => {
  for (const modelDraft of [
    JSON.stringify({ claims: [{ text: 'agentic-trader is live.', evidenceIds: ['agentic-trader:identity'] }], artifactProjectIds: [] }),
    JSON.stringify({ claims: [{ text: 'agentic-trader delivered 20 wins.', evidenceIds: ['agentic-trader:identity'] }], artifactProjectIds: [] }),
    JSON.stringify({ claims: [{ text: 'candidate-hidden is stronger than agentic-trader.', evidenceIds: ['agentic-trader:identity'] }], artifactProjectIds: [] }),
    JSON.stringify({ claims: [{ text: 'agentic-trader is documented at /projects/candidate-hidden.', evidenceIds: ['agentic-trader:identity'] }], artifactProjectIds: [] }),
    answerPlan('agentic-trader', { evidenceIds: ['exit-manager:metric:0'] }),
    answerPlan('agentic-trader', { evidenceIds: ['missing-link'] }),
    answerPlan('agentic-trader', { evidenceIds: ['citation:missing-citation'] }),
  ]) {
    const events = await run('Which project shows trading automation?', modelDraft);
    assert.ok(!text(events).includes('candidate-hidden'));
    assert.ok(!text(events).includes('20 wins'));
    assert.ok(!text(events).includes(' is live'));
    assert.match(text(events), /could not produce a validated answer/i);
    assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
    assert.ok(events.some((event) => event.type === 'done'));
  }
});

test('malformed project prose falls back without emitting the malformed draft', async () => {
  const metrics: string[] = [];
  const events = await runRequest(
    { message: 'List the live projects.' },
    'not-json tastytrade-exit-manager 9999',
    (line) => metrics.push(line),
  );
  assert.ok(!text(events).includes('not-json'));
  assert.ok(!text(events).includes('9999'));
  assert.match(text(events), /could not produce a validated answer/i);
  assert.doesNotMatch(text(events), /tastytrade-exit-manager/);
  assert.equal(metrics.length, 1);
  assert.equal(JSON.parse(metrics[0].slice('[dm-metrics] '.length)).fallbackUsed, true);
});

test('empty answer claims retry once and fail honestly over an answerable packet', async () => {
  const source = await createEvalProjectSource();
  const empty = model(JSON.stringify({ claims: [], artifactProjectIds: [] }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'Tell me about Loom.' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: empty },
  ));
  assert.equal(empty.doStreamCalls.length, 2);
  assert.match(text(events), /could not produce a validated answer/i);
});

test('refusal-only non-empty claims retry once and fail honestly over an answerable packet', async () => {
  const source = await createEvalProjectSource();
  const refusal = model(JSON.stringify({
    claims: [{
      text: 'I could not find enough published evidence to answer that question directly.',
      evidenceIds: ['loom:summary'],
    }],
    artifactProjectIds: [],
  }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'Tell me about Loom.' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: refusal },
  ));

  assert.equal(refusal.doStreamCalls.length, 2, 'refusal-only prose should retry exactly once');
  assert.match(text(events), /could not produce a validated answer/i);
  assert.doesNotMatch(text(events), /could not find enough published evidence/i);
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'projects').length, 0);
});

test('grounded limitation prose remains valid when it answers from an answerable packet', async () => {
  const source = await createEvalProjectSource();
  const limitation = model(JSON.stringify({
    claims: [{
      text: 'tastytrade-exit-manager manages exits but cannot open positions.',
      evidenceIds: ['exit-manager:identity', 'exit-manager:summary'],
    }],
    artifactProjectIds: [],
  }));
  const events = await readNdjsonEvents(createDMChatStream(
    { message: 'What does tastytrade-exit-manager do?' },
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: limitation },
  ));

  assert.equal(limitation.doStreamCalls.length, 1);
  assert.match(text(events), /manages exits but cannot open positions/i);
  assert.doesNotMatch(text(events), /could not produce a validated answer/i);
});

test('duplicate natural-language claims render only once', async () => {
  const duplicate = JSON.stringify({
    claims: [
      { text: 'Loom proves reviewed portfolio publishing.', evidenceIds: ['loom:identity', 'loom:summary'] },
      { text: 'Loom proves reviewed portfolio publishing.', evidenceIds: ['loom:identity', 'loom:summary'] },
    ],
    artifactProjectIds: ['loom'],
  });
  const events = await run('Tell me about Loom.', duplicate);
  assert.equal(text(events).match(/Loom proves reviewed portfolio publishing\./g)?.length, 1);
});

async function run(prompt: string, modelText: string): Promise<DMStreamEvent[]> {
  return runRequest({ message: prompt }, modelText);
}

async function runRequest(
  request: DMChatRequest,
  modelText: string,
  metricsLogger?: (line: string) => void,
): Promise<DMStreamEvent[]> {
  const source = await createEvalProjectSource();
  return readNdjsonEvents(createDMChatStream(
    request,
    CONFIG,
    { db: source.db, projectLoader: source.projectLoader, model: model(modelText), metricsLogger },
  ));
}

function answerPlan(projectId: string, references: {
  evidenceIds?: string[];
  text?: string;
  artifactProjectIds?: string[];
} = {}): string {
  const defaults: Record<string, { text: string; evidenceIds: string[] }> = {
    'agentic-trader': {
      text: 'agentic-trader is reviewable trading automation in Dry-run status with activity live 06·23.',
      evidenceIds: ['agentic-trader:identity', 'agentic-trader:tagline', 'agentic-trader:status', 'agentic-trader:activity'],
    },
    'exit-manager': {
      text: 'tastytrade-exit-manager is exit-only automation for options positions in Live status.',
      evidenceIds: ['exit-manager:identity', 'exit-manager:tagline', 'exit-manager:status'],
    },
    slurmlet: {
      text: 'slurmlet is developer tooling for repeatable compute workflows and is Shipped.',
      evidenceIds: ['slurmlet:identity', 'slurmlet:tagline', 'slurmlet:status'],
    },
    loom: {
      text: 'loom proves reviewed portfolio publishing from a Published DB record.',
      evidenceIds: ['loom:identity', 'loom:summary', 'loom:stack:0'],
    },
  };
  const selected = defaults[projectId] ?? { text: `${projectId} is a published project.`, evidenceIds: [`${projectId}:identity`] };
  return JSON.stringify({
    claims: [{
      text: references.text ?? selected.text,
      evidenceIds: references.evidenceIds ?? selected.evidenceIds,
    }],
    artifactProjectIds: references.artifactProjectIds ?? [projectId],
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
