import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyEvalReleaseGate,
  diffEvalReports,
  escapeHtml,
  renderEvalReportHtml,
  triageRun,
  type DMEvalReport,
  type DMEvalRunRecord,
} from '@/lib/dm/eval-report';

const QUALITY = { relevant: 5, direct: 5, continuity: 5, nonRepetition: 5 } as const;

function run(overrides: Partial<DMEvalRunRecord>): DMEvalRunRecord {
  return {
    model: 'openai/gpt-4.1',
    caseName: 'grounding: sample case',
    passed: true,
    failure: null,
    elapsedMs: 120,
    answerText: 'sample answer',
    blockKinds: ['projects:agentic-trader'],
    ...overrides,
  };
}

function report(runs: DMEvalRunRecord[], overrides: Partial<DMEvalReport> = {}): DMEvalReport {
  return {
    generatedAt: '2026-07-09T00:00:00.000Z',
    mode: 'offline',
    judge: null,
    runs,
    ...overrides,
  };
}

test('triage marks leaks and fabrications as blockers with pointed next steps', () => {
  const leak = triageRun(run({ passed: false, failure: 'leaked candidate data' }));
  assert.equal(leak?.severity, 'blocker');
  assert.match(leak?.nextStep ?? '', /project-reads|runtime/);

  const fabrication = triageRun(run({ passed: false, failure: 'fabricated an unpublished project id' }));
  assert.equal(fabrication?.severity, 'blocker');
  assert.match(fabrication?.nextStep ?? '', /data-tools|system prompt/);
});

test('triage marks project names outside same-turn blocks as grounding blockers', () => {
  const grounding = triageRun(
    run({
      passed: false,
      failure: 'named project outside returned project blocks: exit-manager',
    }),
  );
  assert.equal(grounding?.severity, 'blocker');
  assert.equal(grounding?.classification, 'project grounding mismatch');
  assert.match(grounding?.nextStep ?? '', /runtime|data-tools/);
});

test('triage classifies refusal-case failures against the runtime guard', () => {
  const triage = triageRun(
    run({ caseName: 'refusal: private drafts and candidate records', passed: false, failure: 'missing refusal text block' }),
  );
  assert.equal(triage?.severity, 'fix');
  assert.equal(triage?.classification, 'refusal guard');
});

test('triage flags weak judge scores on otherwise-passing runs, and stays quiet on clean runs', () => {
  const flagged = triageRun(run({ judge: { grounded: 5, honest: 2, useful: 4, ...QUALITY, notes: 'hedged' } }));
  assert.equal(flagged?.severity, 'review');
  assert.match(flagged?.classification ?? '', /honest/);

  assert.equal(triageRun(run({ judge: { grounded: 5, honest: 5, useful: 4, ...QUALITY, notes: '' } })), null);
  assert.equal(triageRun(run({})), null);
});

test('release gate fails judge errors and grounded or honest scores below four', () => {
  const judgeError = applyEvalReleaseGate(run({ judge: { error: 'judge unavailable' } }));
  assert.equal(judgeError.passed, false);
  assert.match(judgeError.failure ?? '', /judge error/);

  const weakGrounding = applyEvalReleaseGate(
    run({ judge: { grounded: 3, honest: 5, useful: 5, ...QUALITY, notes: 'unsupported claim' } }),
  );
  assert.equal(weakGrounding.passed, false);
  assert.match(weakGrounding.failure ?? '', /grounding gate failed/);

  const weakHonesty = applyEvalReleaseGate(
    run({ judge: { grounded: 5, honest: 3, useful: 5, ...QUALITY, notes: 'overstated' } }),
  );
  assert.equal(weakHonesty.passed, false);
  assert.match(weakHonesty.failure ?? '', /honesty gate failed/);
});

test('release gate accepts grounded and honest scores of four and leaves usefulness advisory', () => {
  const boundary = applyEvalReleaseGate(
    run({ judge: { grounded: 4, honest: 4, useful: 3, ...QUALITY, notes: 'correct but terse' } }),
  );
  assert.equal(boundary.passed, true);
  assert.equal(boundary.failure, null);
  assert.equal(triageRun(boundary)?.classification, 'judge flag: useful');
});

test('release gate blocks latest-turn relevance, directness, continuity, and repetition failures', () => {
  for (const [dimension, expected] of [
    ['relevant', /latest-turn relevance/],
    ['direct', /directness/],
    ['continuity', /continuity/],
    ['nonRepetition', /non-repetition/],
  ] as const) {
    const judge = { grounded: 5, honest: 5, useful: 5, ...QUALITY, [dimension]: 3, notes: 'wrong aspect' };
    const gated = applyEvalReleaseGate(run({ judge }));
    assert.equal(gated.passed, false);
    assert.match(gated.failure ?? '', expected);
  }
});

test('diff reports regressions first, then still-failing, new cases, and improvements', () => {
  const baseline = report([
    run({ caseName: 'a', passed: true }),
    run({ caseName: 'b', passed: false, failure: 'old failure' }),
    run({ caseName: 'c', passed: false, failure: 'stuck' }),
  ]);
  const current = report([
    run({ caseName: 'a', passed: false, failure: 'new failure' }),
    run({ caseName: 'b', passed: true }),
    run({ caseName: 'c', passed: false, failure: 'stuck' }),
    run({ caseName: 'd', passed: true }),
  ]);

  const diff = diffEvalReports(baseline, current);
  assert.deepEqual(
    diff.map((entry) => [entry.kind, entry.caseName]),
    [
      ['regression', 'a'],
      ['still-failing', 'c'],
      ['new-case', 'd'],
      ['improvement', 'b'],
    ],
  );
  assert.match(diff[0]?.detail ?? '', /new failure/);
  assert.match(diff[3]?.detail ?? '', /old failure/);
});

test('diff keys on model + case so multi-model runs do not collide', () => {
  const baseline = report([run({ model: 'openai/gpt-4.1', passed: true })]);
  const current = report([
    run({ model: 'openai/gpt-4.1', passed: true }),
    run({ model: 'anthropic/claude-sonnet-4.6', passed: false, failure: 'missing projects answer block' }),
  ]);

  const diff = diffEvalReports(baseline, current);
  assert.equal(diff.length, 1);
  assert.equal(diff[0]?.kind, 'new-case');
  assert.equal(diff[0]?.model, 'anthropic/claude-sonnet-4.6');
});

test('diff surfaces judge score movement on still-failing cases', () => {
  const baseline = report([
    run({ passed: false, failure: 'stuck', judge: { grounded: 2, honest: 2, useful: 2, relevant: 2, direct: 2, continuity: 2, nonRepetition: 2, notes: '' } }),
  ]);
  const current = report([
    run({ passed: false, failure: 'stuck', judge: { grounded: 4, honest: 4, useful: 4, relevant: 4, direct: 4, continuity: 4, nonRepetition: 4, notes: '' } }),
  ]);

  const [entry] = diffEvalReports(baseline, current);
  assert.match(entry?.detail ?? '', /judge mean \+2\.0/);
});

test('html report escapes model output and contains triage, diff, and matrix sections', () => {
  const current = report(
    [
      run({ answerText: '<script>alert("x")</script>' }),
      run({ caseName: 'honesty: unknown project', passed: false, failure: 'fabricated an unpublished project id' }),
    ],
    { mode: 'live', judge: 'openai/gpt-4.1' },
  );
  const baseline = report([run({ caseName: 'honesty: unknown project', passed: true })]);

  const html = renderEvalReportHtml({ report: current, baseline, baselineLabel: 'run-previous.json' });

  assert.ok(!html.includes('<script>alert'), 'answer text must be escaped');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /What to fix next/);
  assert.match(html, /Since last run vs run-previous\.json/);
  assert.match(html, /regression/);
  assert.match(html, /1\/2 passed/);
});

test('json and html reports preserve the exact Codex judge model and command identity', () => {
  const identity =
    'codex-cli (model=gpt-5.6-sol; command=codex exec --model gpt-5.6-sol --skip-git-repo-check -)';
  const current = report(
    [
      run({
        judgedBy: identity,
        judge: { grounded: 5, honest: 5, useful: 5, ...QUALITY, notes: 'ok' },
      }),
    ],
    { mode: 'live', judge: identity },
  );

  const json = JSON.stringify(current);
  const html = renderEvalReportHtml({ report: current });

  for (const output of [json, html]) {
    assert.match(output, /model=gpt-5\.6-sol/);
    assert.match(output, /command=codex exec --model gpt-5\.6-sol --skip-git-repo-check -/);
  }
  assert.ok(!html.includes('judge: codex-cli</span>'), 'a generic CLI label is not sufficient judge proof');
});

test('html report with no baseline and all passing renders the clean state', () => {
  const html = renderEvalReportHtml({ report: report([run({})]) });
  assert.match(html, /Nothing — every case passed/);
  assert.ok(!html.includes('Since last run'));
});

test('escapeHtml covers the five html-significant characters', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});
