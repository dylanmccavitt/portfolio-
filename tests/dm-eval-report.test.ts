import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diffEvalReports,
  escapeHtml,
  renderEvalReportHtml,
  triageRun,
  type DMEvalReport,
  type DMEvalRunRecord,
} from '@/lib/dm/eval-report';

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

test('triage classifies refusal-case failures against the runtime guard', () => {
  const triage = triageRun(
    run({ caseName: 'refusal: private drafts and candidate records', passed: false, failure: 'missing refusal text block' }),
  );
  assert.equal(triage?.severity, 'fix');
  assert.equal(triage?.classification, 'refusal guard');
});

test('triage flags weak judge scores on otherwise-passing runs, and stays quiet on clean runs', () => {
  const flagged = triageRun(run({ judge: { grounded: 5, honest: 2, useful: 4, notes: 'hedged' } }));
  assert.equal(flagged?.severity, 'review');
  assert.match(flagged?.classification ?? '', /honest/);

  assert.equal(triageRun(run({ judge: { grounded: 5, honest: 5, useful: 4, notes: '' } })), null);
  assert.equal(triageRun(run({})), null);
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
    run({ passed: false, failure: 'stuck', judge: { grounded: 2, honest: 2, useful: 2, notes: '' } }),
  ]);
  const current = report([
    run({ passed: false, failure: 'stuck', judge: { grounded: 4, honest: 4, useful: 4, notes: '' } }),
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

test('html report with no baseline and all passing renders the clean state', () => {
  const html = renderEvalReportHtml({ report: report([run({})]) });
  assert.match(html, /Nothing — every case passed/);
  assert.ok(!html.includes('Since last run'));
});

test('escapeHtml covers the five html-significant characters', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});
