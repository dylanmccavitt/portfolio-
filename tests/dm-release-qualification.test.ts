import assert from 'node:assert/strict';
import test from 'node:test';
import { DM_LIVE_EVAL_CORPUS, DM_RELEASE_MODELS } from '@/lib/dm/eval-corpus';
import type { DMEvalJudgeScore, DMEvalReport, DMEvalRunRecord } from '@/lib/dm/eval-report';
import {
  assertDMReleaseInvocation,
  computeDMReleaseCandidateDigest,
  readBoundedProviderCost,
  selectDMReleaseWinner,
  validateDMReleaseReport,
  validateDMReleaseSelectionEvidence,
  type DMReleaseSelectionEvidence,
} from '@/lib/dm/release-qualification';

test('release selection evidence requires replaying an exact captured report', () => {
  assert.throws(
    () => assertDMReleaseInvocation({
      release: true,
      captureRelease: false,
      selectionEvidencePath: 'selection.json',
    }),
    /--selection-evidence requires --release-report/,
  );
  assert.doesNotThrow(() => assertDMReleaseInvocation({
    release: true,
    captureRelease: false,
    selectionEvidencePath: 'selection.json',
    releaseReportPath: 'captured.json',
  }));
  assert.doesNotThrow(() => assertDMReleaseInvocation({
    release: true,
    captureRelease: true,
  }));
});

test('provider cost lookup retries unresolved generation ids and sums same-run costs', async () => {
  const calls = new Map<string, number>();
  const waits: number[] = [];
  const cost = await readBoundedProviderCost(
    ['generation-a', 'generation-b'],
    async (generationId) => {
      calls.set(generationId, (calls.get(generationId) ?? 0) + 1);
      if (generationId === 'generation-b' && calls.get(generationId) === 1) throw new Error('not ready');
      return { totalCost: generationId === 'generation-a' ? 0.02 : 0.03 };
    },
    {
      retryDelaysMs: [5, 15],
      wait: async (delayMs) => { waits.push(delayMs); },
    },
  );

  assert.equal(cost, 0.05);
  assert.deepEqual(Object.fromEntries(calls), { 'generation-a': 1, 'generation-b': 2 });
  assert.deepEqual(waits, [5]);
});

test('provider cost lookup exhausts its finite retry budget and fails closed', async () => {
  let calls = 0;
  const waits: number[] = [];
  const cost = await readBoundedProviderCost(
    ['generation-a'],
    async () => {
      calls += 1;
      return { totalCost: calls === 1 ? undefined : Number.NaN };
    },
    {
      retryDelaysMs: [5, 15],
      wait: async (delayMs) => { waits.push(delayMs); },
    },
  );

  assert.equal(cost, null);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5, 15]);
});

test('aggregate release qualification selects a fully qualifying winner without a provider call', () => {
  const report = releaseReport((model) => model === DM_RELEASE_MODELS[0] ? 5 : 4);
  const decision = selectDMReleaseWinner(report, selectionEvidence(report));

  assert.equal(decision.status, 'winner');
  assert.equal(decision.winnerModel, DM_RELEASE_MODELS[0]);
  assert.equal(decision.aggregates.length, 2);
  for (const aggregate of decision.aggregates) {
    assert.equal(aggregate.qualified, true, aggregate.disqualifications.join('; '));
    assert.equal(aggregate.passRate, 1);
    assert.equal(aggregate.stableMaintainerCases, aggregate.maintainerCases);
    assert.equal(aggregate.blindedPreference.wins, 8);
    assert.equal(aggregate.followUps.rate, 1);
    assert.equal(aggregate.privacyFailures, 0);
    assert.equal(aggregate.groundingFailures, 0);
    assert.equal(aggregate.fabricationFailures, 0);
  }
});

test('release qualification returns no winner when a required cost tie-break is unavailable', () => {
  const report = releaseReport(() => 5);
  const decision = selectDMReleaseWinner(report, selectionEvidence(report));
  assert.equal(decision.status, 'no-winner');
  assert.equal(decision.winnerModel, null);
  assert.match(decision.reason, /cost evidence was unavailable/);
});

test('release qualification uses provider-supplied cost only as the final required tie-break', () => {
  const report = releaseReport(() => 5);
  for (const run of report.runs) run.costUsd = run.model === DM_RELEASE_MODELS[0] ? 0.02 : 0.01;
  const decision = selectDMReleaseWinner(report, selectionEvidence(report));
  assert.equal(decision.status, 'winner');
  assert.equal(decision.winnerModel, DM_RELEASE_MODELS[1]);
  assert.match(decision.reason, /cost tie-break/);
});

test('release qualification enforces eight of ten blinded baseline preferences', () => {
  const report = releaseReport((model) => model === DM_RELEASE_MODELS[0] ? 5 : 4);
  const evidence = selectionEvidence(report);
  const comparison = evidence.comparisons.find((item) => item.model === DM_RELEASE_MODELS[0] && item.preferred === 'candidate');
  assert.ok(comparison);
  comparison.preferred = 'baseline';
  const decision = selectDMReleaseWinner(report, evidence);
  const aggregate = decision.aggregates.find((item) => item.model === DM_RELEASE_MODELS[0]);
  assert.equal(aggregate?.qualified, false);
  assert.match(aggregate?.disqualifications.join('\n') ?? '', /7\/10 is below 8\/10/);
});

test('release qualification fails closed on missing critical, follow-up, and blinded evidence', () => {
  const report = releaseReport(() => 5);
  const critical = report.runs.find((run) => run.critical)!;
  critical.critical = undefined;
  const followUp = report.runs.find((run) => run.followUpApplicable)!;
  const judge = followUp.judge as DMEvalJudgeScore;
  judge.followUpUseful = null;

  const decision = selectDMReleaseWinner(report, null);
  assert.equal(decision.status, 'no-winner');
  for (const aggregate of decision.aggregates) {
    assert.equal(aggregate.qualified, false);
    assert.match(aggregate.disqualifications.join('\n'), /critical-case metadata|blinded-comparison evidence/);
  }
  assert.match(decision.aggregates.find((item) => item.model === followUp.model)?.disqualifications.join('\n') ?? '', /follow-up usefulness evidence/);
});

test('release qualification rejects a missing question-comprehension score on a non-critical run', () => {
  const report = releaseReport((model) => model === DM_RELEASE_MODELS[0] ? 5 : 4);
  const run = report.runs.find((item) => item.model === DM_RELEASE_MODELS[0] && item.critical === false);
  assert.ok(run?.judge && !('error' in run.judge));
  delete (run.judge as Partial<DMEvalJudgeScore>).questionComprehension;

  const decision = selectDMReleaseWinner(report, selectionEvidence(report));
  const aggregate = decision.aggregates.find((item) => item.model === DM_RELEASE_MODELS[0]);
  assert.equal(aggregate?.qualified, false);
  assert.match(aggregate?.disqualifications.join('\n') ?? '', /missing complete judge scores/);
});

test('sanitized baseline contract requires exactly ten opaque comparisons per model', () => {
  const report = releaseReport(() => 5);
  const valid = selectionEvidence(report);
  assert.deepEqual(validateDMReleaseSelectionEvidence(valid), valid);
  assert.throws(
    () => validateDMReleaseSelectionEvidence({ ...valid, comparisons: valid.comparisons.slice(1) }),
    /exactly 10/,
  );
  assert.throws(
    () => validateDMReleaseSelectionEvidence({ ...valid, baseline: { ...valid.baseline, jsonSha256: 'not-a-hash' } }),
    /SHA-256/,
  );
  assert.throws(
    () => validateDMReleaseSelectionEvidence({
      ...valid,
      baseline: { jsonSha256: valid.baseline.jsonSha256, htmlSha256: valid.baseline.htmlSha256 },
    }),
    /opaque baseline id/,
  );
  assert.throws(
    () => validateDMReleaseSelectionEvidence({
      ...valid,
      comparisons: valid.comparisons.map((comparison, index) => index === 0
        ? { ...comparison, id: null }
        : comparison),
    }),
    /unique valid comparisons/,
  );
  assert.throws(
    () => validateDMReleaseSelectionEvidence({ ...valid, visitorPrompt: 'private prompt' }),
    /forbidden or unknown fields/,
  );
  assert.throws(
    () => validateDMReleaseSelectionEvidence({
      ...valid,
      baseline: { ...valid.baseline, history: ['private history'] },
    }),
    /forbidden or unknown fields/,
  );
  assert.throws(
    () => validateDMReleaseSelectionEvidence({
      ...valid,
      comparisons: valid.comparisons.map((comparison, index) => index === 0
        ? { ...comparison, rawAnswer: 'private answer', fullToolResult: { secret: true } }
        : comparison),
    }),
    /forbidden or unknown fields/,
  );
});

test('blinded comparisons are bound to the exact sanitized candidate-run digest', () => {
  const report = releaseReport((model) => model === DM_RELEASE_MODELS[0] ? 5 : 4);
  const evidence = selectionEvidence(report);
  report.runs.find((run) => run.model === DM_RELEASE_MODELS[0])!.answerText = 'different answer';
  const decision = selectDMReleaseWinner(report, evidence);
  const aggregate = decision.aggregates.find((item) => item.model === DM_RELEASE_MODELS[0]);
  assert.equal(aggregate?.qualified, false);
  assert.match(aggregate?.disqualifications.join('\n') ?? '', /not bound to the exact/);
});

test('captured release report validation rejects raw or unknown fields before replay', () => {
  const report = releaseReport(() => 5);
  assert.deepEqual(validateDMReleaseReport(report), report);
  assert.throws(
    () => validateDMReleaseReport({ ...report, visitorPrompt: 'private prompt' }),
    /forbidden or unknown fields/,
  );
  assert.throws(
    () => validateDMReleaseReport({
      ...report,
      runs: report.runs.map((run, index) => index === 0
        ? { ...run, history: ['private history'], fullToolResult: { secret: true } }
        : run),
    }),
    /forbidden or unknown fields/,
  );
  assert.throws(
    () => validateDMReleaseReport({
      ...report,
      runs: report.runs.map((run, index) => index === 0 && run.judge && !('error' in run.judge)
        ? { ...run, judge: { ...run.judge, rawAnswer: 'private answer' } }
        : run),
    }),
    /forbidden or unknown fields/,
  );
});

test('captured release report rejects truthy non-boolean pass evidence', () => {
  const report = releaseReport(() => 5);
  const malformed = structuredClone(report) as unknown as { runs: Array<Record<string, unknown>> };
  malformed.runs[0]!.passed = 'false';
  malformed.runs[0]!.failure = 'deterministic gate failed';

  assert.throws(
    () => validateDMReleaseReport(malformed),
    /boolean passed value consistent with failure/,
  );

  const decision = selectDMReleaseWinner(malformed as unknown as DMEvalReport, selectionEvidence(report));
  assert.equal(decision.status, 'no-winner');
  assert.match(decision.aggregates[0]?.disqualifications.join('\n') ?? '', /invalid or inconsistent pass\/failure evidence/);
});

test('captured release report rejects rows outside the exact two-model matrix', () => {
  const report = releaseReport(() => 5);
  const withUnexpectedModel = structuredClone(report);
  withUnexpectedModel.runs.push({ ...structuredClone(report.runs[0]!), model: 'unexpected/model' });

  assert.throws(
    () => validateDMReleaseReport(withUnexpectedModel),
    /exact .*run Luna\/Grok matrix|unexpected model/,
  );

  const decision = selectDMReleaseWinner(withUnexpectedModel, selectionEvidence(report));
  assert.equal(decision.status, 'no-winner');
  for (const aggregate of decision.aggregates) {
    assert.match(aggregate.disqualifications.join('\n'), /outside the exact Luna\/Grok matrix/);
  }
});

test('captured release report rejects claimed passes with non-completed outcomes', () => {
  const report = releaseReport(() => 5);
  const malformed = structuredClone(report);
  malformed.runs[0]!.outcome = 'error';

  assert.throws(
    () => validateDMReleaseReport(malformed),
    /passing run requires a completed outcome/,
  );

  const decision = selectDMReleaseWinner(malformed, selectionEvidence(report));
  assert.equal(decision.status, 'no-winner');
  for (const aggregate of decision.aggregates) {
    assert.match(aggregate.disqualifications.join('\n'), /does not match the live per-run release gate/);
  }
});

test('captured release report re-applies the live judge gate before qualification', () => {
  const report = releaseReport(() => 5);
  const malformed = structuredClone(report);
  const run = malformed.runs.find((candidate) => candidate.critical === false);
  assert.ok(run?.judge && !('error' in run.judge));
  run.judge.questionComprehension = 0;

  assert.throws(
    () => validateDMReleaseReport(malformed),
    /does not match the live per-run release gate/,
  );

  const decision = selectDMReleaseWinner(malformed, selectionEvidence(report));
  assert.equal(decision.status, 'no-winner');
  for (const aggregate of decision.aggregates) {
    assert.match(aggregate.disqualifications.join('\n'), /does not match the live per-run release gate/);
  }
});

function releaseReport(usefulnessFor: (model: string) => number): DMEvalReport {
  const runs: DMEvalRunRecord[] = [];
  for (const model of DM_RELEASE_MODELS) {
    for (const testCase of DM_LIVE_EVAL_CORPUS) {
      for (let runNumber = 1; runNumber <= 3; runNumber += 1) {
        const followUpApplicable = testCase.expectations.followUp !== 'not-useful';
        runs.push({
          model,
          caseId: testCase.id,
          caseName: testCase.name,
          runNumber,
          passed: true,
          failure: null,
          elapsedMs: 100,
          tools: [],
          stepCount: 1,
          inputTokens: 100,
          outputTokens: 25,
          repairCount: 0,
          outcome: 'completed',
          answerText: '',
          blockKinds: [],
          evidenceIds: [],
          source: testCase.source,
          categories: [...testCase.categories],
          critical: testCase.critical,
          followUpApplicable,
          costUsd: null,
          judge: judge(usefulnessFor(model), followUpApplicable),
          judgedBy: 'fixture-judge',
        });
      }
    }
  }
  return {
    generatedAt: '2026-07-14T00:00:00.000Z',
    mode: 'live',
    scoreKind: 'release',
    judge: 'fixture-judge',
    runs,
  };
}

function judge(useful: number, followUpApplicable: boolean): DMEvalJudgeScore {
  return {
    grounded: 5,
    honest: 5,
    questionComprehension: 5,
    useful,
    relevant: 5,
    direct: 5,
    continuity: 5,
    nonRepetition: 5,
    followUpUseful: followUpApplicable ? true : null,
    notes: '',
  };
}

function selectionEvidence(report: DMEvalReport): DMReleaseSelectionEvidence {
  return {
    schemaVersion: 1,
    baseline: {
      id: 'preview-a1d9b99-20260714',
      jsonSha256: 'a'.repeat(64),
      htmlSha256: 'b'.repeat(64),
    },
    comparisons: DM_RELEASE_MODELS.flatMap((model) => Array.from({ length: 10 }, (_, index) => ({
      id: `${model.replaceAll('/', '-')}-${index + 1}`,
      model,
      candidateRunSha256: computeDMReleaseCandidateDigest(report, model),
      preferred: index < 8 ? 'candidate' as const : 'baseline' as const,
    }))),
  };
}
