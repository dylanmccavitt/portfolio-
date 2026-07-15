import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DM_LIVE_EVAL_CORPUS,
  DM_RELEASE_MODELS,
  DM_RELEASE_RUNS_PER_CASE,
  assertDMReleaseConfiguration,
  evaluateDMEvalObservation,
  requestForEvalCase,
  validateDMLiveEvalCorpus,
  type DMEvalCategory,
} from '@/lib/dm/eval-corpus';

test('live conversational corpus contains every required behavior family and at least 30 cases', () => {
  assert.doesNotThrow(() => validateDMLiveEvalCorpus());
  assert.ok(DM_LIVE_EVAL_CORPUS.length >= 30);
  assert.equal(new Set(DM_LIVE_EVAL_CORPUS.map((item) => item.id)).size, DM_LIVE_EVAL_CORPUS.length);

  const required: DMEvalCategory[] = [
    'factual', 'interpretive', 'comparative', 'personal', 'meta',
    'correction', 'clarification', 'privacy', 'tool-failure', 'multi-turn',
  ];
  const actual = new Set(DM_LIVE_EVAL_CORPUS.flatMap((item) => item.categories));
  for (const category of required) assert.ok(actual.has(category), `missing ${category}`);
});

test('maintainer failures are retained as named release cases', () => {
  const maintainerIds = new Set(
    DM_LIVE_EVAL_CORPUS.filter((item) => item.source === 'maintainer-failure').map((item) => item.id),
  );
  for (const id of [
    'mf-weather-fresh',
    'mf-history-reset-favorite-color',
    'mf-loom-coreference',
    'mf-evalgate-stack-followup',
    'mf-one-project-card',
    'mf-zero-project-cards',
    'mf-trading-automation',
    'mf-recruiter-resume-contact',
    'mf-broad-project-overview',
    'mf-most-impressive-project',
    'mf-ai-workflow',
    'mf-db-only-loom',
    'mf-unmatched-quantum',
    'mf-private-drafts-candidates',
    'mf-slack-admin-visitor',
    'mf-client-software-selection',
    'mf-loom-evidence-deep-dive',
  ]) {
    assert.ok(maintainerIds.has(id), `missing maintainer failure ${id}`);
  }
});

test('release corpus is declarative and contains no canned model output or answer plans', () => {
  const serialized = JSON.stringify(DM_LIVE_EVAL_CORPUS);
  assert.ok(!serialized.includes('modelText'));
  assert.ok(!serialized.includes('answerPlan'));
  for (const item of DM_LIVE_EVAL_CORPUS) {
    assert.ok(Array.isArray(item.history));
    assert.ok(Array.isArray(item.expectations.requiredTools));
    assert.ok(Array.isArray(item.expectations.forbiddenTools));
    assert.ok(Array.isArray(item.expectations.evidence.requiredText));
    assert.ok(Array.isArray(item.expectations.evidence.forbiddenText));
    assert.ok(Array.isArray(item.expectations.artifacts.required));
    assert.ok(Array.isArray(item.expectations.artifacts.forbidden));
    assert.ok(Array.isArray(item.expectations.artifacts.linkProjectIds));
    assert.ok(item.expectations.limitation);
    assert.ok(item.expectations.followUp);
  }
});

test('privacy, honest personal unknown, correction, clarification, and tool failures are explicit', () => {
  const privacy = DM_LIVE_EVAL_CORPUS.filter((item) => item.categories.includes('privacy'));
  assert.ok(privacy.length >= 4);
  assert.ok(privacy.some((item) => /Slack/i.test(item.prompt)));
  assert.ok(privacy.some((item) => /admin/i.test(item.prompt)));
  assert.ok(privacy.some((item) => /private notes/i.test(item.prompt)));
  assert.ok(privacy.some((item) => /other visitors/i.test(item.prompt)));
  for (const item of privacy) {
    assert.ok(item.expectations.forbiddenTools.length >= 4, `${item.id} must forbid every private tool family`);
  }
  assert.ok(DM_LIVE_EVAL_CORPUS.every((item) =>
    !item.expectations.requiredTools.some((tool) => ['searchSlack', 'readAdminDrafts', 'readPrivateNotes', 'readVisitorHistory'].includes(tool)),
  ));
  assert.ok(DM_LIVE_EVAL_CORPUS.some((item) => item.categories.includes('personal') && item.expectations.limitation === 'honest-unknown'));
  assert.ok(DM_LIVE_EVAL_CORPUS.some((item) => item.categories.includes('correction') && item.history.length > 0));
  assert.ok(DM_LIVE_EVAL_CORPUS.some((item) => item.categories.includes('clarification') && item.expectations.followUp === 'required'));
  assert.ok(DM_LIVE_EVAL_CORPUS.filter((item) => item.toolFailure).length >= 2);
});

test('deterministic observation checks enforce tools, evidence, artifacts, and follow-up shape', () => {
  const projectCase = DM_LIVE_EVAL_CORPUS.find((item) => item.id === 'mf-trading-automation')!;
  const passing = {
    answerText: 'agentic-trader is the published project that demonstrates brokerage workflow automation.',
    tools: ['searchProjects'],
    blockKinds: ['projects:agentic-trader'],
    projectIds: ['agentic-trader'],
    outcome: 'completed',
  };
  assert.equal(evaluateDMEvalObservation(projectCase, passing), null);
  assert.match(evaluateDMEvalObservation(projectCase, { ...passing, tools: [] }) ?? '', /required tool/);
  assert.match(evaluateDMEvalObservation(projectCase, { ...passing, projectIds: [], blockKinds: [] }) ?? '', /required artifact/);
  assert.match(evaluateDMEvalObservation(projectCase, { ...passing, answerText: 'A trading project exists.' }) ?? '', /required evidence/);

  const clarification = DM_LIVE_EVAL_CORPUS.find((item) => item.id === 'derived-ambiguous-clarification')!;
  assert.match(evaluateDMEvalObservation(clarification, {
    answerText: 'I need the project name.', tools: [], blockKinds: [], projectIds: [], outcome: 'completed',
  }) ?? '', /clarifying follow-up/);

  const architecture = DM_LIVE_EVAL_CORPUS.find((item) => item.id === 'mf-loom-coreference')!;
  assert.match(evaluateDMEvalObservation(architecture, {
    answerText: 'Loom is a published project.', tools: ['getProject'], blockKinds: [], projectIds: [], outcome: 'completed',
  }) ?? '', /required evidence/);

  const comparisonLink = DM_LIVE_EVAL_CORPUS.find((item) => item.id === 'derived-latest-question-after-comparison')!;
  const bothLinks = {
    answerText: 'Both Loom and agentic-trader have public repository links.',
    tools: ['getProject'],
    blockKinds: ['links:loom', 'links:agentic-trader'],
    projectIds: [],
    outcome: 'completed',
  };
  assert.equal(evaluateDMEvalObservation(comparisonLink, bothLinks), null);
  assert.match(evaluateDMEvalObservation(comparisonLink, {
    ...bothLinks,
    blockKinds: ['links:loom'],
  }) ?? '', /required link artifact.*agentic-trader/);
});

test('multi-turn cases preserve history but send the latest question separately', () => {
  const testCase = DM_LIVE_EVAL_CORPUS.find((item) => item.id === 'derived-correction-subject')!;
  const request = requestForEvalCase(testCase);
  const latestPart = request.messages.at(-1)?.parts[0];
  const priorPart = request.messages.at(-2)?.parts[0];
  assert.equal(latestPart?.type, 'text');
  assert.equal(latestPart?.type === 'text' ? latestPart.text : '', testCase.prompt);
  assert.equal(request.messages.length, testCase.history.length + 1);
  assert.equal(priorPart?.type === 'text' ? priorPart.text.includes('Loom') : false, true);
});

test('latest-turn project-reference cases require direct reads and scoped artifacts', () => {
  const cases = [
    'mf-loom-coreference',
    'mf-evalgate-stack-followup',
    'derived-correction-subject',
    'derived-latest-question-after-comparison',
  ].map((id) => {
    const testCase = DM_LIVE_EVAL_CORPUS.find((item) => item.id === id);
    assert.ok(testCase, `missing ${id}`);
    return testCase;
  });

  for (const testCase of cases) {
    assert.ok(testCase.expectations.requiredTools.includes('getProject'), testCase.id);
    assert.ok(testCase.expectations.forbiddenTools.includes('searchProjects'), testCase.id);
  }

  for (const id of ['mf-loom-coreference', 'mf-evalgate-stack-followup', 'derived-latest-question-after-comparison']) {
    const testCase = cases.find((item) => item.id === id)!;
    assert.ok(testCase.expectations.artifacts.forbidden.includes('projects'), id);
    assert.equal(testCase.expectations.artifacts.maxProjectCards, 0, id);
  }

  const correction = cases.find((item) => item.id === 'derived-correction-subject')!;
  assert.deepEqual(correction.expectations.artifacts.projectIds, ['slurmlet']);
  const comparison = cases.find((item) => item.id === 'derived-latest-question-after-comparison')!;
  assert.deepEqual(comparison.expectations.artifacts.linkProjectIds, ['loom', 'agentic-trader']);
});

test('release command is fixed to Luna and Grok, three runs, live mode, and no stub import', async () => {
  assert.deepEqual(DM_RELEASE_MODELS, ['openai/gpt-5.6-luna', 'xai/grok-4.5']);
  assert.equal(DM_RELEASE_RUNS_PER_CASE, 3);
  assert.doesNotThrow(() => assertDMReleaseConfiguration([...DM_RELEASE_MODELS], 3, true));
  assert.throws(() => assertDMReleaseConfiguration(['openai/gpt-5.6-luna'], 3, true), /requires exactly/);
  assert.throws(() => assertDMReleaseConfiguration([...DM_RELEASE_MODELS], 1, true), /three|3 runs/);
  assert.throws(() => assertDMReleaseConfiguration([...DM_RELEASE_MODELS], 3, false), /requires a configured judge/);

  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const release = packageJson.scripts['dm:eval:release'] ?? '';
  assert.match(release, /--live/);
  assert.match(release, /--release/);
  assert.match(release, /--models openai\/gpt-5\.6-luna,xai\/grok-4\.5/);
  assert.match(release, /--runs 3/);
  assert.match(release, /--judge auto/);

  const runner = await readFile(new URL('../scripts/dm-eval.ts', import.meta.url), 'utf8');
  assert.match(runner, /DM_LIVE_EVAL_CORPUS/);
  assert.ok(!runner.includes('createStubModelFor'));
  assert.ok(!runner.includes('DM_UNIT_EVAL_CASES'));
});
