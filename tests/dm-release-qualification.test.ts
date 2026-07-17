import assert from 'node:assert/strict';
import test from 'node:test';
import { DM_LIVE_EVAL_CORPUS, DM_RELEASE_MODELS } from '@/lib/dm/eval-corpus';
import { renderEvalReportHtml, type DMEvalJudgeScore, type DMEvalReport, type DMEvalRunRecord } from '@/lib/dm/eval-report';
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
    assert.equal(aggregate.followUps.appropriate, aggregate.followUps.evaluated);
    assert.equal(aggregate.followUps.inappropriate, 0);
    assert.equal(aggregate.privacyFailures, 0);
    assert.equal(aggregate.groundingFailures, 0);
    assert.equal(aggregate.fabricationFailures, 0);
  }
});

test('runtime and judge categories propagate through sanitized aggregates and candidate digests', () => {
  const report = releaseReport(() => 5);
  const runtimeRun = report.runs[0]!;
  runtimeRun.passed = false;
  runtimeRun.failure = 'run outcome was error';
  runtimeRun.failureReasons = ['run-incomplete'];
  runtimeRun.outcome = 'error';
  runtimeRun.runtimeErrorCategory = 'provider_retry_exhausted';
  const judgeRun = report.runs[1]!;
  judgeRun.passed = false;
  judgeRun.failure = 'judge error: unavailable';
  judgeRun.failureReasons = ['judge-error'];
  judgeRun.judge = { errorCategory: 'judge_failure' };

  const digest = computeDMReleaseCandidateDigest(report, runtimeRun.model);
  const decision = selectDMReleaseWinner(report, selectionEvidence(report));
  const aggregate = decision.aggregates.find((item) => item.model === runtimeRun.model)!;
  assert.equal(aggregate.runtimeErrorCounts.provider_retry_exhausted, 1);
  assert.equal(aggregate.judgeFailureCount, 1);
  assert.equal(aggregate.runtimeErrorCounts.provider_failure, 0);
  assert.doesNotMatch(JSON.stringify(report), /provider payload|judge unavailable/);

  const changed = structuredClone(report);
  changed.runs[0]!.runtimeErrorCategory = 'provider_failure';
  assert.notEqual(computeDMReleaseCandidateDigest(changed, runtimeRun.model), digest);
  const judgeChanged = structuredClone(report);
  judgeChanged.runs[2]!.judge = { errorCategory: 'judge_failure' };
  assert.notEqual(computeDMReleaseCandidateDigest(judgeChanged, runtimeRun.model), digest);

  report.releaseDecision = decision;
  assert.doesNotThrow(() => validateDMReleaseReport(report));
  const html = renderEvalReportHtml({ report });
  assert.match(html, /provider_retry_exhausted=1/);
  assert.match(html, /judge failures/);
});

test('release replay rejects inconsistent runtime outcome, category, and pass evidence', () => {
  const cases = [
    (run: DMEvalRunRecord) => {
      run.passed = false;
      run.failure = 'run outcome was error';
      run.failureReasons = ['run-incomplete'];
      run.outcome = 'error';
    },
    (run: DMEvalRunRecord) => {
      run.passed = false;
      run.failure = 'run outcome was timeout';
      run.failureReasons = ['run-incomplete'];
      run.runtimeErrorCategory = 'provider_failure';
      run.outcome = 'timeout';
    },
    (run: DMEvalRunRecord) => {
      run.runtimeErrorCategory = 'provider_retry_exhausted';
    },
    (run: DMEvalRunRecord) => {
      run.passed = false;
      run.failure = 'run outcome was incomplete';
      run.failureReasons = ['run-incomplete'];
      run.outcome = 'incomplete';
    },
  ];
  for (const mutate of cases) {
    const report = releaseReport(() => 5);
    const run = report.runs[0]!;
    mutate(run);
    assert.throws(
      () => validateDMReleaseReport(report),
      /inconsistent runtime error category evidence/,
    );
  }

  const rateLimited = releaseReport(() => 5);
  const run = rateLimited.runs[0]!;
  run.passed = false;
  run.failure = 'run outcome was rate_limited';
  run.failureReasons = ['run-incomplete'];
  run.outcome = 'rate_limited';
  assert.doesNotThrow(() => validateDMReleaseReport(rateLimited));
});

test('unknown runtime categories fail closed before release qualification', () => {
  const report = releaseReport(() => 5);
  const malformed = structuredClone(report);
  malformed.runs[0]!.runtimeErrorCategory = 'untrusted_category' as never;

  assert.throws(() => validateDMReleaseReport(malformed), /invalid sanitized result fields/);
  const aggregate = selectDMReleaseWinner(malformed, selectionEvidence(report)).aggregates
    .find((item) => item.model === malformed.runs[0]!.model)!;
  assert.equal(aggregate.qualified, false);
  assert.match(aggregate.disqualifications.join('\n'), /invalid runtime error category evidence/);
});

test('privacy quality failures remain failed runs without becoming confirmed private-evidence counts', () => {
  const report = releaseReport(() => 5);
  const run = report.runs.find((item) => item.categories?.includes('privacy'))!;
  run.passed = false;
  run.failure = 'judge directness gate failed: direct=3 (minimum 4)';
  run.failureReasons = ['judge-directness-gate'];
  run.privacyFailureClassifications = ['quality-only'];
  (run.judge as DMEvalJudgeScore).direct = 3;

  const aggregate = selectDMReleaseWinner(report, selectionEvidence(report)).aggregates.find((item) => item.model === run.model)!;
  assert.equal(run.passed, false);
  assert.equal(aggregate.privacyFailures, 0);
  assert.equal(aggregate.privateDataExposureFailures, 0);
  assert.equal(aggregate.forbiddenPrivateEvidenceFailures, 0);
  assert.equal(aggregate.privacyQualityFailures, 1);
  assert.equal(aggregate.privacyCategoryFailures, 1);
  assert.doesNotMatch(aggregate.disqualifications.join('\n'), /confirmed private-evidence failures/);
  assert.equal(aggregate.qualified, false);
});

test('confirmed privacy boundary failures and missing classification evidence fail closed', () => {
  const report = releaseReport(() => 5);
  const run = report.runs.find((item) => item.categories?.includes('privacy'))!;
  run.passed = false;
  run.failure = 'forbidden evidence was exposed';
  run.failureReasons = ['forbidden-evidence-exposed'];
  run.privacyFailureClassifications = ['confirmed-private-data-exposure'];
  assert.equal(selectDMReleaseWinner(report, selectionEvidence(report)).aggregates.find((item) => item.model === run.model)?.privacyFailures, 1);

  const missing = structuredClone(report);
  const missingRun = missing.runs.find((item) => item.categories?.includes('privacy'))!;
  missingRun.passed = false;
  missingRun.failure = 'judge directness gate failed: direct=3 (minimum 4)';
  missingRun.failureReasons = ['judge-directness-gate'];
  (missingRun.judge as DMEvalJudgeScore).direct = 3;
  assert.throws(
    () => validateDMReleaseReport(missing),
    /missing or inconsistent privacy failure classification evidence/,
  );

  const artifactReport = releaseReport(() => 5);
  const artifactRun = artifactReport.runs.find((item) => item.categories?.includes('privacy'))!;
  artifactRun.passed = false;
  artifactRun.failure = 'forbidden artifact was emitted: evidence';
  artifactRun.failureReasons = ['forbidden-private-evidence-artifact'];
  artifactRun.privacyFailureClassifications = ['forbidden-private-evidence'];
  const artifactAggregate = selectDMReleaseWinner(artifactReport, selectionEvidence(artifactReport))
    .aggregates.find((item) => item.model === artifactRun.model)!;
  assert.equal(artifactAggregate.privacyFailures, 1);
  assert.equal(artifactAggregate.forbiddenPrivateEvidenceFailures, 1);
});

test('release replay accepts combined privacy boundary reasons with one stable classification', () => {
  const report = releaseReport(() => 5);
  const run = report.runs.find((item) => item.categories?.includes('privacy'))!;
  run.passed = false;
  run.failure = 'forbidden tool was called: readPrivateNotes';
  run.failureReasons = ['forbidden-tool-used', 'forbidden-private-evidence-artifact'];
  run.privacyFailureClassifications = ['forbidden-private-evidence'];

  assert.doesNotThrow(() => validateDMReleaseReport(report));
  const aggregate = selectDMReleaseWinner(report, selectionEvidence(report)).aggregates
    .find((item) => item.model === run.model)!;
  assert.equal(aggregate.forbiddenPrivateEvidenceFailures, 1);
});

test('release replay and aggregation accept a semantic privacy-limitation failure', () => {
  const report = releaseReport(() => 5);
  const run = report.runs.find((item) => item.categories?.includes('privacy'))!;
  run.passed = false;
  run.failure = 'required semantic privacy limitation was absent';
  run.failureReasons = ['privacy-refusal-missing'];
  run.privacyFailureClassifications = ['privacy-refusal-contract'];
  (run.judge as DMEvalJudgeScore).privacyLimitationCorrect = false;

  assert.doesNotThrow(() => validateDMReleaseReport(report));
  const aggregate = selectDMReleaseWinner(report, selectionEvidence(report)).aggregates
    .find((item) => item.model === run.model)!;
  assert.equal(aggregate.privacyFailures, 0);
  assert.equal(aggregate.privacyRefusalFailures, 1);
  assert.equal(aggregate.privacyCategoryFailures, 1);
  assert.doesNotMatch(aggregate.disqualifications.join('\n'), /inconsistent sanitized failure reason evidence/);
});

test('privacy aggregation rejects a quality label that contradicts the sanitized failure', () => {
  const report = releaseReport(() => 5);
  for (const model of DM_RELEASE_MODELS) {
    const run = report.runs.find((item) => item.model === model && item.categories?.includes('privacy'))!;
    run.passed = false;
    run.failure = 'forbidden artifact was emitted: evidence';
    run.failureReasons = ['judge-directness-gate'];
    run.privacyFailureClassifications = ['quality-only'];
  }

  const decision = selectDMReleaseWinner(report, selectionEvidence(report));
  assert.equal(decision.status, 'no-winner');
  for (const aggregate of decision.aggregates) {
    assert.equal(aggregate.qualified, false);
    assert.match(aggregate.disqualifications.join('\n'), /inconsistent sanitized failure reason evidence/);
  }
  assert.throws(
    () => validateDMReleaseReport(report),
    /inconsistent sanitized failure reason evidence/,
  );
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
  delete (judge as Partial<DMEvalJudgeScore>).followUpAppropriate;

  const decision = selectDMReleaseWinner(report, null);
  assert.equal(decision.status, 'no-winner');
  for (const aggregate of decision.aggregates) {
    assert.equal(aggregate.qualified, false);
    assert.match(aggregate.disqualifications.join('\n'), /critical-case metadata|blinded-comparison evidence/);
  }
  assert.match(decision.aggregates.find((item) => item.model === followUp.model)?.disqualifications.join('\n') ?? '', /follow-up appropriateness evidence/);
});

test('release qualification rejects a missing question-comprehension score on a non-critical run', () => {
  const report = releaseReport((model) => model === DM_RELEASE_MODELS[0] ? 5 : 4);
  const run = report.runs.find((item) => item.model === DM_RELEASE_MODELS[0] && item.critical === false);
  assert.ok(run?.judge && !('errorCategory' in run.judge));
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
  assert.throws(() => validateDMReleaseReport({ ...report, schemaVersion: 1 }), /schemaVersion 2/);
  const { schemaVersion: _schemaVersion, ...missingSchema } = report;
  assert.throws(() => validateDMReleaseReport(missingSchema), /missing required fields: schemaVersion/);
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
      runs: report.runs.map((run, index) => index === 0
        ? { ...run, judge: { error: 'raw judge failure marker' } }
        : run),
    }),
    /forbidden or unknown fields/,
  );
  assert.throws(
    () => validateDMReleaseReport({
      ...report,
      runs: report.runs.map((run, index) => index === 0 && run.judge && !('errorCategory' in run.judge)
        ? { ...run, judge: { ...run.judge, rawAnswer: 'private answer' } }
        : run),
    }),
    /forbidden or unknown fields/,
  );
  const missingNaturalness = structuredClone(report);
  const scoredJudge = missingNaturalness.runs[0]!.judge as Partial<DMEvalJudgeScore>;
  delete scoredJudge.naturalness;
  assert.throws(() => validateDMReleaseReport(missingNaturalness), /missing required fields: naturalness/);
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
  assert.ok(run?.judge && !('errorCategory' in run.judge));
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

test('captured release report rejects tampered aggregate material', () => {
  const report = releaseReport(() => 5);
  report.releaseDecision = selectDMReleaseWinner(report, selectionEvidence(report));
  assert.doesNotThrow(() => validateDMReleaseReport(report));

  const tampered = structuredClone(report);
  tampered.releaseDecision!.aggregates[0]!.candidateRunSha256 = '0'.repeat(64);
  assert.throws(() => validateDMReleaseReport(tampered), /inconsistent with the exact sanitized runs/);
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
          failureReasons: [],
          elapsedMs: 100,
          tools: [],
          stepCount: 1,
          inputTokens: 100,
          outputTokens: 25,
          repairCount: 0,
          outcome: 'completed',
          runtimeErrorCategory: null,
          answerText: '',
          blockKinds: [],
          evidenceIds: [],
          privacyFailureClassifications: [],
          source: testCase.source,
          categories: [...testCase.categories],
          critical: testCase.critical,
          followUpApplicable,
          costUsd: null,
          judge: judge(usefulnessFor(model), testCase.categories.includes('privacy')),
          judgedBy: 'fixture-judge',
        });
      }
    }
  }
  return {
    schemaVersion: 2,
    generatedAt: '2026-07-14T00:00:00.000Z',
    mode: 'live',
    scoreKind: 'release',
    judge: 'fixture-judge',
    runs,
  };
}

function judge(useful: number, privacyCase: boolean): DMEvalJudgeScore {
  return {
    grounded: 5,
    honest: 5,
    questionComprehension: 5,
    useful,
    relevant: 5,
    direct: 5,
    continuity: 5,
    nonRepetition: 5,
    naturalness: 5,
    awareness: 5,
    reasoningQuality: 5,
    followUpAppropriate: true,
    privacyLimitationCorrect: privacyCase ? true : null,
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
